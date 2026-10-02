// Importer for the "Consolidated Mailing List - 2025" workbook (tab
// 'Master Mailing List'), adapted from scripts/import-master-data-fixed.ts
// (the 2026 consolidated importer). Same relational shape and the same
// campaign / owner-identity / seed-owner rules, with these differences:
//
//   * Columns are located by HEADER NAME (row 1), never by index.
//   * County/State come only from the row's own County/State cells.
//   * An APN that already exists IN THE SAME STATE + COUNTY (in the DB or
//     earlier in the sheet) reuses that property and only adds what is new
//     (owner link, mailing, ...). The same APN string in another county is a
//     different parcel and gets its own property.
//   * APNs the sheet damaged by storing them as numbers (dropped leading
//     zeros, rounded digits) are recovered from the parent workbook - see
//     scripts/apn-recovery.ts. The damaged value is kept in raw_data.
//   * Parent workbooks (the row's Sheet Link) are indexed by APN across ALL
//     of their tabs to backfill latitude/longitude and blank fields.
//   * Every source column is kept verbatim in properties.raw_data, so a
//     column with no typed home in the schema is reported, not dropped.
//
// LOCAL DATABASE BY DEFAULT: the script refuses any non-localhost DATABASE_URL
// unless --allow-remote is passed explicitly.
//
// Usage:
//   npx tsx scripts/import-master-data-2025.ts [--dry-run] [--refresh] [--no-parents] [--repair-apns] [--allow-remote]
//     --dry-run      run everything in the transaction, then roll back
//     --allow-remote allow a non-local (e.g. production) DATABASE_URL; refuses
//                    by default
//     --refresh      ignore the on-disk sheet cache and re-fetch from Google
//     --no-parents   skip parent-workbook supplementation and APN recovery
//     --repair-apns  first fix properties an earlier run of this importer
//                    created under a damaged APN: renamed in place when all
//                    of their rows share one true APN, otherwise deleted and
//                    re-imported row by row (they were several parcels merged
//                    into one)

import fs from 'fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  properties, owners, propertyOwners, mailingAddresses, campaigns, mailings,
  dataSources, mailingSuppression, deals, sourceMetadata,
} from '../shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { normalizeCampaignName, cleanSheetLink } from './campaign-normalize';
import { isSeedOwner, deleteSeedOwnerLinksForProperty } from './seed-owner-utils';
import { normalizeIdentityName, ownerIdentityKey } from './owner-identity';
import { GogSheetsCache, TabInfo } from './gog-sheets-cache';
import { ApnRecoverer, ApnRecovery, APN_HEADER_ALIASES } from './apn-recovery';
import { isDifferentLocation, matchPropertyByLocation } from '../shared/property-location';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/elw_mailing_list';
const SHEET_ID = '1jVj15Gjr_vgq8pk-Dzvg2lx6BVdjKM7p6Jfhrae1yDM';
const MASTER_TAB = 'Master Mailing List';
const DATA_SOURCE_NAME = 'consolidated_master_2025';
const DATA_SOURCE_DESCRIPTION = 'Consolidated Master Mailing List 2025';
const BATCH_SIZE = 500;
const CACHE_DIR = process.env.IMPORT2025_CACHE_DIR || '/tmp/import2025_cache/sheets';
// --summary=<path> keeps an earlier run's summary from being overwritten.
const SUMMARY_PATH = process.argv.find((a) => a.startsWith('--summary='))?.slice('--summary='.length) || '/tmp/import2025_summary.txt';
const RAW_KEY = 'consolidated_2025';

const DRY_RUN = process.argv.includes('--dry-run');
const REFRESH = process.argv.includes('--refresh');
const NO_PARENTS = process.argv.includes('--no-parents');
const REPAIR_APNS = process.argv.includes('--repair-apns');
const ALLOW_REMOTE = process.argv.includes('--allow-remote');

// Where each consolidated header lands in the schema. A header that is not
// listed here is still preserved in properties.raw_data and is reported in
// the summary as unmapped.
const COLUMN_TARGETS: Record<string, { target: string; typed: boolean }> = {
  'APN': { target: 'properties.apn', typed: true },
  'County': { target: 'properties.county', typed: true },
  'State': { target: 'properties.state', typed: true },
  'Acres': { target: 'properties.acres', typed: true },
  'Sheet Name': { target: 'campaigns.name (normalized)', typed: true },
  'Sheet Link': { target: 'campaigns.link (cleaned) + source_metadata.source_link', typed: true },
  'Owner First Name': { target: 'owners.first_name / owner_name', typed: true },
  'Owner Last Name': { target: 'owners.last_name / owner_name', typed: true },
  'Owner Email': { target: 'owners.email', typed: true },
  'Owner Phone': { target: 'owners.phone', typed: true },
  'Full Mailing Address': { target: 'mailing_addresses.* (parsed when the split columns are blank); verbatim in raw_data', typed: true },
  'Mailing Address 1': { target: 'mailing_addresses.address_line1', typed: true },
  'Mailing Address 2': { target: 'mailing_addresses.address_line2', typed: true },
  'Mailing City': { target: 'mailing_addresses.city', typed: true },
  'Mailing State': { target: 'mailing_addresses.state', typed: true },
  'Mailing Zip': { target: 'mailing_addresses.zip', typed: true },
  'Situs Address': { target: 'NO COLUMN - properties.raw_data only', typed: false },
  'Situs City': { target: 'NO COLUMN - properties.raw_data only', typed: false },
  'Legal Description': { target: 'properties.legal_description', typed: true },
  'Data Source': { target: 'NO COLUMN - properties.raw_data only (data_source_id is the import-level source)', typed: false },
  'Offer Price': { target: 'mailings.offer_price', typed: true },
  'To Mail': { target: 'NO COLUMN - properties.raw_data only', typed: false },
  'Mailing Date 1': { target: 'mailings.mail_date', typed: true },
  'Mailing Date 2': { target: 'mailings.mail_date (additional mailing)', typed: true },
  'Mailing Date 3': { target: 'mailings.mail_date (additional mailing)', typed: true },
  'Mail Exclusion': { target: "mailing_suppression.reason = 'do_not_mail'", typed: true },
  'Mail Exclusion Reason': { target: 'NO COLUMN - properties.raw_data only (suppression has no free-text reason)', typed: false },
  'Bad Address': { target: "mailing_suppression.reason = 'bad_address'", typed: true },
  'Hit Type': { target: 'deals.hit_type', typed: true },
  'Hit Date': { target: 'deals.hit_date', typed: true },
  'Hit Source': { target: 'NO COLUMN - properties.raw_data only', typed: false },
  'Prospect': { target: 'deals.is_lead', typed: true },
  'Prospect Date': { target: 'NO COLUMN - properties.raw_data only', typed: false },
};
const MAILING_DATE_HEADERS = ['Mailing Date 1', 'Mailing Date 2', 'Mailing Date 3'];

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|ERROR!|NAME\?|DIV\/0!|NUM!|NULL!)$/;

function cellText(v: any): string {
  return (v ?? '').toString().trim();
}

function clip(v: string | null, max: number): string | null {
  if (v === null) return null;
  return v.length > max ? v.slice(0, max) : v;
}

function getOwnerType(name: string): 'individual' | 'company' | 'trust' | 'llc' | 'other' {
  const upper = name.toUpperCase();
  if (upper.includes('TRUST') || upper.includes('REV TRUST') || upper.includes('LIVING TRUST')) return 'trust';
  if (upper.includes('LLC') || upper.includes('L.L.C')) return 'llc';
  if (upper.includes('INC') || upper.includes('CORP') || upper.includes('COMPANY')) return 'company';
  return 'individual';
}

function parseNumber(value: string): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed.toString();
}

// Sheet dates are M/D/YY or M/D/YYYY. Anything else ("Skipped", "11/18")
// is not a date and is left to the caller to report.
function parseDate(dateStr: string): Date | null {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const date = new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  return isNaN(date.getTime()) ? null : date;
}

function parseBoolean(val: string): boolean {
  const v = val.toLowerCase().trim();
  return v === 'true' || v === 'yes' || v === 'y' || v === '1';
}

function mapHitType(raw: string): 'call' | 'email' | 'website' | 'text' | 'mail' | 'other' {
  const v = raw.toLowerCase().trim();
  if (v === 'phone' || v === 'call') return 'call';
  if (v === 'letter' || v === 'mail') return 'mail';
  if (v === 'email') return 'email';
  if (v === 'text' || v === 'sms') return 'text';
  if (v === 'website' || v === 'web') return 'website';
  return 'other';
}

// The sheet stores some APNs as numbers, so the formatted value can be lossy
// ("1.30E+11", or "290280136.1" for 290280136.11). Use the unformatted value
// in exactly those cases; text APNs (leading zeros, dashes) stay as displayed.
function resolveApn(formatted: string, unformatted: any): string {
  if (typeof unformatted === 'number') {
    if (/E\+/i.test(formatted)) return String(unformatted);
    if (/^\d+(\.\d+)?$/.test(formatted) && !/^0\d/.test(formatted) && String(unformatted) !== formatted) return String(unformatted);
  }
  return formatted;
}

function apnMatchKey(v: any): string {
  return cellText(v).toUpperCase().replace(/\s+/g, ' ');
}

function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 15 && lat <= 75 && lon >= -180 && lon <= -60;
}

// "Latitude: 44.147669, Longitude: -90.1" / "Lattitude & Longitude: 44.6, -85.8"
function latLonFromText(text: string): { lat: number; lon: number } | null {
  if (!text) return null;
  const m = text.match(/lat+itude\s*(?:&|and|\/)\s*longitude\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/i)
    || text.match(/lat+itude\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)\s*,?\s*longitude\s*[:=]\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  return validLatLon(lat, lon) ? { lat, lon } : null;
}

interface ParsedAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  parsed: boolean;
}

// "P O BOX 256\nGARDENDALE, TX 79758-0256[ USA]"
function parseFullAddress(full: string): ParsedAddress | null {
  const lines = full.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1].replace(/\s+USA$/i, '');
  if (lines.length >= 2) {
    const m = last.match(/^(.+?),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) {
      return { line1: lines[0], line2: lines.slice(1, -1).join(', ') || null, city: m[1].replace(/,$/, '').trim(), state: m[2].toUpperCase(), zip: m[3], parsed: true };
    }
  } else {
    const m = last.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) return { line1: m[1].trim(), line2: null, city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4], parsed: true };
  }
  return { line1: lines.join(', '), line2: null, city: null, state: null, zip: null, parsed: false };
}

// ---------------------------------------------------------------------------
// Parent workbooks
// ---------------------------------------------------------------------------

type SuppField = 'legal' | 'situsAddress' | 'situsCity' | 'situsZip' | 'phone' | 'email' | 'acres';

const PARENT_ALIASES: Record<'apn' | 'lat' | 'lon' | 'latlon' | SuppField, string[]> = {
  apn: APN_HEADER_ALIASES,
  lat: ['latitude', 'lat', 'lattitude'],
  lon: ['longitude', 'long', 'lng', 'lon'],
  latlon: ['lat long', 'lat lng', 'lat lon', 'latitude longitude', 'lattitude longitude', 'lat and long', 'latitude and longitude', 'coordinates', 'coords', 'geo', 'geolocation', 'gps', 'gps coordinates'],
  legal: ['legal desc', 'legal description', 'legal', 'legal1', 'lglstring'],
  situsAddress: ['situs address', 'site address', 'situs street address', 'situs full address', 'property address', 'parcel address'],
  situsCity: ['situs city', 'addr city', 'parcel city'],
  situsZip: ['situs zip geocodio', 'situs zip', 'situs zip code', 'addr zip 5 digit', 'addr zip'],
  phone: ['phone', 'owner phone', 'phone 1', 'phone1', 'phone number'],
  email: ['email', 'owner email', 'email 1', 'email address'],
  acres: ['acres', 'acreage', 'acres county preferred', 'lot acreage', 'lot acres'],
};
const SUPP_FIELDS: SuppField[] = ['legal', 'situsAddress', 'situsCity', 'situsZip', 'phone', 'email', 'acres'];
const HEADER_SCAN_ROWS = 15;

function normalizeHeader(v: any): string {
  return cellText(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

interface ParentHit {
  tab: string;
  lat: number | null;
  lon: number | null;
  latLonFrom: 'column' | 'text' | null;
  fields: Partial<Record<SuppField, string>>;
}

interface ParentTabReport {
  tab: string;
  rows: number;
  headerRow: number;
  matchedApns: number;
  hasLatLon: boolean;
  latLonRows: number;
}

interface ParentWorkbook {
  id: string;
  title: string;
  error: string | null;
  byApn: Map<string, ParentHit[]>;
  // zero-stripped APN -> parent APN as written -> hits (see lookupParent)
  byZeroStripped: Map<string, Map<string, ParentHit[]>>;
  tabs: ParentTabReport[];
}

// Indexes one parent workbook by APN across every grid tab. Tabs are not
// selected by name: the header row is detected by content, any tab with an
// APN-like column contributes, and tabs are later ranked by how many of the
// consolidated rows' APNs they actually contain.
function indexParentWorkbook(cache: GogSheetsCache, id: string, wanted: Set<string>, wantedNumeric: Set<string>): ParentWorkbook {
  const wb: ParentWorkbook = { id, title: '', error: null, byApn: new Map(), byZeroStripped: new Map(), tabs: [] };
  let tabs: TabInfo[];
  try {
    const meta = cache.metadata(id);
    wb.title = meta.title;
    tabs = meta.tabs.filter((t) => t.isGrid);
  } catch (e: any) {
    wb.error = e.message.slice(0, 300);
    return wb;
  }

  for (const tab of tabs) {
    let values: any[][];
    try {
      values = cache.tabValues(id, tab, 'UNFORMATTED_VALUE');
    } catch (e: any) {
      wb.tabs.push({ tab: `${tab.title} (FETCH ERROR: ${e.message.slice(0, 120)})`, rows: 0, headerRow: 0, matchedApns: 0, hasLatLon: false, latLonRows: 0 });
      continue;
    }

    // Header row = the row (within the first few) with the most recognised
    // headers, and at least one APN-like header.
    let best: { row: number; score: number; cols: Record<string, number[]> } | null = null;
    for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, values.length); r++) {
      const cols: Record<string, number[]> = {};
      let score = 0;
      (values[r] ?? []).forEach((cell, c) => {
        const h = normalizeHeader(cell);
        if (!h) return;
        for (const [kind, aliases] of Object.entries(PARENT_ALIASES)) {
          if (aliases.includes(h)) {
            (cols[kind] ||= []).push(c);
            score++;
          }
        }
      });
      if (cols.apn && (!best || score > best.score)) best = { row: r, score, cols };
    }
    if (!best) continue;

    const { cols } = best;
    const matched = new Set<string>();
    let latLonRows = 0;
    const first = (row: any[], kind: string): string => {
      for (const c of cols[kind] ?? []) {
        const v = cellText(row[c]);
        if (v && !SHEET_ERROR.test(v)) return v;
      }
      return '';
    };

    for (let r = best.row + 1; r < values.length; r++) {
      const row = values[r] ?? [];
      const keys = new Set<string>();
      const zeroKeys = new Map<string, string>();
      for (const c of cols.apn) {
        const k = apnMatchKey(row[c]);
        if (!k) continue;
        if (wanted.has(k)) keys.add(k);
        const stripped = k.replace(/^0+/, '');
        if (stripped !== k && !wanted.has(k) && wantedNumeric.has(stripped)) zeroKeys.set(stripped, k);
      }
      if (keys.size === 0 && zeroKeys.size === 0) continue;

      const hit: ParentHit = { tab: tab.title, lat: null, lon: null, latLonFrom: null, fields: {} };
      const lat = parseFloat(first(row, 'lat'));
      const lon = parseFloat(first(row, 'lon'));
      if (validLatLon(lat, lon)) {
        hit.lat = lat; hit.lon = lon; hit.latLonFrom = 'column';
      } else {
        const combined = first(row, 'latlon').match(/(-?\d{1,3}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
        if (combined && validLatLon(parseFloat(combined[1]), parseFloat(combined[2]))) {
          hit.lat = parseFloat(combined[1]); hit.lon = parseFloat(combined[2]); hit.latLonFrom = 'column';
        }
      }
      for (const f of SUPP_FIELDS) {
        const v = first(row, f);
        if (v) hit.fields[f] = v;
      }
      if (hit.lat === null && hit.fields.legal) {
        const t = latLonFromText(hit.fields.legal);
        if (t) { hit.lat = t.lat; hit.lon = t.lon; hit.latLonFrom = 'text'; }
      }
      if (hit.lat !== null) latLonRows++;
      for (const k of keys) {
        matched.add(k);
        if (!wb.byApn.has(k)) wb.byApn.set(k, []);
        wb.byApn.get(k)!.push(hit);
      }
      for (const [stripped, k] of zeroKeys) {
        matched.add(stripped);
        if (!wb.byZeroStripped.has(stripped)) wb.byZeroStripped.set(stripped, new Map());
        const byParentApn = wb.byZeroStripped.get(stripped)!;
        if (!byParentApn.has(k)) byParentApn.set(k, []);
        byParentApn.get(k)!.push(hit);
      }
    }
    wb.tabs.push({
      tab: tab.title, rows: values.length, headerRow: best.row + 1, matchedApns: matched.size,
      hasLatLon: !!(cols.lat && cols.lon) || !!cols.latlon, latLonRows,
    });
  }

  // Rank tabs by content: the tab holding the most of this workbook's
  // consolidated APNs is the primary source for supplemented fields.
  wb.tabs.sort((a, b) => b.matchedApns - a.matchedApns);
  const rank = new Map(wb.tabs.map((t, i) => [t.tab, i]));
  const byRank = (a: ParentHit, b: ParentHit) => (rank.get(a.tab) ?? 0) - (rank.get(b.tab) ?? 0);
  for (const hits of wb.byApn.values()) hits.sort(byRank);
  for (const byParentApn of wb.byZeroStripped.values()) for (const hits of byParentApn.values()) hits.sort(byRank);
  return wb;
}

interface ParentSupplement {
  tab: string | null;
  // Set when the match needed the parent's leading zeros restored.
  parentApn: string | null;
  lat: number | null;
  lon: number | null;
  latLonFrom: 'column' | 'text' | null;
  latLonTab: string | null;
  latLonAmbiguous: boolean;
  fields: Partial<Record<SuppField, string>>;
}

function lookupParent(wb: ParentWorkbook | undefined, keys: string[], numericApn: string | null): ParentSupplement | null {
  if (!wb) return null;
  const hits: ParentHit[] = [];
  let parentApn: string | null = null;
  for (const k of keys) {
    const h = wb.byApn.get(k);
    if (h) { hits.push(...h); break; }
  }
  // The consolidated sheet turned some APNs into numbers, which drops their
  // leading zeros ("0066116" -> 66116). Numerically that is the same APN, so
  // accept the parent's zero-padded form - but only when exactly one parent
  // APN pads to it.
  if (hits.length === 0 && numericApn) {
    const candidates = wb.byZeroStripped.get(numericApn);
    if (candidates && candidates.size === 1) {
      const [k, h] = [...candidates][0];
      parentApn = k;
      hits.push(...h);
    }
  }
  if (hits.length === 0) return null;

  const out: ParentSupplement = { tab: hits[0].tab, parentApn, lat: null, lon: null, latLonFrom: null, latLonTab: null, latLonAmbiguous: false, fields: {} };
  // Lat/long is only taken when every tab that has one for this APN agrees
  // (to ~10m); a disagreement means the APN is not a reliable key here.
  const withCoords = hits.filter((h) => h.lat !== null);
  const distinct = new Set(withCoords.map((h) => `${h.lat!.toFixed(4)},${h.lon!.toFixed(4)}`));
  if (distinct.size === 1) {
    const h = withCoords.find((x) => x.latLonFrom === 'column') ?? withCoords[0];
    out.lat = h.lat; out.lon = h.lon; out.latLonFrom = h.latLonFrom; out.latLonTab = h.tab;
  } else if (distinct.size > 1) {
    out.latLonAmbiguous = true;
  }
  for (const f of SUPP_FIELDS) {
    const h = hits.find((x) => x.fields[f]);
    if (h) out.fields[f] = h.fields[f];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

class DryRunRollback extends Error {}

function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(host)) return;
  if (!ALLOW_REMOTE) {
    throw new Error(`Refusing to run: DATABASE_URL host "${host}" is not local. This importer is local-only unless --allow-remote is passed.`);
  }
  const banner = '!'.repeat(78);
  console.warn(banner);
  console.warn(`WARNING: --allow-remote set. Connecting to NON-LOCAL database host "${host}". This writes to a remote/production database.`);
  console.warn(banner);
}

function inc(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) || 0) + by);
}

async function main() {
  assertLocalDatabase(DATABASE_URL);
  console.log(`Connecting to database (${new URL(DATABASE_URL).hostname}${new URL(DATABASE_URL).pathname})${DRY_RUN ? ' [DRY RUN]' : ''}...`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const rootDb = drizzle(pool);

  // ========== FETCH CONSOLIDATED TAB ==========
  const cache = new GogSheetsCache(CACHE_DIR, REFRESH);
  console.log('Fetching sheet metadata...');
  const masterMeta = cache.metadata(SHEET_ID);
  const masterTab = masterMeta.tabs.find((t) => t.title === MASTER_TAB);
  if (!masterTab) throw new Error(`Tab '${MASTER_TAB}' not found in ${SHEET_ID}. Tabs: ${masterMeta.tabs.map((t) => t.title).join(', ')}`);
  console.log(`Sheet has ${masterTab.rows} rows x ${masterTab.cols} cols, fetching in batches of ${BATCH_SIZE}`);
  const formatted = cache.tabValues(SHEET_ID, masterTab, 'FORMATTED_VALUE', BATCH_SIZE);
  const unformatted = cache.tabValues(SHEET_ID, masterTab, 'UNFORMATTED_VALUE', BATCH_SIZE);

  // ========== HEADER MAP ==========
  const headers = (formatted[0] ?? []).map((h) => cellText(h));
  const colIndex = new Map<string, number>();
  headers.forEach((h, i) => { if (h && !colIndex.has(h)) colIndex.set(h, i); });
  for (const required of ['APN', 'County', 'State', 'Sheet Name']) {
    if (!colIndex.has(required)) throw new Error(`Required header '${required}' not found in row 1: ${JSON.stringify(headers)}`);
  }
  const missingHeaders = Object.keys(COLUMN_TARGETS).filter((h) => !colIndex.has(h));
  const unknownHeaders = headers.filter((h) => h && !COLUMN_TARGETS[h]);
  const maxWidth = formatted.reduce((m, r) => Math.max(m, r.length), 0);
  console.log(`Header row: ${headers.length} columns (widest data row: ${maxWidth})`);

  const sheetErrorCells = new Map<string, number>();
  const filledByHeader = new Map<string, number>();

  interface SourceRow {
    sheetRow: number;
    get: (header: string) => string;
    raw: Record<string, string>;
    apn: string;
    // The APN as the consolidated tab holds it; differs from `apn` when the
    // true APN was recovered from the parent workbook.
    sheetApn: string;
    recovery: ApnRecovery | null;
    unformattedApn: any;
    apnKeys: string[];
    numericApn: string | null;
    docId: string | null;
    ownerName: string;
    isSeed: boolean;
  }

  const sourceRows: SourceRow[] = [];
  let rowsNoApn = 0;
  const noApnRows: string[] = [];
  let apnFromUnformatted = 0;
  let precisionLostApns = 0;
  const apnCol = colIndex.get('APN')!;

  for (let i = 1; i < formatted.length; i++) {
    const cells = formatted[i] ?? [];
    if (!cells.some((c) => cellText(c) !== '')) continue;

    const raw: Record<string, string> = {};
    headers.forEach((h, c) => {
      const v = cellText(cells[c]);
      if (!v) return;
      const key = h || `(column ${c + 1})`;
      raw[key] = v;
      inc(filledByHeader, key);
      if (SHEET_ERROR.test(v)) inc(sheetErrorCells, key);
    });
    for (let c = headers.length; c < cells.length; c++) {
      const v = cellText(cells[c]);
      if (v) { raw[`(column ${c + 1})`] = v; inc(filledByHeader, `(column ${c + 1})`); }
    }
    // Spreadsheet error values (#N/A, #REF!) are treated as blank.
    const get = (header: string): string => {
      const v = raw[header] ?? '';
      return SHEET_ERROR.test(v) ? '' : v;
    };

    const formattedApn = get('APN');
    const unformattedApn = unformatted[i]?.[apnCol];
    const apn = resolveApn(formattedApn, unformattedApn).toUpperCase();
    if (apn !== formattedApn.toUpperCase()) apnFromUnformatted++;
    if (typeof unformattedApn === 'number' && /E\+/i.test(formattedApn)) precisionLostApns++;

    let ownerName = get('Owner Last Name');
    if (get('Owner First Name')) ownerName = `${get('Owner First Name')} ${ownerName}`.trim();

    if (!apn) {
      rowsNoApn++;
      // Nothing identifies the parcel: a seed/test row (the mail house's
      // proof copy, which has no parcel) or a stray cell with no owner.
      const reason = isSeedOwner(ownerName) ? 'seed/test row - no parcel behind it, the parent row has no APN either'
        : !ownerName ? 'stray cells - no owner, no APN, no Sheet Link: nothing to look up in a parent workbook'
          : 'no APN in the sheet';
      noApnRows.push(`row ${i + 1}: ${reason} | ${JSON.stringify(raw).slice(0, 400)}`);
      continue;
    }

    const docMatch = get('Sheet Link').match(/\/spreadsheets\/d\/([^/]+)/);
    sourceRows.push({
      sheetRow: i + 1, get, raw, apn, sheetApn: apn, recovery: null, unformattedApn,
      apnKeys: [...new Set([apnMatchKey(apn), apnMatchKey(formattedApn), typeof unformattedApn === 'number' ? String(unformattedApn) : ''].filter(Boolean))],
      numericApn: typeof unformattedApn === 'number' ? String(unformattedApn) : null,
      docId: docMatch ? docMatch[1] : null,
      ownerName: ownerName || `Unknown Owner - ${apn}`,
      isSeed: isSeedOwner(ownerName),
    });
  }
  const rowsParsed = sourceRows.length + rowsNoApn;
  console.log(`Parsed ${rowsParsed} data rows (${rowsNoApn} without an APN)`);

  // ========== APN RECOVERY ==========
  // Done before anything is keyed by APN, so the whole import (property
  // lookup, seed rule, parent supplement) runs on the true APN.
  const recoveryCounts = new Map<string, number>();
  const recoveryLog: string[] = [];
  const unrecoveredNumeric = new Map<string, { n: number; examples: string[] }>();
  if (!NO_PARENTS) {
    console.log('Recovering damaged APNs from parent workbooks...');
    const inputs = sourceRows.map((r) => ({
      sheetRow: r.sheetRow, apn: r.apn, unformattedApn: r.unformattedApn, docId: r.docId,
      ownerLastName: r.get('Owner Last Name'), ownerName: r.ownerName,
      addressLine1: r.get('Mailing Address 1') || r.get('Full Mailing Address').split(/\r?\n/)[0],
      acres: r.get('Acres'), offerPrice: r.get('Offer Price'),
    }));
    const recoverer = new ApnRecoverer(cache, inputs);
    sourceRows.forEach((r, i) => {
      if (r.isSeed) return;
      const rec = recoverer.recover(inputs[i]);
      r.recovery = rec;
      inc(recoveryCounts, rec.status === 'recovered' ? `recovered - ${rec.how} (matched by ${rec.matchedBy})` : rec.status);
      if (rec.status === 'recovered') {
        recoveryLog.push(`row ${r.sheetRow}: ${r.raw['APN']}${r.sheetApn !== (r.raw['APN'] ?? '').toUpperCase() ? ` (= ${r.sheetApn})` : ''} -> ${rec.apn} | ${rec.how}, matched by ${rec.matchedBy} | ${r.get('State')}/${r.get('County')} | "${r.ownerName}" | parent ${rec.workbookId} [${rec.tab}] row ${rec.row} col "${rec.column}"`);
        r.apn = rec.apn!;
        r.apnKeys = [...new Set([apnMatchKey(r.apn), ...r.apnKeys])];
      } else if (typeof r.unformattedApn === 'number' && rec.status !== 'confirmed') {
        // A number-typed APN nothing could vouch for as text.
        const key = `${r.get('State')}/${r.get('County')} - ${rec.status}`;
        if (!unrecoveredNumeric.has(key)) unrecoveredNumeric.set(key, { n: 0, examples: [] });
        const u = unrecoveredNumeric.get(key)!;
        u.n++;
        if (u.examples.length < 3) u.examples.push(`row ${r.sheetRow} ${r.apn}`);
      }
    });
    console.log(`  ${recoveryLog.length} APNs recovered`);
  }

  // ========== PARENT WORKBOOKS ==========
  const parents = new Map<string, ParentWorkbook>();
  if (!NO_PARENTS) {
    const wantedByDoc = new Map<string, Set<string>>();
    const wantedNumericByDoc = new Map<string, Set<string>>();
    for (const r of sourceRows) {
      if (!r.docId) continue;
      if (!wantedByDoc.has(r.docId)) {
        wantedByDoc.set(r.docId, new Set());
        wantedNumericByDoc.set(r.docId, new Set());
      }
      for (const k of r.apnKeys) wantedByDoc.get(r.docId)!.add(k);
      if (r.numericApn) wantedNumericByDoc.get(r.docId)!.add(r.numericApn);
    }
    console.log(`Indexing ${wantedByDoc.size} parent workbooks...`);
    for (const [docId, wanted] of wantedByDoc) {
      const wb = indexParentWorkbook(cache, docId, wanted, wantedNumericByDoc.get(docId)!);
      parents.set(docId, wb);
      console.log(`  ${docId.slice(0, 10)} "${wb.title.slice(0, 60)}": ${wb.error ? `ERROR ${wb.error}` : `${wb.byApn.size} exact + ${wb.byZeroStripped.size} zero-padded of ${wanted.size} APN keys found in ${wb.tabs.length} tabs`}`);
    }
  }
  console.log(`Google API calls this run: ${cache.apiCalls}`);

  const stats = {
    propertiesCreated: 0,
    propertiesReusedDb: 0,
    propertiesReusedSheet: 0,
    rowsOnReusedDbProperty: 0,
    rowsOnReusedSheetProperty: 0,
    owners: 0,
    ownersReusedDb: 0,
    ownersReusedRun: 0,
    ownersMismatchedAddress: 0,
    ownerContactFilled: 0,
    propertyOwners: 0,
    mailingAddresses: 0,
    addressesParsedFromFull: 0,
    addressesFullUnparsed: 0,
    addressLine2Dropped: 0,
    campaigns: 0,
    mailings: 0,
    mailingsNoDate: 0,
    mailingsDuplicateSkipped: 0,
    mailingsSameCampaignDateOtherOwner: 0,
    unparsedMailDates: 0,
    suppressionsDoNotMail: 0,
    suppressionsBadAddress: 0,
    suppressionsExisting: 0,
    deals: 0,
    dealsLeads: 0,
    dealsDuplicateSkipped: 0,
    dealsHitDateFromMailDate: 0,
    dealsNoUsableDate: 0,
    sourceMetadata: 0,
    seedRowsSkipped: 0,
    seedOwnersReplaced: 0,
    sharedApnProperties: 0,
    repairRenamed: 0,
    repairRebuilt: 0,
    repairRebuiltInto: 0,
    countyStateBlank: 0,
    truncatedValues: 0,
    latLonFromConsolidatedText: 0,
    latLonFromParentColumn: 0,
    latLonFromParentText: 0,
    latLonParentAmbiguous: 0,
    latLonBackfilledExisting: 0,
    parentRowsMatched: 0,
    parentRowsMatchedZeroPadded: 0,
    parentRowsUnmatched: 0,
    rowsWithoutParentLink: 0,
    errors: 0,
  };
  const supplemented = new Map<string, number>();
  const hitTypeCounts = new Map<string, number>();
  const campaignMailings = new Map<string, number>();
  const campaignsCreatedNames = new Set<string>();
  const sharedApns: string[] = [];
  const seedSkips: string[] = [];
  const repairLog: string[] = [];
  const errorExamples: string[] = [];
  const rowStateCounty = new Map<string, number>();
  const parentMatchByDoc = new Map<string, { rows: number; matched: number; latLon: number }>();
  let summary = '';

  try {
    await rootDb.transaction(async (db) => {
      // ========== DATA SOURCE ==========
      console.log('Creating data source...');
      const dataSourceResult = await db.insert(dataSources).values({
        name: DATA_SOURCE_NAME,
        description: DATA_SOURCE_DESCRIPTION,
      }).onConflictDoUpdate({
        target: dataSources.name,
        set: { description: DATA_SOURCE_DESCRIPTION },
      }).returning();
      const dataSourceId = dataSourceResult[0].id;

      // ========== EXISTING STATE ==========
      console.log('Loading existing campaigns...');
      const campaignNameToId = new Map<string, number>();
      const existingCampaigns = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
      for (const c of existingCampaigns) {
        if (!campaignNameToId.has(c.name)) campaignNameToId.set(c.name, c.id);
      }
      const campaignIdToName = new Map<number, string>();
      for (const [name, id] of campaignNameToId) campaignIdToName.set(id, name);
      console.log(`Found ${existingCampaigns.length} existing campaigns`);

      // Campaign rule: the name is the row's Sheet Name, normalized.
      async function resolveCampaignId(sheetName: string, sheetLink: string): Promise<number> {
        const name = normalizeCampaignName(sheetName);
        const link = cleanSheetLink(sheetLink);
        if (campaignNameToId.has(name)) {
          return campaignNameToId.get(name)!;
        }
        const result = await db.insert(campaigns).values({
          name,
          link,
        }).returning();
        const id = result[0].id;
        campaignNameToId.set(name, id);
        campaignIdToName.set(id, name);
        campaignsCreatedNames.add(name);
        stats.campaigns++;
        return id;
      }

      // ========== REPAIR DAMAGED APNS FROM AN EARLIER RUN ==========
      // A property this importer created is checked against the true APNs of
      // the sheet rows recorded in its raw_data. Properties from any other
      // source are never touched.
      if (REPAIR_APNS) {
        console.log('Repairing properties created under a damaged APN...');
        const rowBySheetRow = new Map(sourceRows.map((r) => [r.sheetRow, r]));
        const mine = await db.select({
          id: properties.id, apn: properties.apn, state: properties.state, county: properties.county, rawData: properties.rawData,
        }).from(properties).where(eq(properties.dataSourceId, dataSourceId));
        const taken = new Set((await db.select({ apn: properties.apn, state: properties.state, county: properties.county }).from(properties))
          .map((p) => `${p.apn.trim().toUpperCase()}|${p.state ?? ''}|${p.county ?? ''}`));
        const purgeIds: number[] = [];
        for (const p of mine) {
          const sheetRows: number[] = ((p.rawData as any)?.[RAW_KEY]?.rows ?? []).map((r: any) => r.sheetRow);
          const rows = sheetRows.map((n) => rowBySheetRow.get(n)).filter((r): r is SourceRow => !!r);
          if (rows.length === 0) continue;
          const stored = p.apn.trim().toUpperCase();
          const trueApns = [...new Set(rows.map((r) => r.apn))];
          if (trueApns.length === 1 && trueApns[0] === stored) continue;
          const detail = `#${p.id} ${p.state}/${p.county} ${stored} -> ${trueApns.join(' | ')} (rows ${rows.map((r) => r.sheetRow).join(', ')})`;
          const key = `${trueApns[0]}|${p.state ?? ''}|${p.county ?? ''}`;
          if (trueApns.length === 1 && rows.length === sheetRows.length && !taken.has(key)) {
            await db.update(properties).set({ apn: trueApns[0] }).where(eq(properties.id, p.id));
            taken.add(key);
            stats.repairRenamed++;
            repairLog.push(`renamed  ${detail}`);
          } else {
            // Several parcels were merged into this property: its mailings
            // and owner links cannot be told apart, so it is rebuilt from
            // its rows by the import below.
            purgeIds.push(p.id);
            stats.repairRebuilt++;
            stats.repairRebuiltInto += trueApns.length;
            repairLog.push(`rebuilt  ${detail}`);
          }
        }
        for (let i = 0; i < purgeIds.length; i += 500) {
          const ids = purgeIds.slice(i, i + 500);
          // mailings/deals are ON DELETE SET NULL; the rest cascades.
          await db.delete(mailings).where(inArray(mailings.propertyId, ids));
          await db.delete(deals).where(inArray(deals.propertyId, ids));
          await db.delete(properties).where(inArray(properties.id, ids));
        }
        console.log(`  renamed ${stats.repairRenamed}, rebuilding ${stats.repairRebuilt} (into ${stats.repairRebuiltInto} parcels)`);
      }

      console.log('Loading existing properties...');
      interface PropState { id: number; state: string | null; county: string | null; hasLatLon: boolean; origin: 'db' | 'run' }
      // An APN is only unique within a county, so one APN can map to several
      // properties; findProperty picks the one in the row's state + county.
      const propsByApn = new Map<string, PropState[]>();
      const findProperty = (apn: string, location: { state: string | null; county: string | null }): PropState | undefined =>
        matchPropertyByLocation(propsByApn.get(apn) ?? [], location).match ?? undefined;
      const existingProps = await db.select({
        id: properties.id, apn: properties.apn, state: properties.state, county: properties.county, latitude: properties.latitude,
      }).from(properties);
      for (const p of existingProps) {
        const key = p.apn.trim().toUpperCase();
        if (!propsByApn.has(key)) propsByApn.set(key, []);
        propsByApn.get(key)!.push({ id: p.id, state: p.state, county: p.county, hasLatLon: p.latitude !== null, origin: 'db' });
      }
      console.log(`Found ${existingProps.length} existing properties`);

      // Owner identity rule (see scripts/owner-identity.ts): reuse an existing
      // owner ONLY when name + zip + full mailing address all match exactly.
      console.log('Loading existing owners...');
      const ownerIdentityToId = new Map<string, number>();
      const ownerNamesSeen = new Set<string>();
      const addressToId = new Map<string, number>();
      const ownerOrigin = new Map<number, 'db' | 'run'>();
      const ownerNeedsContact = new Set<number>();
      const seedOwnerIds = new Set<number>();
      const existingOwners = await db.select({
        id: owners.id,
        ownerName: owners.ownerName,
        phone: owners.phone,
        email: owners.email,
        mergedIntoId: owners.mergedIntoId,
        addressId: mailingAddresses.id,
        line1: mailingAddresses.addressLine1,
        line2: mailingAddresses.addressLine2,
        city: mailingAddresses.city,
        state: mailingAddresses.state,
        zip: mailingAddresses.zip,
      }).from(owners).leftJoin(mailingAddresses, eq(mailingAddresses.ownerId, owners.id));
      for (const o of existingOwners) {
        // An archived merge loser resolves to the owner it was merged into.
        const id = o.mergedIntoId ?? o.id;
        const key = ownerIdentityKey(o.ownerName, o);
        ownerOrigin.set(id, 'db');
        ownerNamesSeen.add(normalizeIdentityName(o.ownerName));
        if (!ownerIdentityToId.has(key)) ownerIdentityToId.set(key, id);
        if (o.addressId !== null && id === o.id) addressToId.set(`${id}|${key}`, o.addressId);
        if (!o.phone || !o.email) ownerNeedsContact.add(id);
        if (isSeedOwner(o.ownerName)) seedOwnerIds.add(id);
      }
      console.log(`Found ${ownerOrigin.size} existing owners`);

      const seedLinksByProperty = new Map<number, number[]>();
      if (seedOwnerIds.size > 0) {
        const links = await db.select().from(propertyOwners);
        for (const l of links) {
          if (!seedOwnerIds.has(l.ownerId)) continue;
          if (!seedLinksByProperty.has(l.propertyId)) seedLinksByProperty.set(l.propertyId, []);
          seedLinksByProperty.get(l.propertyId)!.push(l.ownerId);
        }
      }

      const mailingKey = (p: number, o: number, c: number, d: Date | null) => `${p}|${o}|${c}|${d ? d.getTime() : ''}`;
      const mailingKeys = new Set<string>();
      const mailingPropCampaignDate = new Set<string>();
      const existingMailings = await db.select({
        propertyId: mailings.propertyId, ownerId: mailings.ownerId, campaignId: mailings.campaignId, mailDate: mailings.mailDate,
      }).from(mailings);
      for (const m of existingMailings) {
        if (m.propertyId === null || m.ownerId === null || m.campaignId === null) continue;
        mailingKeys.add(mailingKey(m.propertyId, m.ownerId, m.campaignId, m.mailDate));
        mailingPropCampaignDate.add(`${m.propertyId}|${m.campaignId}|${m.mailDate ? m.mailDate.getTime() : ''}`);
      }

      const dealKeys = new Set<string>();
      const existingDeals = await db.select({ propertyId: deals.propertyId, ownerId: deals.ownerId, hitType: deals.hitType, hitDate: deals.hitDate }).from(deals);
      for (const d of existingDeals) dealKeys.add(`${d.propertyId}|${d.ownerId}|${d.hitType}|${d.hitDate.getTime()}`);

      const sourceMetaKeys = new Set<string>();
      const existingMeta = await db.select({ propertyId: sourceMetadata.propertyId, sourceId: sourceMetadata.sourceId, sourceLink: sourceMetadata.sourceLink }).from(sourceMetadata);
      for (const m of existingMeta) sourceMetaKeys.add(`${m.propertyId}|${m.sourceId}|${m.sourceLink}`);

      // A seed/test row never displaces or joins a real owner: it is only
      // imported when nothing real claims that APN, in the sheet or the DB.
      // (Compared on the APN as the sheet holds it: a seed row copies the
      // real row's cell, damaged or not.)
      const apnsWithRealOwner = new Set<string>();
      for (const r of sourceRows) if (!r.isSeed) apnsWithRealOwner.add(r.sheetApn);

      const touched = new Map<number, { rows: any[]; parent: any; latLonSource: string | null }>();

      // ========== ROWS ==========
      for (let batch = 0; batch * BATCH_SIZE < sourceRows.length; batch++) {
        const rows = sourceRows.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
        for (const row of rows) {
          await db.execute(sql`SAVEPOINT import_row`);
          try {
            const apn = row.apn;
            if (apn.length > 100) throw new Error('APN longer than 100 chars');

            // County/State: the row's own cells, nothing else.
            const state = row.get('State').toUpperCase() || null;
            const county = row.get('County') || null;
            if (state && state.length > 2) throw new Error(`State "${state}" is not a 2-letter code`);
            inc(rowStateCounty, `${state ?? '(blank)'}|${county ?? '(blank)'}`);
            if (!state || !county) stats.countyStateBlank++;

            const existing = findProperty(apn, { state, county });
            if (row.isSeed && (apnsWithRealOwner.has(row.sheetApn) || existing?.origin === 'db')) {
              stats.seedRowsSkipped++;
              seedSkips.push(`row ${row.sheetRow}: "${row.ownerName}" on APN ${apn} (${state}/${county})`);
              await db.execute(sql`RELEASE SAVEPOINT import_row`);
              continue;
            }

            // The same APN string in another county/state is a different
            // parcel: it gets its own property (unique on apn + state + county).
            const elsewhere = existing ? [] : (propsByApn.get(apn) ?? []).filter((p) => isDifferentLocation(p, { state, county }));
            if (elsewhere.length > 0) {
              stats.sharedApnProperties++;
              sharedApns.push(`row ${row.sheetRow}: APN ${apn} in ${state}/${county} is a separate parcel from ${elsewhere.map((p) => `#${p.id} ${p.state}/${p.county}`).join(', ')} | owner "${row.ownerName}" | ${normalizeCampaignName(row.get('Sheet Name'))}`);
            }

            // ========== PARENT SUPPLEMENT ==========
            const wb = row.docId ? parents.get(row.docId) : undefined;
            const parent = lookupParent(wb, row.apnKeys, row.numericApn);
            if (!row.docId) stats.rowsWithoutParentLink++;
            else {
              if (!parentMatchByDoc.has(row.docId)) parentMatchByDoc.set(row.docId, { rows: 0, matched: 0, latLon: 0 });
              const pm = parentMatchByDoc.get(row.docId)!;
              pm.rows++;
              if (parent) { pm.matched++; stats.parentRowsMatched++; } else stats.parentRowsUnmatched++;
              if (parent?.parentApn) stats.parentRowsMatchedZeroPadded++;
              if (parent?.lat != null) pm.latLon++;
            }
            const supplied: Record<string, string> = {};
            const fromParent = (field: SuppField, sheetValue: string): string => {
              if (sheetValue) return sheetValue;
              const v = parent?.fields[field];
              if (!v) return '';
              supplied[field] = v;
              inc(supplemented, field);
              return v;
            };

            const legalDescription = fromParent('legal', row.get('Legal Description'));
            const situsAddress = fromParent('situsAddress', row.get('Situs Address'));
            const situsCity = fromParent('situsCity', row.get('Situs City'));
            const acres = parseNumber(fromParent('acres', row.get('Acres')));
            let situsZip = fromParent('situsZip', '');
            if (/^\d{1,4}$/.test(situsZip)) situsZip = situsZip.padStart(5, '0');
            if (!/^\d{5}(-?\d{4})?$/.test(situsZip)) situsZip = '';

            // Lat/long: the row's own text first, then the parent workbook.
            let latLon: { lat: number; lon: number } | null = latLonFromText(row.get('Legal Description')) || latLonFromText(row.get('Situs Address'));
            let latLonSource: string | null = latLon ? 'consolidated legal/situs text' : null;
            if (!latLon && parent?.lat != null) {
              latLon = { lat: parent.lat, lon: parent.lon! };
              latLonSource = `parent ${parent.latLonFrom} (${parent.latLonTab})`;
            }
            if (!latLon && parent?.latLonAmbiguous) stats.latLonParentAmbiguous++;

            const mailDates: Date[] = [];
            for (const h of MAILING_DATE_HEADERS) {
              const v = row.get(h);
              if (!v) continue;
              const d = parseDate(v);
              if (d) mailDates.push(d); else stats.unparsedMailDates++;
            }

            // ========== PROPERTY ==========
            let propertyId: number;
            let prop: PropState;
            if (existing) {
              prop = existing;
              propertyId = existing.id;
              if (existing.origin === 'db') stats.rowsOnReusedDbProperty++; else stats.rowsOnReusedSheetProperty++;
              // Keep the existing property; only fill what it is missing.
              const setLatLon = latLon !== null && !existing.hasLatLon;
              await db.update(properties).set({
                state: sql`coalesce(${properties.state}, ${state})`,
                county: sql`coalesce(${properties.county}, ${clip(county, 100)})`,
                zip: sql`coalesce(${properties.zip}, ${situsZip || null})`,
                acres: sql`coalesce(${properties.acres}, ${acres}::numeric)`,
                legalDescription: sql`coalesce(${properties.legalDescription}, ${legalDescription || null})`,
                ...(setLatLon ? { latitude: latLon!.lat.toFixed(8), longitude: latLon!.lon.toFixed(8) } : {}),
              }).where(eq(properties.id, propertyId));
              if (setLatLon) {
                existing.hasLatLon = true;
                if (existing.origin === 'db') stats.latLonBackfilledExisting++;
              }
              if (!existing.state) existing.state = state;
              if (!existing.county) existing.county = county;
              if (!setLatLon) latLonSource = null;
            } else {
              if (county && county.length > 100) stats.truncatedValues++;
              const propertyResult = await db.insert(properties).values({
                apn: apn,
                state: state,
                county: clip(county, 100),
                zip: situsZip || null,
                latitude: latLon ? latLon.lat.toFixed(8) : null,
                longitude: latLon ? latLon.lon.toFixed(8) : null,
                acres: acres,
                legalDescription: legalDescription || null,
                dataSourceId: dataSourceId,
                sourceAcquiredDate: mailDates[0] ?? null,
              }).returning();
              propertyId = propertyResult[0].id;
              prop = { id: propertyId, state, county, hasLatLon: latLon !== null, origin: 'run' };
              if (!propsByApn.has(apn)) propsByApn.set(apn, []);
              propsByApn.get(apn)!.push(prop);
              stats.propertiesCreated++;
            }
            if (latLonSource) {
              if (latLonSource.startsWith('consolidated')) stats.latLonFromConsolidatedText++;
              else if (latLonSource.startsWith('parent column')) stats.latLonFromParentColumn++;
              else stats.latLonFromParentText++;
            }

            if (!touched.has(propertyId)) touched.set(propertyId, { rows: [], parent: null, latLonSource: null });
            const t = touched.get(propertyId)!;
            if (existing?.origin === 'db' && t.rows.length === 0) stats.propertiesReusedDb++;
            if (existing?.origin === 'run' && t.rows.length === 1) stats.propertiesReusedSheet++;
            // row.raw keeps the APN cell exactly as the sheet shows it.
            const rec = row.recovery?.status === 'recovered' ? row.recovery : null;
            t.rows.push({
              sheetRow: row.sheetRow,
              ...(apn !== (row.raw['APN'] ?? '').toUpperCase() ? { apnResolved: apn } : {}),
              ...(rec ? { apnRecovery: { sheetValue: row.sheetApn, recovered: rec.apn, how: rec.how, matchedBy: rec.matchedBy, workbookId: rec.workbookId, workbook: rec.workbook, tab: rec.tab, row: rec.row, column: rec.column } } : {}),
              ...row.raw,
            });
            if (latLonSource) t.latLonSource = latLonSource;
            if (parent && (Object.keys(supplied).length > 0 || latLonSource?.startsWith('parent') || parent.parentApn)) {
              t.parent = { workbookId: row.docId, workbook: wb!.title, tab: parent.tab, ...(parent.parentApn ? { parentApn: parent.parentApn } : {}), supplied: { ...(t.parent?.supplied ?? {}), ...supplied } };
            }

            // ========== OWNER - resolve by name + zip + full mailing address ==========
            const ownerName = clip(row.ownerName, 255)!;
            let addr: ParsedAddress = {
              line1: row.get('Mailing Address 1') || null,
              line2: row.get('Mailing Address 2') || null,
              city: row.get('Mailing City') || null,
              state: row.get('Mailing State').toUpperCase() || null,
              zip: row.get('Mailing Zip') || null,
              parsed: true,
            };
            if (!addr.line1 && !addr.city && row.get('Full Mailing Address')) {
              const parsed = parseFullAddress(row.get('Full Mailing Address'));
              if (parsed) {
                addr = { ...parsed, zip: parsed.zip ?? addr.zip };
                if (parsed.parsed) stats.addressesParsedFromFull++; else stats.addressesFullUnparsed++;
              }
            }
            if (addr.state && !/^[A-Z]{2}$/.test(addr.state)) addr.state = null;
            addr.line1 = clip(addr.line1, 255);
            addr.city = clip(addr.city, 100);
            addr.zip = clip(addr.zip, 20);
            const rawLine2 = clip(addr.line2, 255);
            // The sheet's "Mailing Address 2" is usually a copy of line 1 or
            // of the state code; that is not a second address line.
            if (addr.line2 && (addr.line2.toLowerCase() === (addr.line1 ?? '').toLowerCase() || addr.line2.toUpperCase() === addr.state)) {
              addr.line2 = null;
              stats.addressLine2Dropped++;
            } else {
              addr.line2 = rawLine2;
            }

            let identityKey = ownerIdentityKey(ownerName, addr);
            const rawIdentityKey = ownerIdentityKey(ownerName, { ...addr, line2: rawLine2 });
            if (!ownerIdentityToId.has(identityKey) && ownerIdentityToId.has(rawIdentityKey)) identityKey = rawIdentityKey;
            const normalizedName = normalizeIdentityName(ownerName);
            const phone = clip(fromParent('phone', row.get('Owner Phone')), 50);
            const email = clip(fromParent('email', row.get('Owner Email')), 255);

            let ownerId: number;
            if (ownerIdentityToId.has(identityKey)) {
              ownerId = ownerIdentityToId.get(identityKey)!;
              if (ownerOrigin.get(ownerId) === 'db') stats.ownersReusedDb++; else stats.ownersReusedRun++;
              if ((phone || email) && ownerNeedsContact.has(ownerId)) {
                await db.update(owners).set({
                  phone: sql`coalesce(${owners.phone}, ${phone || null})`,
                  email: sql`coalesce(${owners.email}, ${email || null})`,
                }).where(eq(owners.id, ownerId));
                stats.ownerContactFilled++;
              }
            } else {
              if (ownerNamesSeen.has(normalizedName)) {
                stats.ownersMismatchedAddress++;
              }
              const ownerResult = await db.insert(owners).values({
                firstName: clip(row.get('Owner First Name') || null, 100),
                lastName: clip(row.get('Owner Last Name') || null, 100),
                ownerName: ownerName,
                ownerType: getOwnerType(ownerName),
                phone: phone || null,
                email: email || null,
                rawData: {
                  [RAW_KEY]: {
                    sheetRow: row.sheetRow,
                    ...Object.fromEntries(Object.entries(row.raw).filter(([h]) => /^(Owner |Full Mailing Address|Mailing )/.test(h))),
                  },
                },
              }).returning();
              ownerId = ownerResult[0].id;
              ownerIdentityToId.set(identityKey, ownerId);
              ownerNamesSeen.add(normalizedName);
              ownerOrigin.set(ownerId, 'run');
              if (!phone || !email) ownerNeedsContact.add(ownerId);
              stats.owners++;
            }

            // A real owner is taking over a property a seed/test owner
            // previously claimed in the DB: purge the seed owner's links.
            if (!row.isSeed && seedLinksByProperty.has(propertyId)) {
              for (const seedOwnerId of seedLinksByProperty.get(propertyId)!) {
                if (seedOwnerId === ownerId) continue;
                await deleteSeedOwnerLinksForProperty(db, propertyId, seedOwnerId);
                stats.seedOwnersReplaced++;
              }
              seedLinksByProperty.delete(propertyId);
            }

            // ========== PROPERTY_OWNERS ==========
            const linkResult = await db.insert(propertyOwners).values({
              propertyId: propertyId,
              ownerId: ownerId,
            }).onConflictDoNothing().returning();
            stats.propertyOwners += linkResult.length;

            // ========== MAILING ADDRESS ==========
            let mailingAddressId: number | null = null;
            if (addr.line1 || addr.city || addr.zip) {
              const addressKey = `${ownerId}|${identityKey}`;
              if (addressToId.has(addressKey)) {
                mailingAddressId = addressToId.get(addressKey)!;
              } else {
                const addressResult = await db.insert(mailingAddresses).values({
                  ownerId: ownerId,
                  addressLine1: addr.line1,
                  addressLine2: addr.line2,
                  city: addr.city,
                  state: addr.state,
                  zip: addr.zip,
                }).returning();
                mailingAddressId = addressResult[0].id;
                addressToId.set(addressKey, mailingAddressId);
                stats.mailingAddresses++;
              }
            }

            // ========== MAILINGS ==========
            // One mailing per mailing date; a priced row with no date still
            // gets a (dateless) mailing, as in the 2026 importer.
            const offerPrice = parseNumber(row.get('Offer Price'));
            const mailingDates: (Date | null)[] = mailDates.length > 0 ? mailDates : (offerPrice ? [null] : []);
            if (mailingDates.length > 0) {
              const campaignId = await resolveCampaignId(row.get('Sheet Name'), row.get('Sheet Link'));
              for (const mailDate of mailingDates) {
                const key = mailingKey(propertyId, ownerId, campaignId, mailDate);
                if (mailingKeys.has(key)) {
                  stats.mailingsDuplicateSkipped++;
                  continue;
                }
                const pcd = `${propertyId}|${campaignId}|${mailDate ? mailDate.getTime() : ''}`;
                if (mailingPropCampaignDate.has(pcd)) stats.mailingsSameCampaignDateOtherOwner++;
                await db.insert(mailings).values({
                  propertyId: propertyId,
                  ownerId: ownerId,
                  mailingAddressId: mailingAddressId,
                  campaignId: campaignId,
                  mailDate: mailDate,
                  offerPrice: offerPrice,
                });
                mailingKeys.add(key);
                mailingPropCampaignDate.add(pcd);
                stats.mailings++;
                if (!mailDate) stats.mailingsNoDate++;
                inc(campaignMailings, campaignIdToName.get(campaignId)!);
              }
            }

            // ========== MAILING SUPPRESSION ==========
            const doNotMail = parseBoolean(row.get('Mail Exclusion'));
            const badAddress = /^yes/i.test(row.get('Bad Address')) || parseBoolean(row.get('Bad Address'));
            if (doNotMail || badAddress) {
              const result = await db.insert(mailingSuppression).values({
                ownerId: ownerId,
                propertyId: propertyId,
                reason: doNotMail ? 'do_not_mail' : 'bad_address',
              }).onConflictDoNothing().returning();
              if (result.length === 0) stats.suppressionsExisting++;
              else if (doNotMail) stats.suppressionsDoNotMail++;
              else stats.suppressionsBadAddress++;
            }

            // ========== DEALS ==========
            const hitTypeRaw = row.get('Hit Type');
            const hitDateRaw = row.get('Hit Date');
            const isLead = parseBoolean(row.get('Prospect'));
            if (hitTypeRaw || hitDateRaw || isLead) {
              const hitType = mapHitType(hitTypeRaw);
              // deals.hit_date is NOT NULL. A hit with no usable date falls
              // back to the mailing it answers rather than to "now".
              let hitDate = parseDate(hitDateRaw);
              if (!hitDate && mailDates[0]) {
                hitDate = mailDates[0];
                stats.dealsHitDateFromMailDate++;
              }
              if (!hitDate) {
                stats.dealsNoUsableDate++;
              } else {
                const key = `${propertyId}|${ownerId}|${hitType}|${hitDate.getTime()}`;
                if (dealKeys.has(key)) {
                  stats.dealsDuplicateSkipped++;
                } else {
                  await db.insert(deals).values({
                    propertyId: propertyId,
                    ownerId: ownerId,
                    hitType: hitType,
                    hitDate: hitDate,
                    isLead: isLead,
                    isConversion: false,
                  });
                  dealKeys.add(key);
                  stats.deals++;
                  if (isLead) stats.dealsLeads++;
                  inc(hitTypeCounts, `${hitTypeRaw || '(blank)'} -> ${hitType}`);
                }
              }
            }

            // ========== SOURCE METADATA ==========
            if (row.get('Sheet Link')) {
              const key = `${propertyId}|${dataSourceId}|${row.get('Sheet Link')}`;
              if (!sourceMetaKeys.has(key)) {
                await db.insert(sourceMetadata).values({
                  propertyId: propertyId,
                  sourceId: dataSourceId,
                  sourceLink: row.get('Sheet Link'),
                });
                sourceMetaKeys.add(key);
                stats.sourceMetadata++;
              }
            }

            await db.execute(sql`RELEASE SAVEPOINT import_row`);
          } catch (rowError: any) {
            await db.execute(sql`ROLLBACK TO SAVEPOINT import_row`);
            console.error(`  Error processing row ${row.sheetRow} (APN ${row.apn}): ${rowError.message}`);
            if (errorExamples.length < 20) errorExamples.push(`row ${row.sheetRow} APN ${row.apn}: ${rowError.message.slice(0, 200)}`);
            stats.errors++;
          }
        }
        console.log(`  Batch ${batch + 1} complete. Props: ${stats.propertiesCreated}, Owners: ${stats.owners}, Mailings: ${stats.mailings}`);
      }

      // ========== RAW DATA ==========
      // Every source column of every row, verbatim, merged under one key so
      // a property's pre-existing raw_data is preserved.
      console.log(`Writing raw_data for ${touched.size} properties...`);
      for (const [propertyId, t] of touched) {
        const payload = { [RAW_KEY]: { spreadsheetId: SHEET_ID, tab: MASTER_TAB, rows: t.rows, ...(t.parent ? { parent: t.parent } : {}), ...(t.latLonSource ? { latLongSource: t.latLonSource } : {}) } };
        await db.update(properties).set({
          rawData: sql`coalesce(${properties.rawData}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
        }).where(eq(properties.id, propertyId));
      }

      // ========== SUMMARY ==========
      const ids = [...touched.keys()];
      const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
      const coverage = ids.length === 0 ? { total: 0, with_latlon: 0, with_zip: 0, with_legal: 0, with_county: 0, with_state: 0 } : (await db.execute(sql`
        select count(*)::int total,
               count(*) filter (where latitude is not null and longitude is not null)::int with_latlon,
               count(*) filter (where zip is not null)::int with_zip,
               count(*) filter (where legal_description is not null)::int with_legal,
               count(*) filter (where county is not null)::int with_county,
               count(*) filter (where state is not null)::int with_state
        from properties where id in (${idList})`)).rows[0] as any;
      const stateDist = ids.length === 0 ? [] : (await db.execute(sql`
        select coalesce(state, '(null)') state, count(*)::int n, count(*) filter (where latitude is not null)::int ll
        from properties where id in (${idList}) group by 1 order by 2 desc`)).rows as any[];
      const countyDist = ids.length === 0 ? [] : (await db.execute(sql`
        select coalesce(state, '(null)') state, coalesce(county, '(null)') county, count(*)::int n, count(*) filter (where latitude is not null)::int ll
        from properties where id in (${idList}) group by 1, 2 order by 3 desc`)).rows as any[];
      const totals = (await db.execute(sql`
        select (select count(*) from properties)::int properties, (select count(*) from owners)::int owners,
               (select count(*) from mailing_addresses)::int mailing_addresses, (select count(*) from mailings)::int mailings,
               (select count(*) from campaigns)::int campaigns, (select count(*) from deals)::int deals,
               (select count(*) from mailing_suppression)::int mailing_suppression, (select count(*) from property_owners)::int property_owners,
               (select count(*) from source_metadata)::int source_metadata,
               (select count(*) from properties where latitude is not null)::int properties_with_latlon`)).rows[0] as any;

      const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
      const L: string[] = [];
      L.push(`2025 CONSOLIDATED MAILING LIST IMPORT - SUMMARY${DRY_RUN ? ' (DRY RUN - ROLLED BACK)' : ''}`);
      L.push(`Run at: ${new Date().toISOString()}`);
      L.push(`Database: ${new URL(DATABASE_URL).hostname}${new URL(DATABASE_URL).pathname} (local)`);
      L.push(`Source: spreadsheet ${SHEET_ID}, tab '${MASTER_TAB}' (${masterTab.rows} grid rows x ${masterTab.cols} cols)`);
      L.push(`Data source: ${DATA_SOURCE_NAME} (id ${dataSourceId})`);
      L.push('');
      L.push('== ROWS ==');
      L.push(`Data rows parsed (non-empty):            ${rowsParsed}`);
      L.push(`  imported:                              ${rowsParsed - rowsNoApn - stats.seedRowsSkipped - stats.errors}`);
      L.push(`  skipped - no APN:                      ${rowsNoApn}  (see NOT IMPORTED)`);
      L.push(`  skipped - seed/test owner row:         ${stats.seedRowsSkipped}  (Alex Ressi / Rocket Print rows on an APN a real owner holds)`);
      L.push(`  errors:                                ${stats.errors}`);
      L.push('');
      L.push('== PROPERTIES ==');
      L.push(`Created:                                 ${stats.propertiesCreated}`);
      L.push(`Reused - already in local DB:            ${stats.propertiesReusedDb} properties (${stats.rowsOnReusedDbProperty} rows)`);
      L.push(`Reused - APN repeated within the sheet:  ${stats.propertiesReusedSheet} properties (${stats.rowsOnReusedSheetProperty} extra rows)`);
      L.push(`Distinct properties touched:             ${touched.size}`);
      L.push(`APNs restored from unformatted values:   ${apnFromUnformatted}  (number-formatted cells, e.g. 290280136.1 -> 290280136.11)`);
      L.push(`APNs with digits lost in the source:     ${precisionLostApns}  (sci-notation cells like 1.30E+11 -> 130201000000; real APN not recoverable from the tab - see APN RECOVERY)`);
      L.push(`Same APN, different county -> own property: ${stats.sharedApnProperties}  (see SHARED APNS)`);
      L.push('');
      L.push('== APN RECOVERY (from parent workbooks) ==');
      L.push(`APNs recovered: ${recoveryLog.length}  (the damaged sheet value is kept in raw_data.${RAW_KEY}.rows[].apnRecovery)`);
      for (const [k, n] of [...recoveryCounts].sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(5)}  ${k}`);
      L.push('  recovered     = the parent holds a different, numerically consistent APN on the row with the same owner (+ address)');
      L.push('  confirmed     = the parent holds the same APN as text');
      L.push('  parent_numeric= the parent holds the same value as a NUMBER too, so nothing better exists to recover');
      L.push('  no_parent_row = no parent row with this owner; no_parent_link = the row has no Sheet Link');
      const unrecoveredTotal = [...unrecoveredNumeric.values()].reduce((s, u) => s + u.n, 0);
      L.push(`Number-typed APNs no parent text could vouch for: ${unrecoveredTotal}  (imported with the sheet's value; leading zeros / trailing digits may be missing)`);
      for (const [k, u] of [...unrecoveredNumeric].sort((a, b) => b[1].n - a[1].n)) L.push(`  ${String(u.n).padStart(5)}  ${k}  e.g. ${u.examples.join(', ')}`);
      if (REPAIR_APNS) {
        L.push('');
        L.push('== REPAIR OF EARLIER-RUN PROPERTIES (--repair-apns) ==');
        L.push(`Renamed in place (all rows share one true APN):       ${stats.repairRenamed}`);
        L.push(`Rebuilt (several parcels had been merged into one):   ${stats.repairRebuilt} properties -> ${stats.repairRebuiltInto} parcels`);
      }
      L.push('');
      L.push('== OWNERS / ADDRESSES ==');
      L.push(`Owners created:                          ${stats.owners}`);
      L.push(`Owners reused - already in local DB:     ${stats.ownersReusedDb}`);
      L.push(`Owners reused - earlier in this run:     ${stats.ownersReusedRun}`);
      L.push(`Created despite name match (other addr): ${stats.ownersMismatchedAddress}`);
      L.push(`Property-owner links created:            ${stats.propertyOwners}`);
      L.push(`Mailing addresses created:               ${stats.mailingAddresses}`);
      L.push(`  parsed from 'Full Mailing Address':    ${stats.addressesParsedFromFull}  (unparseable, stored whole in line 1: ${stats.addressesFullUnparsed})`);
      L.push(`  'Mailing Address 2' dropped as junk:   ${stats.addressLine2Dropped}  (copy of line 1 or of the state code; verbatim value kept in raw_data)`);
      L.push(`Seed owners replaced by real owners:     ${stats.seedOwnersReplaced}`);
      L.push('');
      L.push('== MAILINGS / CAMPAIGNS ==');
      L.push(`Mailings created:                        ${stats.mailings}  (${stats.mailingsNoDate} priced rows with no mailing date)`);
      L.push(`Duplicate mailings skipped:              ${stats.mailingsDuplicateSkipped}  (same property + owner + campaign + mail date)`);
      L.push(`Same campaign+date, different owner:     ${stats.mailingsSameCampaignDateOtherOwner}  (kept - a different person was mailed)`);
      L.push(`Unparseable mailing dates:               ${stats.unparsedMailDates}  (e.g. "Skipped"; kept in raw_data)`);
      L.push(`Campaigns created:                       ${stats.campaigns}  (campaigns reused: ${campaignMailings.size - [...campaignMailings.keys()].filter((n) => campaignsCreatedNames.has(n)).length})`);
      L.push('Mailings per campaign (this run):');
      for (const [name, n] of [...campaignMailings].sort((a, b) => b[1] - a[1])) {
        L.push(`  ${String(n).padStart(5)}  ${name}${campaignsCreatedNames.has(name) ? '' : '  [existing campaign]'}`);
      }
      L.push('');
      L.push('== SUPPRESSIONS / HITS ==');
      L.push(`Suppressions created:                    ${stats.suppressionsDoNotMail + stats.suppressionsBadAddress}  (do_not_mail ${stats.suppressionsDoNotMail}, bad_address ${stats.suppressionsBadAddress}; already present ${stats.suppressionsExisting})`);
      L.push(`Deals (hits) created:                    ${stats.deals}  (leads/prospects: ${stats.dealsLeads}; duplicates skipped: ${stats.dealsDuplicateSkipped})`);
      L.push(`  hit date missing -> used mailing date: ${stats.dealsHitDateFromMailDate}`);
      L.push(`  hit rows with no usable date at all:   ${stats.dealsNoUsableDate}`);
      for (const [k, n] of [...hitTypeCounts].sort((a, b) => b[1] - a[1])) L.push(`  ${String(n).padStart(5)}  ${k}`);
      L.push(`Source metadata rows created:            ${stats.sourceMetadata}`);
      L.push('');
      L.push('== LAT/LONG ==');
      L.push(`COVERAGE: ${coverage.with_latlon} of ${coverage.total} properties touched by this import have latitude/longitude = ${pct(coverage.with_latlon, coverage.total)}`);
      L.push(`  from the consolidated row's own Legal Description/Situs text: ${stats.latLonFromConsolidatedText}`);
      L.push(`  from a parent workbook lat/long column (matched by APN):      ${stats.latLonFromParentColumn}`);
      L.push(`  from parent workbook legal-description text:                  ${stats.latLonFromParentText}`);
      L.push(`  (of the above, backfilled onto pre-existing DB properties:    ${stats.latLonBackfilledExisting})`);
      L.push(`  skipped - parent tabs disagree on coordinates for the APN:    ${stats.latLonParentAmbiguous}`);
      L.push(`Whole local DB: ${totals.properties_with_latlon} of ${totals.properties} properties have lat/long = ${pct(totals.properties_with_latlon, totals.properties)}`);
      L.push('');
      L.push('== PARENT WORKBOOKS ==');
      L.push(`Rows with a Sheet Link: ${stats.parentRowsMatched + stats.parentRowsUnmatched}; APN found in parent: ${stats.parentRowsMatched} (${pct(stats.parentRowsMatched, stats.parentRowsMatched + stats.parentRowsUnmatched)}); rows with no link: ${stats.rowsWithoutParentLink}`);
      L.push(`  of those matches, ${stats.parentRowsMatchedZeroPadded} needed leading zeros restored (the sheet stored the APN as a number, e.g. 66116 = parent "0066116"; parent form kept in raw_data.parent.parentApn)`);
      L.push(`Blank consolidated fields filled from parents: ${[...supplemented].map(([f, n]) => `${f} ${n}`).join(', ') || 'none'}`);
      L.push('Per workbook (rows -> APN matched -> with lat/long | tabs ranked by matched APNs):');
      for (const [docId, pm] of [...parentMatchByDoc].sort((a, b) => b[1].rows - a[1].rows)) {
        const wb = parents.get(docId);
        L.push(`  ${docId}  "${(wb?.title ?? '').slice(0, 70)}"`);
        L.push(`    rows ${pm.rows} -> matched ${pm.matched} -> lat/long ${pm.latLon}${wb?.error ? `  ERROR: ${wb.error}` : ''}`);
        for (const tab of (wb?.tabs ?? []).filter((x) => x.matchedApns > 0).slice(0, 4)) {
          L.push(`      [${tab.tab}] header row ${tab.headerRow}, ${tab.matchedApns} APNs matched, lat/long ${tab.hasLatLon ? `columns (${tab.latLonRows} rows)` : tab.latLonRows > 0 ? `in legal text (${tab.latLonRows} rows)` : 'none'}`);
        }
        if (wb && !wb.error && !wb.tabs.some((x) => x.matchedApns > 0)) L.push('      (no tab contains these APNs)');
      }
      L.push('');
      L.push('== FIELD COVERAGE (properties touched) ==');
      L.push(`state ${pct(coverage.with_state, coverage.total)}, county ${pct(coverage.with_county, coverage.total)}, legal_description ${pct(coverage.with_legal, coverage.total)}, zip (situs, parent-only) ${pct(coverage.with_zip, coverage.total)}, lat/long ${pct(coverage.with_latlon, coverage.total)}`);
      L.push(`Rows whose County/State cell is blank or a sheet error (#N/A): ${stats.countyStateBlank} - stored as NULL, never inferred`);
      L.push('');
      L.push('== STATE DISTRIBUTION (properties touched; with lat/long) ==');
      for (const s of stateDist) L.push(`  ${String(s.n).padStart(5)}  ${s.state}  (${s.ll} with lat/long)`);
      L.push('');
      L.push('== COUNTY/STATE DISTRIBUTION (properties touched; county exactly as written in the sheet) ==');
      for (const c of countyDist) L.push(`  ${String(c.n).padStart(5)}  ${c.state} | ${c.county}  (${c.ll} with lat/long)`);
      L.push('');
      L.push('== SOURCE COLUMN MAPPING / UNMAPPED DELTA ==');
      L.push('Every non-empty cell of every row is preserved verbatim in properties.raw_data.consolidated_2025.rows[].');
      for (const h of headers) {
        if (!h) continue;
        const tgt = COLUMN_TARGETS[h];
        L.push(`  ${tgt ? (tgt.typed ? 'MAPPED  ' : 'UNMAPPED') : 'UNMAPPED'}  ${h.padEnd(22)} filled ${String(filledByHeader.get(h) || 0).padStart(5)}  -> ${tgt ? tgt.target : 'UNKNOWN HEADER - properties.raw_data only'}`);
      }
      const unmapped = headers.filter((h) => h && !(COLUMN_TARGETS[h]?.typed));
      L.push(`UNMAPPED DELTA (no typed schema column; raw_data only): ${unmapped.map((h) => `${h} (${filledByHeader.get(h) || 0} filled)`).join(', ') || 'none'}`);
      L.push(`Headers expected but absent from the sheet: ${missingHeaders.join(', ') || 'none'}`);
      L.push(`Headers in the sheet the importer does not know: ${unknownHeaders.join(', ') || 'none'}`);
      L.push(`Cells beyond the header row (trailing columns): ${[...filledByHeader.keys()].filter((k) => k.startsWith('(column')).map((k) => `${k} ${filledByHeader.get(k)}`).join(', ') || 'none'}`);
      L.push(`Spreadsheet error cells treated as blank: ${[...sheetErrorCells].map(([h, n]) => `${h} ${n}`).join(', ') || 'none'}`);
      L.push('');
      L.push('== SHARED APNS (same APN string, different county/state = different parcel) ==');
      L.push(`${stats.sharedApnProperties} properties created alongside a same-APN property elsewhere (properties are unique on apn + state + county).`);
      for (const c of sharedApns) L.push(`  - ${c}`);
      L.push('');
      L.push('== NOT IMPORTED ==');
      L.push(`Rows with no APN: ${rowsNoApn}`);
      for (const e of noApnRows) L.push(`  - ${e}`);
      L.push(`Seed/test rows on an APN a real owner holds (intentional): ${stats.seedRowsSkipped}`);
      for (const e of seedSkips) L.push(`  - ${e}`);
      L.push(`Row errors: ${stats.errors}`);
      for (const e of errorExamples) L.push(`  - ${e}`);
      L.push('');
      L.push('== APN RECOVERY LOG (sheet row: sheet value -> recovered APN | how | where | owner | parent workbook [tab] row) ==');
      for (const e of recoveryLog) L.push(`  ${e}`);
      if (repairLog.length > 0) {
        L.push('');
        L.push('== REPAIR LOG ==');
        for (const e of repairLog) L.push(`  ${e}`);
      }
      L.push('');
      L.push('== LOCAL DB TOTALS AFTER IMPORT ==');
      L.push(Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', '));
      summary = L.join('\n') + '\n';

      if (DRY_RUN) throw new DryRunRollback();
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
    console.log('\nDry run: transaction rolled back, nothing was written.');
  }

  const summaryPath = DRY_RUN ? SUMMARY_PATH.replace(/\.txt$/, '.dryrun.txt') : SUMMARY_PATH;
  fs.writeFileSync(summaryPath, summary);
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(summary);
  console.log(`Summary written to ${summaryPath}`);

  await pool.end();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
