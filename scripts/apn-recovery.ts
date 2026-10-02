// Recovers the true APN of a consolidated-sheet row from its parent workbook.
//
// The consolidated tabs store some APNs as numbers, which damages them:
//   * leading zeros are dropped              ("004399"          -> 4399)
//   * long APNs are rounded                  ("0130201000603"   -> 1.30E+11 = 130201000000)
//   * decimals are rounded                   (290122262.007     -> 290122262.01)
//   * letters are read as an exponent        ("464E222"         -> 4.64E+224)
// The parent workbook (the row's Sheet Link) usually still holds the real
// APN. A parent APN is only accepted when it is numerically consistent with
// the damaged value AND the parent row is tied to the consolidated row: by
// owner + mailing address, else by owner (+ acres/offer price when digits
// were lost), else by being the only APN in the whole workbook that fits.
// Nothing is guessed: a row with no such parent APN keeps its consolidated
// value and is reported.

import { GogSheetsCache } from './gog-sheets-cache';

export const APN_HEADER_ALIASES = ['apn', 'parcel', 'parcel number', 'parcel id', 'parcel no', 'pin', 'apn formatted', 'apn unformatted', 'alternate apn', 'raw parcel number', 'parcel number pin', 'old parcel', 'aprdistacc'];
const HEADER_SCAN_ROWS = 15;

export type RecoveryStatus =
  | 'recovered'        // the parent APN differs from the consolidated value and is provably the same APN
  | 'confirmed'        // the parent holds the consolidated value as text
  | 'parent_numeric'   // the parent holds the same number, not text: nothing better to recover
  | 'ambiguous'        // several parent APNs fit and nothing tells them apart
  | 'no_parent_apn'    // the parent row was found but no APN on it fits the consolidated value
  | 'no_parent_row'    // nothing in the parent workbook ties to this row
  | 'no_parent_link';

export type RecoveryHow = 'leading_zeros' | 'precision' | 'exponent' | 'not_an_apn' | 'identical';

export interface RecoveryInput {
  sheetRow: number;
  apn: string;              // the importer's resolved APN (upper-cased)
  unformattedApn: any;
  docId: string | null;
  ownerLastName: string;
  ownerName: string;
  addressLine1: string;     // 'Mailing Address 1', else the first line of 'Full Mailing Address'
  acres: string;
  offerPrice: string;
}

export interface ApnRecovery {
  status: RecoveryStatus;
  apn: string | null;       // the recovered APN (status 'recovered'), else null
  how: RecoveryHow | null;
  matchedBy: 'owner+address' | 'owner' | 'apn' | null;
  workbookId: string | null;
  workbook: string | null;
  tab: string | null;
  row: number | null;       // 1-based row in the parent tab
  column: string | null;
  note: string | null;
}

interface ParentRow {
  tab: string;
  tabRank: number;
  row: number;
  apns: { column: string; value: any }[];
  acres: number | null;
  offer: number | null;
}

interface WorkbookIndex {
  title: string;
  error: string | null;
  byAddress: Map<string, ParentRow[]>;
  byName: Map<string, ParentRow[]>;
  byNumber: Map<number, ParentRow[]>;   // Number(apn) -> rows, for every purely numeric-looking APN
  rounded: Map<string, ParentRow[]>;    // `${digit count}:${first 3 digits}` -> rows with a long digit APN
}

function norm(v: any): string {
  return (v ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}

function normHeader(v: any): string {
  return (v ?? '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function num(v: any): number | null {
  const n = parseFloat((v ?? '').toString().replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function decimals(n: number): number {
  const s = String(n);
  return s.includes('.') && !/e/i.test(s) ? s.length - s.indexOf('.') - 1 : 0;
}

// How an APN from the parent relates to the number the consolidated cell
// holds. null = not the same APN. `strict` is for parent rows that are not
// tied to the consolidated row by owner + address.
export function matchDamagedApn(parent: string | number, damaged: number, strict = true): RecoveryHow | null {
  if (typeof parent === 'number') {
    if (parent === damaged) return 'identical';
    // 290122262.007 shown (and copied) as 290122262.01, or as 290122262
    const d = decimals(damaged);
    if ((d > 0 || !strict) && decimals(parent) > d && Number(parent.toFixed(d)) === damaged) return 'precision';
    return null;
  }
  const s = parent.trim();
  if (!s) return null;
  if (s === String(damaged)) return 'identical';
  if (/^\d+(\.\d+)?$/.test(s)) {
    if (Number(s) === damaged && s.replace(/^0+/, '').length <= 15) return /^0/.test(s) ? 'leading_zeros' : null;
    // Rounded: same number of digits, and the parent value rounds to the
    // damaged value's significant digits.
    const digits = s.replace(/^0+/, '');
    const dmg = String(damaged);
    if (/^\d+$/.test(digits) && /^\d+$/.test(dmg) && digits.length === dmg.length) {
      const sig = dmg.replace(/0+$/, '');
      if (sig.length >= (strict ? 3 : 2) && sig.length < dmg.length && Number(digits).toPrecision(sig.length).replace(/e.*$/, '').replace('.', '') === sig) return 'precision';
    }
    return null;
  }
  // "464E222" read as 4.64e+224
  if (/^\d+E\d+$/i.test(s) && Number(s) === damaged) return 'exponent';
  return null;
}

function roundedKey(digits: string): string {
  return `${digits.length}:${digits.slice(0, 3)}`;
}

function push<K>(map: Map<K, ParentRow[]>, key: K, row: ParentRow): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(row);
}

export class ApnRecoverer {
  private workbooks = new Map<string, WorkbookIndex>();

  constructor(private cache: GogSheetsCache, rows: RecoveryInput[]) {
    const wanted = new Map<string, { addresses: Set<string>; names: Set<string> }>();
    for (const r of rows) {
      if (!r.docId) continue;
      if (!wanted.has(r.docId)) wanted.set(r.docId, { addresses: new Set(), names: new Set() });
      const w = wanted.get(r.docId)!;
      if (r.addressLine1) w.addresses.add(norm(r.addressLine1));
      for (const n of [r.ownerLastName, r.ownerName]) if (norm(n).length >= 3) w.names.add(norm(n));
    }
    for (const [docId, w] of wanted) this.workbooks.set(docId, this.indexWorkbook(docId, w.addresses, w.names));
  }

  private indexWorkbook(docId: string, addresses: Set<string>, names: Set<string>): WorkbookIndex {
    const wb: WorkbookIndex = { title: '', error: null, byAddress: new Map(), byName: new Map(), byNumber: new Map(), rounded: new Map() };
    let tabs;
    try {
      const meta = this.cache.metadata(docId);
      wb.title = meta.title;
      tabs = meta.tabs.filter((t) => t.isGrid);
    } catch (e: any) {
      wb.error = e.message.slice(0, 200);
      return wb;
    }
    const perTab: { tied: number; rows: ParentRow[] }[] = [];
    for (const tab of tabs) {
      let values: any[][];
      try {
        values = this.cache.tabValues(docId, tab, 'UNFORMATTED_VALUE');
      } catch {
        continue;
      }
      let headerRow = -1;
      let apnCols: number[] = [];
      let best = 0;
      for (let r = 0; r < Math.min(HEADER_SCAN_ROWS, values.length); r++) {
        const cols: number[] = [];
        (values[r] ?? []).forEach((cell, c) => { if (APN_HEADER_ALIASES.includes(normHeader(cell))) cols.push(c); });
        const filled = (values[r] ?? []).filter((cell) => norm(cell)).length;
        if (cols.length > 0 && filled > best) { headerRow = r; apnCols = cols; best = filled; }
      }
      if (headerRow < 0) continue;
      const header = (values[headerRow] ?? []).map((h) => (h ?? '').toString().trim());
      const colOf = (wantedHeaders: string[]) => header.findIndex((h) => wantedHeaders.includes(normHeader(h)));
      const acresCol = colOf(['acres', 'acreage', 'lot acreage', 'acres county preferred']);
      const offerCol = colOf(['offer price', 'offerprice', 'offer']);
      const tabRows: ParentRow[] = [];
      let tied = 0;
      for (let r = headerRow + 1; r < values.length; r++) {
        const row = values[r] ?? [];
        const apns = apnCols.map((c) => ({ column: header[c], value: row[c] })).filter((a) => norm(a.value));
        if (apns.length === 0) continue;
        const pr: ParentRow = {
          tab: tab.title, tabRank: 0, row: r + 1, apns,
          acres: acresCol >= 0 ? num(row[acresCol]) : null,
          offer: offerCol >= 0 ? num(row[offerCol]) : null,
        };
        tabRows.push(pr);
        const addressKeys = new Set<string>();
        const nameKeys = new Set<string>();
        for (const cell of row) {
          if (typeof cell !== 'string') continue;
          const text = norm(cell);
          if (!text) continue;
          if (addresses.has(text)) addressKeys.add(text);
          if (names.has(text)) nameKeys.add(text);
          if (cell.includes('\n')) {
            const firstLine = norm(cell.split(/\r?\n/)[0]);
            if (addresses.has(firstLine)) addressKeys.add(firstLine);
          }
        }
        for (const k of addressKeys) push(wb.byAddress, k, pr);
        for (const k of nameKeys) push(wb.byName, k, pr);
        if (addressKeys.size > 0) tied++;
        for (const a of apns) {
          const text = a.value.toString().trim();
          if (!/^\d+(\.\d+)?$/.test(text) && !/^\d+E\d+$/i.test(text) && typeof a.value !== 'number') continue;
          const n = Number(text);
          if (Number.isFinite(n)) push(wb.byNumber, n, pr);
          const digits = text.replace(/^0+/, '');
          if (typeof a.value === 'string' && /^\d{9,}$/.test(digits)) push(wb.rounded, roundedKey(digits), pr);
        }
      }
      perTab.push({ tied, rows: tabRows });
    }
    // The tab holding the most of this workbook's consolidated rows is the
    // one the consolidated sheet was built from: prefer its APN.
    perTab.sort((a, b) => b.tied - a.tied);
    perTab.forEach((t, i) => t.rows.forEach((r) => { r.tabRank = i; }));
    return wb;
  }

  recover(r: RecoveryInput): ApnRecovery {
    const wb = r.docId ? this.workbooks.get(r.docId) : undefined;
    const base: ApnRecovery = { status: 'no_parent_link', apn: null, how: null, matchedBy: null, workbookId: r.docId, workbook: wb?.title ?? null, tab: null, row: null, column: null, note: null };
    if (!r.docId || !wb) return base;
    if (wb.error) return { ...base, status: 'no_parent_row', note: `parent workbook unreadable: ${wb.error}` };

    const damaged = typeof r.unformattedApn === 'number' ? r.unformattedApn : null;
    const acres = num(r.acres);
    const offer = num(r.offerPrice);
    const order = (a: ParentRow, b: ParentRow) => a.tabRank - b.tabRank || a.row - b.row;
    const agrees = (p: ParentRow) => (acres === null || p.acres === null || Math.abs(p.acres - acres) < 0.0051)
      && (offer === null || p.offer === null || Math.abs(p.offer - offer) < 0.51)
      && ((acres !== null && p.acres !== null) || (offer !== null && p.offer !== null));

    type Fit = { p: ParentRow; column: string; value: string; how: RecoveryHow };
    const evaluate = (candidates: ParentRow[], matchedBy: ApnRecovery['matchedBy'], strict: boolean): ApnRecovery | null => {
      if (candidates.length === 0) return null;
      const fits: Fit[] = [];
      let identical: Fit | null = null;
      let sameNumber: ParentRow | null = null;
      for (const p of candidates) {
        for (const a of p.apns) {
          const text = a.value.toString().trim();
          if (text.toUpperCase() === r.apn) {
            if (typeof a.value === 'number') sameNumber ??= p; else identical ??= { p, column: a.column, value: text, how: 'identical' };
            continue;
          }
          // "Mailer" / "Yes" in the APN column is a shifted cell, not an
          // APN: take the parent row's own APN column.
          if (!strict && !/\d/.test(r.apn) && typeof a.value === 'string' && normHeader(a.column) === 'apn') {
            fits.push({ p, column: a.column, value: text, how: 'not_an_apn' });
            continue;
          }
          if (damaged === null) continue;
          const how = matchDamagedApn(a.value, damaged, strict);
          if (!how || how === 'identical') continue;
          // A weaker tie to the row needs more: lost digits must be backed
          // by the same acres / offer price.
          if (strict && how === 'precision' && !agrees(p)) continue;
          fits.push({ p, column: a.column, value: text, how });
        }
      }
      const at = (f: Fit) => ({ tab: f.p.tab, row: f.p.row, column: f.column });
      let distinct = [...new Set(fits.map((f) => f.value))];
      // When digits were lost, a parent APN that carries them wins over a
      // parent copy of the damaged number. Dropped leading zeros are
      // different: "5230" as text is a real APN in its own right.
      const lossy = fits.some((f) => f.how !== 'leading_zeros');
      if (distinct.length === 0 || (!lossy && identical)) {
        if (identical) return { ...base, status: 'confirmed', how: 'identical', matchedBy, ...at(identical) };
        if (sameNumber) return { ...base, status: 'parent_numeric', matchedBy, tab: sameNumber.tab, row: sameNumber.row, note: 'the parent workbook holds the same number, not text' };
        if (matchedBy !== 'owner+address') return null;
        return { ...base, status: 'no_parent_apn', matchedBy, tab: candidates[0].tab, row: candidates[0].row, note: `parent APNs: ${[...new Set(candidates.flatMap((p) => p.apns.map((a) => String(a.value))))].slice(0, 6).join(', ')}` };
      }
      if (distinct.length > 1) {
        // One owner, several parcels that round to the same number: tell
        // them apart by acres and offer price.
        const narrowed = [...new Set(fits.filter((f) => agrees(f.p)).map((f) => f.value))];
        if (narrowed.length !== 1) return { ...base, status: 'ambiguous', matchedBy, note: `candidates: ${distinct.slice(0, 6).join(', ')}` };
        distinct = narrowed;
      }
      const chosen = fits.find((f) => f.value === distinct[0])!;
      return { ...base, status: 'recovered', apn: chosen.value.toUpperCase(), how: chosen.how, matchedBy, ...at(chosen) };
    };

    const last = norm(r.ownerLastName);
    const full = norm(r.ownerName);
    const named = [...new Set([...(wb.byName.get(last) ?? []), ...(wb.byName.get(full) ?? [])])].sort(order);
    const namedSet = new Set(named);
    const addressed = (wb.byAddress.get(norm(r.addressLine1)) ?? []).filter((p) => !last || namedSet.has(p)).sort(order);

    const first = evaluate(addressed, 'owner+address', false);
    if (first && first.status !== 'no_parent_apn') return first;
    const second = evaluate(named, 'owner', true);
    if (second) return second;
    if (damaged !== null) {
      const pool = [...new Set([...(wb.byNumber.get(damaged) ?? []), ...(/^\d{9,}$/.test(String(damaged)) ? wb.rounded.get(roundedKey(String(damaged))) ?? [] : [])])].sort(order);
      const third = evaluate(pool, 'apn', true);
      if (third) return third;
    }
    return first ?? { ...base, status: 'no_parent_row' };
  }
}
