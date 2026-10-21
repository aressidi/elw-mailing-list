import { Router } from 'express';
import { eq, and, ilike, desc, asc, sql, count, isNull, not, or, gte, lte, inArray } from 'drizzle-orm';
import { db, pool } from './db.js';
import {
  properties,
  owners,
  mailingAddresses,
  campaigns,
  mailings,
  deals,
  mailingSuppression,
  propertyOwners,
} from '../shared/schema.js';
import { ownerIdentityKey } from '../scripts/owner-identity.js';
import { canonicalCounty, matchPropertyByLocation } from '../shared/property-location.js';
import { acreBandByValue } from '../shared/acre-bands.js';
import { canonicalCounty, matchPropertyByLocation, normalizeCounty } from '../shared/property-location.js';
import { ACRE_BAND_KEYS, acreBandCaseSql, acreBandLabel } from '../shared/acreage.js';

const router = Router();

// Bulk endpoints cap each request to this many items so a single import
// batch can't monopolize a connection from the pool.
const MAX_BULK_BATCH = 500;

// Light dedupe key for campaign names: trim + collapse whitespace + fold
// case, so "Foo Campaign" and "foo   campaign" resolve to the same campaign.
function normalizeCampaignKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ============================================================
// Health Check
// ============================================================
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// Helper Functions
// ============================================================

// County from a request body, in the canonical form stored in
// properties.county (see canonicalCounty). Anything but a string is no county.
function canonicalCountyInput(value: unknown): string | null {
  return typeof value === 'string' ? canonicalCounty(value) : null;
}

function getPagination(req: any): { limit: number; offset: number; page: number } {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;
  return { limit, offset, page };
}

function successResponse<T>(data: T, meta?: Record<string, any>) {
  return { success: true, data, ...meta };
}

function errorResponse(error: string, statusCode: number = 500) {
  return { success: false, error, statusCode };
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(v);
}

// Helper to build orderBy for properties
function getPropertyOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'apn': return desc(properties.apn);
      case 'state': return desc(properties.state);
      case 'county': return desc(properties.county);
      case 'acres': return desc(properties.acres);
      case 'createdAt': return desc(properties.createdAt);
      default: return desc(properties.id);
    }
  }
  switch(sortBy) {
    case 'apn': return asc(properties.apn);
    case 'state': return asc(properties.state);
    case 'county': return asc(properties.county);
    case 'acres': return asc(properties.acres);
    case 'createdAt': return asc(properties.createdAt);
    default: return asc(properties.id);
  }
}

// Helper to build orderBy for owners
function getOwnerOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'lastName': return desc(owners.lastName);
      case 'ownerName': return desc(owners.ownerName);
      case 'createdAt': return desc(owners.createdAt);
      default: return desc(owners.id);
    }
  }
  switch(sortBy) {
    case 'lastName': return asc(owners.lastName);
    case 'ownerName': return asc(owners.ownerName);
    case 'createdAt': return asc(owners.createdAt);
    default: return asc(owners.id);
  }
}

// Helper to build orderBy for campaigns
function getCampaignOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'name': return desc(campaigns.name);
      case 'createdAt': return desc(campaigns.createdAt);
      default: return desc(campaigns.id);
    }
  }
  switch(sortBy) {
    case 'name': return asc(campaigns.name);
    case 'createdAt': return asc(campaigns.createdAt);
    default: return asc(campaigns.id);
  }
}

// Helper to build orderBy for mailings
function getMailingOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'mailDate': return desc(mailings.mailDate);
      case 'offerPrice': return desc(mailings.offerPrice);
      case 'createdAt': return desc(mailings.createdAt);
      default: return desc(mailings.id);
    }
  }
  switch(sortBy) {
    case 'mailDate': return asc(mailings.mailDate);
    case 'offerPrice': return asc(mailings.offerPrice);
    case 'createdAt': return asc(mailings.createdAt);
    default: return asc(mailings.id);
  }
}

// Helper to build orderBy for deals
function getDealOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'hitType': return desc(deals.hitType);
      case 'hitDate': return desc(deals.hitDate);
      case 'isLead': return desc(deals.isLead);
      case 'isConversion': return desc(deals.isConversion);
      case 'createdAt': return desc(deals.createdAt);
      default: return desc(deals.id);
    }
  }
  switch(sortBy) {
    case 'hitType': return asc(deals.hitType);
    case 'hitDate': return asc(deals.hitDate);
    case 'isLead': return asc(deals.isLead);
    case 'isConversion': return asc(deals.isConversion);
    case 'createdAt': return asc(deals.createdAt);
    default: return asc(deals.id);
  }
}

// Helper to build orderBy for suppression
function getSuppressionOrderBy(sortBy: string, sortOrder: string) {
  if (sortOrder === 'desc') {
    switch(sortBy) {
      case 'reason': return desc(mailingSuppression.reason);
      case 'createdAt': return desc(mailingSuppression.createdAt);
      default: return desc(mailingSuppression.id);
    }
  }
  switch(sortBy) {
    case 'reason': return asc(mailingSuppression.reason);
    case 'createdAt': return asc(mailingSuppression.createdAt);
    default: return asc(mailingSuppression.id);
  }
}

// ============================================================
// Last Offer Helpers
// ============================================================
// lastOfferPrice/lastOfferDate come from the mailing with the greatest
// mail_date (ties broken by highest id) for a given property/owner;
// offerCount is the total number of mailings for that record. Each is
// computed in a single batched query keyed off the ids on the current page
// (or a single id for detail routes), never one query per row.

interface LastOfferInfo {
  lastOfferPrice: string | null;
  lastOfferDate: string | null;
  // Date this property/owner was last mailed = max(mail_date), null when never
  // mailed (or every mailing has a null mail_date). Equal to lastOfferDate by
  // construction, but surfaced explicitly so the "Last Mailed" column has a
  // dedicated, unambiguous field.
  lastMailDate: string | null;
  offerCount: number;
}

async function getLastOfferByProperty(propertyIds: number[]): Promise<Map<number, LastOfferInfo>> {
  if (propertyIds.length === 0) return new Map();
  const result = await db.execute<{ id: number; offer_price: string | null; mail_date: string | null; max_mail_date: string | null; offer_count: string }>(sql`
    SELECT id, offer_price, mail_date, max_mail_date, offer_count FROM (
      SELECT
        property_id AS id,
        offer_price,
        mail_date,
        max(mail_date) OVER (PARTITION BY property_id) AS max_mail_date,
        count(*) OVER (PARTITION BY property_id) AS offer_count,
        row_number() OVER (PARTITION BY property_id ORDER BY mail_date DESC NULLS LAST, id DESC) AS rn
      FROM mailings
      WHERE property_id IN ${propertyIds}
    ) sub
    WHERE rn = 1
  `);
  const map = new Map<number, LastOfferInfo>();
  for (const row of result.rows) {
    map.set(Number(row.id), {
      lastOfferPrice: row.offer_price,
      lastOfferDate: row.mail_date,
      lastMailDate: row.max_mail_date,
      offerCount: Number(row.offer_count),
    });
  }
  return map;
}

async function getLastOfferByOwner(ownerIds: number[]): Promise<Map<number, LastOfferInfo>> {
  if (ownerIds.length === 0) return new Map();
  const result = await db.execute<{ id: number; offer_price: string | null; mail_date: string | null; max_mail_date: string | null; offer_count: string }>(sql`
    SELECT id, offer_price, mail_date, max_mail_date, offer_count FROM (
      SELECT
        owner_id AS id,
        offer_price,
        mail_date,
        max(mail_date) OVER (PARTITION BY owner_id) AS max_mail_date,
        count(*) OVER (PARTITION BY owner_id) AS offer_count,
        row_number() OVER (PARTITION BY owner_id ORDER BY mail_date DESC NULLS LAST, id DESC) AS rn
      FROM mailings
      WHERE owner_id IN ${ownerIds}
    ) sub
    WHERE rn = 1
  `);
  const map = new Map<number, LastOfferInfo>();
  for (const row of result.rows) {
    map.set(Number(row.id), {
      lastOfferPrice: row.offer_price,
      lastOfferDate: row.mail_date,
      lastMailDate: row.max_mail_date,
      offerCount: Number(row.offer_count),
    });
  }
  return map;
}

// Last Mailed = the greatest mail_date across all of an owner's mailings
// (null when the owner has never been mailed). Computed as a single batched
// SQL aggregation keyed off the owner ids on the current page -- never one
// query per row, and never a full-table scan in JS. Kept independent of the
// Last Offer helpers so each can evolve (or be removed) on its own.
async function getLastMailedByOwner(ownerIds: number[]): Promise<Map<number, string | null>> {
  if (ownerIds.length === 0) return new Map();
  const result = await db.execute<{ id: number; last_mail_date: string | null }>(sql`
    SELECT owner_id AS id, max(mail_date) AS last_mail_date
    FROM mailings
    WHERE owner_id IN ${ownerIds}
    GROUP BY owner_id
  `);
  const map = new Map<number, string | null>();
  for (const row of result.rows) {
    map.set(Number(row.id), row.last_mail_date);
  }
  return map;
}

// Never coerces a missing/null offer to 0 -- absence of mailings (or a
// newest mailing with a null offer_price) both surface as null.
function withLastOffer<T extends { id: number }>(row: T, map: Map<number, LastOfferInfo>) {
  const info = map.get(row.id);
  return {
    ...row,
    lastOfferPrice: info?.lastOfferPrice ?? null,
    lastOfferDate: info?.lastOfferDate ?? null,
    lastMailDate: info?.lastMailDate ?? null,
    offerCount: info?.offerCount ?? 0,
  };
}

// ============================================================
// Owner <-> Property Association Helpers
// ============================================================
// Batched (one query per list request, keyed by the ids on the current
// page) so the Owners/Properties list endpoints can show each other's
// linked records without N+1 queries.

interface PropertyPreview {
  id: number;
  apn: string;
  state: string | null;
  county: string | null;
}

// A distinct (state, county) location an owner holds property in, with how many
// of their properties fall there. Aggregated across ALL of an owner's
// properties (not just the previewed first few) so the Owners list can show a
// compact "NC: Halifax; AR: Benton" style summary at a glance.
interface OwnerLocationSummary {
  state: string | null;
  county: string | null;
  count: number;
}

interface OwnerPreview {
  id: number;
  ownerName: string;
}

const RELATED_RECORD_PREVIEW_LIMIT = 3;

async function getPropertiesByOwner(
  ownerIds: number[]
): Promise<Map<number, { propertyCount: number; properties: PropertyPreview[]; locations: OwnerLocationSummary[] }>> {
  if (ownerIds.length === 0) return new Map();
  const result = await db.execute<{ owner_id: number; property_count: string; properties: PropertyPreview[] }>(sql`
    SELECT po.owner_id,
           count(*) AS property_count,
           json_agg(json_build_object('id', p.id, 'apn', p.apn, 'state', p.state, 'county', p.county) ORDER BY p.id ASC) AS properties
    FROM property_owners po
    JOIN properties p ON p.id = po.property_id
    WHERE po.owner_id IN ${ownerIds}
    GROUP BY po.owner_id
  `);
  const map = new Map<number, { propertyCount: number; properties: PropertyPreview[]; locations: OwnerLocationSummary[] }>();
  for (const row of result.rows) {
    const all = Array.isArray(row.properties) ? row.properties : [];
    map.set(Number(row.owner_id), {
      propertyCount: Number(row.property_count),
      properties: all.slice(0, RELATED_RECORD_PREVIEW_LIMIT),
      // Distinct (state, county) pairs across ALL of this owner's properties,
      // so a multi-property owner reads as a short "NC: Halifax; AR: Benton"
      // summary rather than a repeated-location list.
      locations: summarizeLocations(all),
    });
  }
  return map;
}

// Collapses a property list into distinct (state, county) pairs with counts,
// preserving first-seen order (properties arrive sorted by id). Nulls are kept
// as their own bucket so owners with un-located properties still surface.
function summarizeLocations(props: PropertyPreview[]): OwnerLocationSummary[] {
  const byKey = new Map<string, OwnerLocationSummary>();
  for (const p of props) {
    const state = p.state ?? null;
    const county = p.county ?? null;
    const key = `${state ?? ''}|${county ?? ''}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { state, county, count: 1 });
    }
  }
  return Array.from(byKey.values());
}

async function getOwnersByProperty(
  propertyIds: number[]
): Promise<Map<number, { ownerCount: number; owners: OwnerPreview[] }>> {
  if (propertyIds.length === 0) return new Map();
  const result = await db.execute<{ property_id: number; owner_count: string; owners: OwnerPreview[] }>(sql`
    SELECT po.property_id,
           count(*) AS owner_count,
           json_agg(json_build_object('id', o.id, 'ownerName', o.owner_name) ORDER BY o.id ASC) AS owners
    FROM property_owners po
    JOIN owners o ON o.id = po.owner_id
    WHERE po.property_id IN ${propertyIds}
    GROUP BY po.property_id
  `);
  const map = new Map<number, { ownerCount: number; owners: OwnerPreview[] }>();
  for (const row of result.rows) {
    const all = Array.isArray(row.owners) ? row.owners : [];
    map.set(Number(row.property_id), {
      ownerCount: Number(row.owner_count),
      owners: all.slice(0, RELATED_RECORD_PREVIEW_LIMIT),
    });
  }
  return map;
}

// Batched suppression lookup for a page of properties. A parcel counts as
// suppressed when a mailing_suppression row targets it directly (property_id)
// or targets any of its linked owners (owner_id) -- the same OR relationship
// the campaign aggregates use. Returns the distinct reason set per property;
// absence from the map means not suppressed.
async function getSuppressionByProperty(propertyIds: number[]): Promise<Map<number, string[]>> {
  if (propertyIds.length === 0) return new Map();
  const result = await db.execute<{ property_id: number; reasons: string[] }>(sql`
    SELECT sub.property_id, array_agg(DISTINCT sub.reason) AS reasons
    FROM (
      SELECT ms.property_id AS property_id, ms.reason::text AS reason
      FROM mailing_suppression ms
      WHERE ms.property_id IN ${propertyIds}
      UNION
      SELECT po.property_id, ms.reason::text AS reason
      FROM property_owners po
      JOIN mailing_suppression ms ON ms.owner_id = po.owner_id
      WHERE po.property_id IN ${propertyIds}
    ) sub
    GROUP BY sub.property_id
  `);
  const map = new Map<number, string[]>();
  for (const row of result.rows) {
    const reasons = Array.isArray(row.reasons) ? row.reasons.filter(Boolean) : [];
    map.set(Number(row.property_id), reasons);
  }
  return map;
}

// ============================================================
// Global Search Route
// ============================================================

// GET /api/search?q=&limit= - Universal search across properties and owners.
// Matches properties by APN (formatting-tolerant), county, or zip; matches
// owners by first/last/full name (including reversed "last first" order).
router.get('/search', async (req, res) => {
  try {
    const qRaw = req.query.q;
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    if (!q) {
      return res.status(400).json(errorResponse('Search query "q" is required', 400));
    }

    const limitPerGroup = Math.min(25, Math.max(1, parseInt(req.query.limit as string) || 10));
    const searchTerm = `%${q}%`;
    // Strip non-alphanumerics from both the query and the stored APN before
    // comparing, so "11501009009" and "115-01009009" match each other.
    const normalizedApn = q.replace(/[^a-zA-Z0-9]/g, '');

    const propertyConditions = [
      ilike(properties.county, searchTerm),
      ilike(properties.zip, searchTerm),
    ];
    if (normalizedApn) {
      propertyConditions.push(
        sql`regexp_replace(${properties.apn}, '[^a-zA-Z0-9]', '', 'g') ILIKE ${`%${normalizedApn}%`}`
      );
    }

    const ownerFullNameForward = sql`concat_ws(' ', ${owners.firstName}, ${owners.lastName})`;
    const ownerFullNameReversed = sql`concat_ws(' ', ${owners.lastName}, ${owners.firstName})`;
    const ownerConditions = [
      ilike(owners.firstName, searchTerm),
      ilike(owners.lastName, searchTerm),
      ilike(owners.ownerName, searchTerm),
      ilike(ownerFullNameForward, searchTerm),
      ilike(ownerFullNameReversed, searchTerm),
    ];

    const [propertyResults, propertyCountResult, ownerResults, ownerCountResult] = await Promise.all([
      db.select().from(properties).where(or(...propertyConditions)).limit(limitPerGroup),
      db.select({ count: count() }).from(properties).where(or(...propertyConditions)),
      db.select().from(owners).where(or(...ownerConditions)).limit(limitPerGroup),
      db.select({ count: count() }).from(owners).where(or(...ownerConditions)),
    ]);

    // Attach cheap disambiguation context: first associated owner name per
    // matched property, and first mailing address (city/state) per matched
    // owner. Each is a single batched query, not one query per row.
    const propertyIds = propertyResults.map((p) => p.id);
    const ownerIds = ownerResults.map((o) => o.id);

    const [propertyOwnerNames, ownerAddresses, lastOfferByProperty, lastOfferByOwner] = await Promise.all([
      propertyIds.length > 0
        ? db.execute<{ property_id: number; owner_name: string }>(sql`
            SELECT DISTINCT ON (po.property_id) po.property_id, o.owner_name
            FROM property_owners po
            JOIN owners o ON o.id = po.owner_id
            WHERE po.property_id IN ${propertyIds}
            ORDER BY po.property_id, o.id ASC
          `)
        : Promise.resolve({ rows: [] as { property_id: number; owner_name: string }[] }),
      ownerIds.length > 0
        ? db.execute<{ owner_id: number; city: string | null; state: string | null }>(sql`
            SELECT DISTINCT ON (owner_id) owner_id, city, state
            FROM mailing_addresses
            WHERE owner_id IN ${ownerIds}
            ORDER BY owner_id, id DESC
          `)
        : Promise.resolve({ rows: [] as { owner_id: number; city: string | null; state: string | null }[] }),
      getLastOfferByProperty(propertyIds),
      getLastOfferByOwner(ownerIds),
    ]);

    const ownerNameByPropertyId = new Map(propertyOwnerNames.rows.map((r) => [r.property_id, r.owner_name]));
    const addressByOwnerId = new Map(ownerAddresses.rows.map((r) => [r.owner_id, { city: r.city, state: r.state }]));

    const propertiesOut = propertyResults.map((p) => ({
      ...withLastOffer(p, lastOfferByProperty),
      ownerName: ownerNameByPropertyId.get(p.id) || null,
    }));
    const ownersOut = ownerResults.map((o) => ({
      ...withLastOffer(o, lastOfferByOwner),
      mailingCity: addressByOwnerId.get(o.id)?.city || null,
      mailingState: addressByOwnerId.get(o.id)?.state || null,
    }));

    res.json(successResponse(
      {
        properties: propertiesOut,
        owners: ownersOut,
      },
      {
        query: q,
        counts: {
          properties: propertyCountResult[0]?.count || 0,
          owners: ownerCountResult[0]?.count || 0,
        },
      }
    ));
  } catch (error) {
    console.error('Error performing global search:', error);
    res.status(500).json(errorResponse('Failed to perform search'));
  }
});

// ============================================================
// Properties Routes
// ============================================================

// GET /api/properties - List all (paginated). Filters (all case-insensitive):
// state, county, apn, owner (matches any linked owner's name), and acreBand
// (a band token from shared/acre-bands). Also returns a `summary` block
// aggregated over the whole filtered set for the page header.
router.get('/properties', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { state, county, apn, owner, acreBand, sortBy = 'id', sortOrder = 'asc' } = req.query;

    const conditions = [];
    // State codes are stored uppercase; ilike (no wildcards) matches the exact
    // code case-insensitively, e.g. "nc" -> "NC".
    if (state) conditions.push(ilike(properties.state, state as string));
    if (county) conditions.push(ilike(properties.county, `%${county}%`));
    if (apn) conditions.push(ilike(properties.apn, `%${apn}%`));
    if (owner) {
      const ownerTerm = `%${owner as string}%`;
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${propertyOwners} po
        JOIN ${owners} o ON o.id = po.owner_id
        WHERE po.property_id = ${properties.id} AND o.owner_name ILIKE ${ownerTerm}
      )`);
    }
    if (acreBand) {
      const band = acreBandByValue(acreBand as string);
      if (band) {
        conditions.push(sql`${properties.acres} IS NOT NULL`);
        conditions.push(sql`${properties.acres} >= ${band.min}`);
        if (band.max !== null) conditions.push(sql`${properties.acres} < ${band.max}`);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Single aggregate pass over the filtered set: total (drives pagination)
    // plus the summary-header figures (acres span, distinct state/county counts).
    const [summaryRow] = await db
      .select({
        total: count(),
        minAcres: sql<string | null>`min(${properties.acres})`,
        maxAcres: sql<string | null>`max(${properties.acres})`,
        stateCount: sql<string>`count(distinct ${properties.state})`,
        countyCount: sql<string>`count(distinct ${properties.county})`,
      })
      .from(properties)
      .where(whereClause);
    const total = summaryRow?.total || 0;

    // Get paginated results
    const results = await db
      .select()
      .from(properties)
      .where(whereClause)
      .orderBy(getPropertyOrderBy(sortBy as string, sortOrder as string))
      .limit(limit)
      .offset(offset);

    const propertyIds = results.map((p) => p.id);
    const [lastOfferByProperty, ownersByProperty, suppressionByProperty] = await Promise.all([
      getLastOfferByProperty(propertyIds),
      getOwnersByProperty(propertyIds),
      getSuppressionByProperty(propertyIds),
    ]);
    const resultsWithRelations = results.map((p) => {
      const ownerInfo = ownersByProperty.get(p.id);
      const reasons = suppressionByProperty.get(p.id) ?? [];
      return {
        ...withLastOffer(p, lastOfferByProperty),
        ownerCount: ownerInfo?.ownerCount ?? 0,
        owners: ownerInfo?.owners ?? [],
        suppressed: reasons.length > 0,
        suppressionReasons: reasons,
      };
    });

    res.json(successResponse(resultsWithRelations, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        total,
        minAcres: summaryRow?.minAcres ?? null,
        maxAcres: summaryRow?.maxAcres ?? null,
        stateCount: Number(summaryRow?.stateCount ?? 0),
        countyCount: Number(summaryRow?.countyCount ?? 0),
      },
    }));
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json(errorResponse('Failed to fetch properties'));
  }
});

// GET /api/properties/search?q= - Search by APN or address
router.get('/properties/search', async (req, res) => {
  try {
    const { q, limit: limitStr = '20' } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(limitStr as string) || 20));

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json(errorResponse('Search query "q" is required', 400));
    }

    const searchTerm = `%${q.trim()}%`;

    const results = await db
      .select()
      .from(properties)
      .where(
        or(
          ilike(properties.apn, searchTerm),
          ilike(properties.county, searchTerm),
          ilike(properties.zip, searchTerm)
        )
      )
      .limit(limit);

    const lastOfferByProperty = await getLastOfferByProperty(results.map((p) => p.id));
    const resultsWithOffers = results.map((p) => withLastOffer(p, lastOfferByProperty));

    res.json(successResponse(resultsWithOffers, { query: q }));
  } catch (error) {
    console.error('Error searching properties:', error);
    res.status(500).json(errorResponse('Failed to search properties'));
  }
});

// GET /api/properties/:id - Get single property with owner/mailing details
router.get('/properties/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid property ID', 400));
    }

    const property = await db.query.properties.findFirst({
      where: eq(properties.id, id),
      with: {
        propertyOwners: {
          with: {
            owner: {
              with: {
                mailingAddresses: true,
              },
            },
          },
        },
        mailings: {
          with: {
            campaign: true,
          },
        },
        deals: true,
      },
    });

    if (!property) {
      return res.status(404).json(errorResponse('Property not found', 404));
    }

    const lastOfferByProperty = await getLastOfferByProperty([property.id]);

    res.json(successResponse(withLastOffer(property, lastOfferByProperty)));
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json(errorResponse('Failed to fetch property'));
  }
});

// POST /api/properties/bulk - Bulk upsert properties by APN. Existing rows
// (matched by APN within the item's state + county - an APN is only unique
// within a county) have their provided fields updated in place instead of
// being re-created; returns which APNs were skipped (i.e. already existed).
router.post('/properties/bulk', async (req, res) => {
  try {
    const { properties: propertiesList } = req.body;

    if (!Array.isArray(propertiesList) || propertiesList.length === 0) {
      return res.status(400).json(errorResponse('properties array is required and must not be empty', 400));
    }
    if (propertiesList.length > MAX_BULK_BATCH) {
      return res.status(400).json(errorResponse(`properties array must not exceed ${MAX_BULK_BATCH} items`, 400));
    }

    const createdIds: number[] = [];
    const skippedApns: string[] = [];
    const errors: { index: number; error: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < propertiesList.length; i++) {
      const prop = propertiesList[i];
      const apn = typeof prop?.apn === 'string' ? prop.apn.trim() : '';
      if (!apn) {
        errors.push({ index: i, error: 'apn is required' });
        continue;
      }

      const candidates = await db
        .select({ id: properties.id, state: properties.state, county: properties.county })
        .from(properties)
        .where(eq(properties.apn, apn));
      const { match, ambiguous } = matchPropertyByLocation(candidates, { state: prop.state, county: prop.county });
      if (ambiguous) {
        errors.push({ index: i, error: `apn ${apn} exists in more than one county; state and county are required` });
        continue;
      }
      const existing = match ? [match] : [];

      if (existing.length > 0) {
        skipped++;
        skippedApns.push(apn);

        const updates: Record<string, any> = {};
        if (prop.state !== undefined) updates.state = prop.state;
        if (prop.county !== undefined) updates.county = canonicalCountyInput(prop.county);
        if (prop.zip !== undefined) updates.zip = prop.zip;
        if (prop.latitude !== undefined) updates.latitude = prop.latitude;
        if (prop.longitude !== undefined) updates.longitude = prop.longitude;
        if (prop.acres !== undefined) updates.acres = prop.acres;
        if (prop.legalDescription !== undefined) updates.legalDescription = prop.legalDescription;
        if (prop.rawData !== undefined) updates.rawData = prop.rawData;

        if (Object.keys(updates).length > 0) {
          await db.update(properties).set(updates).where(eq(properties.id, existing[0].id));
        }
        continue;
      }

      const result = await db.insert(properties).values({
        apn,
        state: prop.state || null,
        county: canonicalCountyInput(prop.county),
        zip: prop.zip || null,
        latitude: prop.latitude,
        longitude: prop.longitude,
        acres: prop.acres,
        legalDescription: prop.legalDescription || null,
        rawData: prop.rawData,
      }).returning();

      if (result[0]) {
        createdIds.push(result[0].id);
        created++;
      }
    }

    res.status(201).json(successResponse({
      created,
      skipped,
      skippedApns,
      ids: createdIds,
      errors,
    }));
  } catch (error) {
    console.error('Error bulk creating properties:', error);
    res.status(500).json(errorResponse('Failed to bulk create properties'));
  }
});

// ============================================================
// Owners Routes
// ============================================================

// GET /api/owners - List all (paginated), filter by name/state
router.get('/owners', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { name, firstName, lastName, ownerName, state, propertyState, propertyCounty, sortBy = 'id', sortOrder = 'asc' } = req.query;

    let conditions = [];
    if (name) {
      conditions.push(
        or(
          ilike(owners.firstName, `%${name}%`),
          ilike(owners.lastName, `%${name}%`),
          ilike(owners.ownerName, `%${name}%`)
        )
      );
    }
    if (firstName) {
      conditions.push(ilike(owners.firstName, `%${firstName}%`));
    }
    if (lastName) {
      conditions.push(ilike(owners.lastName, `%${lastName}%`));
    }
    if (ownerName) {
      conditions.push(ilike(owners.ownerName, `%${ownerName}%`));
    }

    // For state filter, we need to check mailing addresses. Applied in SQL so
    // it runs before limit/offset and the total reflects the filtered set.
    if (state) {
      conditions.push(
        inArray(
          owners.id,
          db
            .select({ ownerId: mailingAddresses.ownerId })
            .from(mailingAddresses)
            .where(eq(mailingAddresses.state, state as string))
        )
      );
    }

    // Property location filters: keep owners that hold at least one property in
    // a matching state/county. Done as an ilike subquery (SQL, pre-pagination)
    // so the total reflects the filtered set and we never scan the full table
    // in JS. property_owners -> properties is the owner->location join.
    if (propertyState) {
      conditions.push(
        inArray(
          owners.id,
          db
            .select({ ownerId: propertyOwners.ownerId })
            .from(propertyOwners)
            .innerJoin(properties, eq(properties.id, propertyOwners.propertyId))
            .where(ilike(properties.state, `%${propertyState}%`))
        )
      );
    }
    if (propertyCounty) {
      conditions.push(
        inArray(
          owners.id,
          db
            .select({ ownerId: propertyOwners.ownerId })
            .from(propertyOwners)
            .innerJoin(properties, eq(properties.id, propertyOwners.propertyId))
            .where(ilike(properties.county, `%${propertyCounty}%`))
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(owners)
      .where(whereClause);
    const total = totalResult[0]?.count || 0;

    // Get paginated results
    let query = db
      .select()
      .from(owners)
      .where(whereClause)
      .orderBy(getOwnerOrderBy(sortBy as string, sortOrder as string))
      .limit(limit)
      .offset(offset);

    const results = await query;

    const ownerIdsForPage = results.map((o) => o.id);
    const [lastOfferByOwner, lastMailedByOwner, propertiesByOwner] = await Promise.all([
      getLastOfferByOwner(ownerIdsForPage),
      getLastMailedByOwner(ownerIdsForPage),
      getPropertiesByOwner(ownerIdsForPage),
    ]);
    const resultsWithRelations = results.map((o) => {
      const properties = propertiesByOwner.get(o.id);
      return {
        ...withLastOffer(o, lastOfferByOwner),
        lastMailed: lastMailedByOwner.get(o.id) ?? null,
        propertyCount: properties?.propertyCount ?? 0,
        properties: properties?.properties ?? [],
        locations: properties?.locations ?? [],
      };
    });

    res.json(successResponse(resultsWithRelations, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching owners:', error);
    res.status(500).json(errorResponse('Failed to fetch owners'));
  }
});

// GET /api/owners/search?q= - Search by name
router.get('/owners/search', async (req, res) => {
  try {
    const { q, limit: limitStr = '20' } = req.query;
    const limit = Math.min(100, Math.max(1, parseInt(limitStr as string) || 20));

    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.status(400).json(errorResponse('Search query "q" is required', 400));
    }

    const searchTerm = `%${q.trim()}%`;

    const results = await db
      .select()
      .from(owners)
      .where(
        or(
          ilike(owners.firstName, searchTerm),
          ilike(owners.lastName, searchTerm),
          ilike(owners.ownerName, searchTerm)
        )
      )
      .limit(limit);

    const lastOfferByOwner = await getLastOfferByOwner(results.map((o) => o.id));
    const resultsWithOffers = results.map((o) => withLastOffer(o, lastOfferByOwner));

    res.json(successResponse(resultsWithOffers, { query: q }));
  } catch (error) {
    console.error('Error searching owners:', error);
    res.status(500).json(errorResponse('Failed to search owners'));
  }
});

// GET /api/owners/:id - Get single owner with all properties
router.get('/owners/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid owner ID', 400));
    }

    const owner = await db.query.owners.findFirst({
      where: eq(owners.id, id),
      with: {
        propertyOwners: {
          with: {
            property: true,
          },
        },
        mailingAddresses: true,
        mailings: {
          with: {
            campaign: true,
            property: true,
          },
        },
        deals: {
          with: {
            property: true,
          },
        },
        suppressions: {
          with: {
            property: true,
          },
        },
      },
    });

    if (!owner) {
      return res.status(404).json(errorResponse('Owner not found', 404));
    }

    const lastOfferByOwner = await getLastOfferByOwner([owner.id]);

    res.json(successResponse(withLastOffer(owner, lastOfferByOwner)));
  } catch (error) {
    console.error('Error fetching owner:', error);
    res.status(500).json(errorResponse('Failed to fetch owner'));
  }
});

// POST /api/owners/bulk - Bulk create owners. Dedupes using the authoritative
// owner identity rule (see scripts/owner-identity.ts): an owner row is reused
// only when name + zip + full mailing address all match exactly -- the same
// name at a different address is treated as a different person.
router.post('/owners/bulk', async (req, res) => {
  try {
    const { owners: ownersList } = req.body;

    if (!Array.isArray(ownersList) || ownersList.length === 0) {
      return res.status(400).json(errorResponse('owners array is required and must not be empty', 400));
    }
    if (ownersList.length > MAX_BULK_BATCH) {
      return res.status(400).json(errorResponse(`owners array must not exceed ${MAX_BULK_BATCH} items`, 400));
    }

    // Pre-fetch existing owners joined to their mailing address so the
    // identity map matches the name+zip+full-address rule applied below.
    const existingOwners = await db
      .select({
        id: owners.id,
        ownerName: owners.ownerName,
        line1: mailingAddresses.addressLine1,
        line2: mailingAddresses.addressLine2,
        city: mailingAddresses.city,
        state: mailingAddresses.state,
        zip: mailingAddresses.zip,
      })
      .from(owners)
      .leftJoin(mailingAddresses, eq(mailingAddresses.ownerId, owners.id));

    const identityToId = new Map<string, number>();
    for (const o of existingOwners) {
      identityToId.set(ownerIdentityKey(o.ownerName, o), o.id);
    }

    const createdIds: number[] = [];
    const errors: { index: number; error: string }[] = [];
    let created = 0;
    let skipped = 0;

    for (let i = 0; i < ownersList.length; i++) {
      const owner = ownersList[i];
      const ownerName = typeof owner?.ownerName === 'string' ? owner.ownerName.trim() : '';
      if (!ownerName) {
        errors.push({ index: i, error: 'ownerName is required' });
        continue;
      }

      const address = {
        line1: owner.addressLine1 || null,
        line2: owner.addressLine2 || null,
        city: owner.city || null,
        state: owner.state || null,
        zip: owner.zip || null,
      };
      const identityKey = ownerIdentityKey(ownerName, address);

      if (identityToId.has(identityKey)) {
        skipped++;
        continue;
      }

      const result = await db.insert(owners).values({
        ownerName,
        firstName: owner.firstName || null,
        lastName: owner.lastName || null,
        ownerType: owner.ownerType,
        phone: owner.phone || null,
        email: owner.email || null,
        rawData: owner.rawData,
      }).returning();

      const ownerId = result[0]?.id;
      if (!ownerId) continue;

      if (address.line1 || address.city) {
        await db.insert(mailingAddresses).values({
          ownerId,
          addressLine1: address.line1,
          addressLine2: address.line2,
          city: address.city,
          state: address.state,
          zip: address.zip,
        });
      }

      identityToId.set(identityKey, ownerId);
      createdIds.push(ownerId);
      created++;
    }

    res.status(201).json(successResponse({
      created,
      skipped,
      ids: createdIds,
      errors,
    }));
  } catch (error) {
    console.error('Error bulk creating owners:', error);
    res.status(500).json(errorResponse('Failed to bulk create owners'));
  }
});

// ============================================================
// Campaigns Routes
// ============================================================

// Shared CTE aggregating per-campaign stats (mailings, owners, properties,
// states/counties, leads, deals, suppressions, offer totals, mail date range).
// Uses LEFT JOIN mailings so campaigns with zero mailings still render (0-state, no crash).
function campaignStatsCte(): string {
  return `
    WITH campaign_stats AS (
      SELECT
        c.id AS id,
        c.name AS name,
        c.link AS link,
        c.created_at AS created_at,
        COALESCE(NULLIF(c.link, ''), cs.sample_source_link) AS google_sheet_link,
        MIN(m.mail_date) AS first_mail_date,
        MAX(m.mail_date) AS last_mail_date,
        COUNT(m.id)::int AS total_mailings,
        COUNT(DISTINCT m.owner_id)::int AS total_owners,
        COUNT(DISTINCT m.property_id)::int AS total_properties,
        COALESCE(SUM(CAST(m.offer_price AS NUMERIC)), 0)::numeric(14,2) AS total_offer_amount,
        MIN(p.acres)::numeric(12,4) AS min_acres,
        MAX(p.acres)::numeric(12,4) AS max_acres,
        COALESCE(ARRAY_AGG(DISTINCT p.state) FILTER (WHERE p.state IS NOT NULL), ARRAY[]::varchar[]) AS states,
        COALESCE(ARRAY_AGG(DISTINCT p.county) FILTER (WHERE p.county IS NOT NULL), ARRAY[]::varchar[]) AS counties,
        COALESCE(cdc.hits_count, 0)::int AS hits_count,
        COALESCE(cdc.leads_count, 0)::int AS leads_count,
        COALESCE(cdc.deals_count, 0)::int AS deals_count,
        COALESCE(csc.suppressions_count, 0)::int AS suppressions_count
      FROM campaigns c
      LEFT JOIN mailings m ON m.campaign_id = c.id
      LEFT JOIN properties p ON m.property_id = p.id
      LEFT JOIN (
        SELECT
          m1.campaign_id,
          COUNT(DISTINCT d.id)::int AS hits_count,
          COUNT(DISTINCT CASE WHEN d.is_lead = true THEN d.id END)::int AS leads_count,
          COUNT(DISTINCT CASE WHEN d.is_conversion = true THEN d.id END)::int AS deals_count
        FROM mailings m1
        INNER JOIN deals d ON (d.property_id = m1.property_id OR d.owner_id = m1.owner_id)
        WHERE m1.campaign_id IS NOT NULL
        GROUP BY m1.campaign_id
      ) cdc ON cdc.campaign_id = c.id
      LEFT JOIN (
        SELECT
          m2.campaign_id,
          COUNT(DISTINCT ms.id)::int AS suppressions_count
        FROM mailings m2
        INNER JOIN mailing_suppression ms ON (ms.property_id = m2.property_id OR ms.owner_id = m2.owner_id)
        WHERE m2.campaign_id IS NOT NULL
        GROUP BY m2.campaign_id
      ) csc ON csc.campaign_id = c.id
      LEFT JOIN (
        SELECT
          m3.campaign_id,
          (ARRAY_AGG(sm.source_link) FILTER (WHERE sm.source_link IS NOT NULL AND sm.source_link != ''))[1] AS sample_source_link
        FROM mailings m3
        LEFT JOIN source_metadata sm ON sm.property_id = m3.property_id
        WHERE m3.campaign_id IS NOT NULL
        GROUP BY m3.campaign_id
      ) cs ON cs.campaign_id = c.id
      GROUP BY c.id, c.name, c.link, c.created_at, cs.sample_source_link, cdc.hits_count, cdc.leads_count, cdc.deals_count, csc.suppressions_count
    )
  `;
}

function formatCampaignStatsRow(r: any) {
  return {
    id: r.id,
    name: r.name,
    link: r.link,
    createdAt: r.created_at,
    googleSheetLink: r.google_sheet_link || null,
    firstMailDate: r.first_mail_date || null,
    lastMailDate: r.last_mail_date || null,
    totalMailings: Number(r.total_mailings) || 0,
    totalOwners: Number(r.total_owners) || 0,
    totalProperties: Number(r.total_properties) || 0,
    totalOfferAmount: Number(r.total_offer_amount) || 0,
    minAcres: r.min_acres != null ? Number(r.min_acres) : null,
    maxAcres: r.max_acres != null ? Number(r.max_acres) : null,
    states: Array.isArray(r.states) ? r.states : [],
    counties: Array.isArray(r.counties) ? r.counties : [],
    hitsCount: Number(r.hits_count) || 0,
    leadsCount: Number(r.leads_count) || 0,
    dealsCount: Number(r.deals_count) || 0,
    suppressionsCount: Number(r.suppressions_count) || 0,
  };
}

// GET /api/campaigns - List all campaigns. Pass ?include=stats to get per-campaign
// aggregated stats (mailings/owners/properties/states/counties/leads/deals/suppressions/offers).
router.get('/campaigns', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { sortBy = 'id', sortOrder = 'desc', include } = req.query;

    if (include === 'stats') {
      const orderDir = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      let orderCol = 'id';
      switch (sortBy) {
        case 'name':
          orderCol = 'name';
          break;
        case 'createdAt':
          orderCol = 'created_at';
          break;
        case 'totalMailings':
        case 'mailings':
        case 'volume':
          orderCol = 'total_mailings';
          break;
        case 'minAcres':
        case 'acreRange':
        case 'acres':
          orderCol = 'min_acres';
          break;
        case 'maxAcres':
          orderCol = 'max_acres';
          break;
        case 'hitsCount':
        case 'hits':
          orderCol = 'hits_count';
          break;
        case 'totalOwners':
        case 'owners':
          orderCol = 'total_owners';
          break;
        case 'totalProperties':
        case 'properties':
          orderCol = 'total_properties';
          break;
        case 'totalOfferAmount':
        case 'offerPrice':
          orderCol = 'total_offer_amount';
          break;
        case 'leadsCount':
        case 'leads':
          orderCol = 'leads_count';
          break;
        case 'dealsCount':
        case 'deals':
          orderCol = 'deals_count';
          break;
        case 'suppressionsCount':
        case 'suppressions':
          orderCol = 'suppressions_count';
          break;
        case 'firstMailDate':
        case 'mailDate':
          orderCol = 'first_mail_date';
          break;
        case 'lastMailDate':
          orderCol = 'last_mail_date';
          break;
        case 'id':
        default:
          orderCol = 'id';
          break;
      }

      const sql = `
        ${campaignStatsCte()}
        SELECT *, COUNT(*) OVER() as full_count
        FROM campaign_stats
        ORDER BY ${orderCol} ${orderDir} NULLS LAST, id DESC
        LIMIT ${limit} OFFSET ${offset};
      `;

      const result = await pool.query(sql);
      const rows = result.rows as any[];
      const total = rows.length > 0 ? parseInt(rows[0].full_count, 10) || 0 : 0;
      const formattedData = rows.map(formatCampaignStatsRow);

      return res.json(successResponse(formattedData, {
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      }));
    }

    // Get total count
    const totalResult = await db.select({ count: count() }).from(campaigns);
    const total = totalResult[0]?.count || 0;

    const results = await db
      .select()
      .from(campaigns)
      .orderBy(getCampaignOrderBy(sortBy as string, sortOrder as string))
      .limit(limit)
      .offset(offset);

    res.json(successResponse(results, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json(errorResponse('Failed to fetch campaigns'));
  }
});

// GET /api/campaigns/:id - Get campaign with mailings + aggregated stats
router.get('/campaigns/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid campaign ID', 400));
    }

    const campaign = await db.query.campaigns.findFirst({
      where: eq(campaigns.id, id),
      with: {
        mailings: {
          with: {
            property: true,
            owner: true,
            mailingAddress: true,
          },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json(errorResponse('Campaign not found', 404));
    }

    const statsResult = await pool.query(
      `${campaignStatsCte()} SELECT * FROM campaign_stats WHERE id = $1`,
      [id]
    );
    const s = statsResult.rows[0];

    res.json(successResponse({
      ...campaign,
      stats: {
        mailingsCount: Number(s?.total_mailings) || 0,
        totalOfferPrice: Number(s?.total_offer_amount) || 0,
        totalOwners: Number(s?.total_owners) || 0,
        totalProperties: Number(s?.total_properties) || 0,
        states: Array.isArray(s?.states) ? s.states : [],
        counties: Array.isArray(s?.counties) ? s.counties : [],
        leadsCount: Number(s?.leads_count) || 0,
        dealsCount: Number(s?.deals_count) || 0,
        suppressionsCount: Number(s?.suppressions_count) || 0,
        firstMailDate: s?.first_mail_date || null,
        lastMailDate: s?.last_mail_date || null,
        googleSheetLink: s?.google_sheet_link || null,
      },
    }));
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json(errorResponse('Failed to fetch campaign'));
  }
});

// POST /api/campaigns - Create a campaign if one with this (normalized) name
// doesn't already exist. Idempotent: repeated calls with the same name
// return the existing campaign instead of erroring, which keeps this
// endpoint safe to call from the Rocketmail bulk importer.
router.post('/campaigns', async (req, res) => {
  try {
    const { name, link } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json(errorResponse('name is required', 400));
    }

    const trimmedName = name.trim();

    // Check if a campaign with the same normalized name exists. Exact match on
    // the normalizeCampaignKey form (not ILIKE), so '_' / '%' in names are
    // literal characters rather than wildcards.
    const existing = await db
      .select()
      .from(campaigns)
      .where(sql`lower(btrim(regexp_replace(${campaigns.name}, '\\s+', ' ', 'g'))) = ${normalizeCampaignKey(trimmedName)}`)
      .limit(1);

    if (existing.length > 0) {
      return res.status(200).json(successResponse(existing[0], { created: false }));
    }

    const result = await db.insert(campaigns).values({
      name: trimmedName,
      link,
    }).returning();

    res.status(201).json(successResponse(result[0], { created: true }));
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json(errorResponse('Failed to create campaign'));
  }
});

// PATCH /api/campaigns/:id - Rename a campaign. Rejects a name that
// normalizes (normalizeCampaignKey) to the same key as a DIFFERENT existing
// campaign, so renames can't silently collide two campaigns together.
router.patch('/campaigns/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json(errorResponse('Invalid campaign ID', 400));
    }

    const { name, link } = req.body;
    if (name === undefined && link === undefined) {
      return res.status(400).json(errorResponse('name or link is required', 400));
    }

    const existing = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json(errorResponse('Campaign not found', 404));
    }

    const updateFields: Partial<{ name: string; link: string | null }> = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json(errorResponse('name must be a non-empty string', 400));
      }
      const trimmedName = name.trim();
      const key = normalizeCampaignKey(trimmedName);
      const allCampaigns = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
      const conflict = allCampaigns.find((c) => c.id !== id && normalizeCampaignKey(c.name) === key);
      if (conflict) {
        return res.status(409).json(errorResponse('A different campaign with this name already exists', 409));
      }
      updateFields.name = trimmedName;
    }

    if (link !== undefined) {
      updateFields.link = typeof link === 'string' ? link.trim() : null;
    }

    const result = await db.update(campaigns)
      .set(updateFields)
      .where(eq(campaigns.id, id))
      .returning();

    res.json(successResponse(result[0]));
  } catch (error) {
    console.error('Error updating campaign:', error);
    res.status(500).json(errorResponse('Failed to update campaign'));
  }
});

// ============================================================
// Mailings Routes
// ============================================================

// GET /api/mailings - List aggregated campaign/mailer rows (paginated), filterable and sortable
// Query params: page, limit, state, county, search, startDate, endDate, sortBy, sortOrder, raw (if true, returns individual property mailings)
router.get('/mailings', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const {
      state,
      county,
      search,
      startDate,
      endDate,
      sortBy = 'mailDate',
      sortOrder = 'desc',
      raw,
      campaignId,
    } = req.query;

    // If raw=true or raw list is explicitly requested, return legacy individual mailing records
    if (raw === 'true') {
      let conditions = [];
      if (campaignId) conditions.push(eq(mailings.campaignId, parseInt(campaignId as string)));
      if (startDate) conditions.push(gte(mailings.mailDate, new Date(startDate as string)));
      if (endDate) conditions.push(lte(mailings.mailDate, new Date(endDate as string)));
      // Match on mailing-address state or property state, in SQL so the filter
      // runs before limit/offset and the total reflects the filtered set.
      if (state) {
        conditions.push(
          or(
            inArray(
              mailings.mailingAddressId,
              db
                .select({ id: mailingAddresses.id })
                .from(mailingAddresses)
                .where(eq(mailingAddresses.state, state as string))
            ),
            inArray(
              mailings.propertyId,
              db
                .select({ id: properties.id })
                .from(properties)
                .where(eq(properties.state, state as string))
            )
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const totalResult = await db
        .select({ count: count() })
        .from(mailings)
        .where(whereClause);
      const total = totalResult[0]?.count || 0;

      const results = await db.query.mailings.findMany({
        where: whereClause,
        with: {
          property: true,
          owner: true,
          mailingAddress: true,
          campaign: true,
        },
        orderBy: getMailingOrderBy(sortBy as string, sortOrder as string),
        limit,
        offset,
      });

      return res.json(
        successResponse(results, {
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        })
      );
    }

    // Default: Aggregated Mailings (one row per distinct mailer / campaign)
    const orderDir = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let orderCol = 'mail_date';
    switch (sortBy) {
      case 'id':
      case 'campaignId':
        orderCol = 'id';
        break;
      case 'name':
      case 'campaignName':
        orderCol = 'name';
        break;
      case 'totalOwners':
      case 'owners':
        orderCol = 'total_owners';
        break;
      case 'totalMailings':
      case 'mailings':
        orderCol = 'total_mailings';
        break;
      case 'totalOfferAmount':
      case 'offerPrice':
        orderCol = 'total_offer_amount';
        break;
      case 'leadsCount':
      case 'leads':
        orderCol = 'leads_count';
        break;
      case 'dealsCount':
      case 'deals':
        orderCol = 'deals_count';
        break;
      case 'suppressionsCount':
      case 'suppressions':
        orderCol = 'suppressions_count';
        break;
      case 'mailDate':
      default:
        orderCol = 'mail_date';
        break;
    }

    // Dynamic filters
    const filterClauses: string[] = ['1=1'];
    const filterParams: any[] = [];

    if (search && typeof search === 'string' && search.trim()) {
      filterParams.push(`%${search.trim()}%`);
      const pIdx = filterParams.length;
      filterClauses.push(
        `(name ILIKE $${pIdx} OR $${pIdx} = ANY(states) OR $${pIdx} = ANY(counties))`
      );
    }

    if (state && typeof state === 'string' && state.trim()) {
      filterParams.push(state.trim().toUpperCase());
      const pIdx = filterParams.length;
      filterClauses.push(`$${pIdx} = ANY(states)`);
    }

    if (county && typeof county === 'string' && county.trim()) {
      filterParams.push(`%${county.trim()}%`);
      const pIdx = filterParams.length;
      filterClauses.push(
        `EXISTS (SELECT 1 FROM unnest(counties) c WHERE c ILIKE $${pIdx})`
      );
    }

    if (startDate && typeof startDate === 'string') {
      filterParams.push(startDate);
      const pIdx = filterParams.length;
      filterClauses.push(`mail_date >= $${pIdx}::timestamptz`);
    }

    if (endDate && typeof endDate === 'string') {
      filterParams.push(endDate);
      const pIdx = filterParams.length;
      filterClauses.push(`mail_date <= $${pIdx}::timestamptz`);
    }

    const whereSql = filterClauses.join(' AND ');

    // Query CTE
    const aggregatedSql = `
      WITH aggregated_campaigns AS (
        SELECT 
          c.id as id,
          c.id as campaign_id,
          c.name as name,
          c.name as campaign_name,
          COALESCE(NULLIF(c.link, ''), cs.sample_source_link) as google_sheet_link,
          MIN(m.mail_date) as mail_date,
          MAX(m.mail_date) as latest_mail_date,
          COUNT(m.id)::int as total_mailings,
          COUNT(DISTINCT m.owner_id)::int as total_owners,
          COUNT(DISTINCT m.property_id)::int as total_properties,
          COALESCE(SUM(CAST(m.offer_price AS NUMERIC)), 0)::numeric(14,2) as total_offer_amount,
          COALESCE(ARRAY_AGG(DISTINCT p.state) FILTER (WHERE p.state IS NOT NULL), ARRAY[]::varchar[]) as states,
          COALESCE(ARRAY_AGG(DISTINCT p.county) FILTER (WHERE p.county IS NOT NULL), ARRAY[]::varchar[]) as counties,
          COALESCE(cdc.leads_count, 0)::int as leads_count,
          COALESCE(cdc.deals_count, 0)::int as deals_count,
          COALESCE(csc.suppressions_count, 0)::int as suppressions_count
        FROM campaigns c
        INNER JOIN mailings m ON m.campaign_id = c.id
        LEFT JOIN properties p ON m.property_id = p.id
        LEFT JOIN (
          SELECT 
            m1.campaign_id,
            COUNT(DISTINCT CASE WHEN d.is_lead = true THEN d.id END)::int as leads_count,
            COUNT(DISTINCT CASE WHEN d.is_conversion = true THEN d.id END)::int as deals_count
          FROM mailings m1
          INNER JOIN deals d ON (d.property_id = m1.property_id OR d.owner_id = m1.owner_id)
          WHERE m1.campaign_id IS NOT NULL
          GROUP BY m1.campaign_id
        ) cdc ON cdc.campaign_id = c.id
        LEFT JOIN (
          SELECT 
            m2.campaign_id,
            COUNT(DISTINCT ms.id)::int as suppressions_count
          FROM mailings m2
          INNER JOIN mailing_suppression ms ON (ms.property_id = m2.property_id OR ms.owner_id = m2.owner_id)
          WHERE m2.campaign_id IS NOT NULL
          GROUP BY m2.campaign_id
        ) csc ON csc.campaign_id = c.id
        LEFT JOIN (
          SELECT 
            m3.campaign_id,
            (ARRAY_AGG(sm.source_link) FILTER (WHERE sm.source_link IS NOT NULL AND sm.source_link != ''))[1] as sample_source_link
          FROM mailings m3
          LEFT JOIN source_metadata sm ON sm.property_id = m3.property_id
          WHERE m3.campaign_id IS NOT NULL
          GROUP BY m3.campaign_id
        ) cs ON cs.campaign_id = c.id
        GROUP BY c.id, c.name, c.link, cs.sample_source_link, cdc.leads_count, cdc.deals_count, csc.suppressions_count
      )
      SELECT *, COUNT(*) OVER() as full_count
      FROM aggregated_campaigns
      WHERE ${whereSql}
      ORDER BY ${orderCol} ${orderDir} NULLS LAST, id DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const result = await pool.query(aggregatedSql, filterParams);
    const rows = result.rows as any[];
    const total = rows.length > 0 ? parseInt(rows[0].full_count, 10) || 0 : 0;

    const formattedData = rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      name: r.name,
      campaignName: r.campaign_name,
      googleSheetLink: r.google_sheet_link || null,
      mailDate: r.mail_date || null,
      latestMailDate: r.latest_mail_date || null,
      totalMailings: Number(r.total_mailings) || 0,
      totalOwners: Number(r.total_owners) || 0,
      totalProperties: Number(r.total_properties) || 0,
      totalOfferAmount: Number(r.total_offer_amount) || 0,
      states: Array.isArray(r.states) ? r.states : [],
      counties: Array.isArray(r.counties) ? r.counties : [],
      leadsCount: Number(r.leads_count) || 0,
      dealsCount: Number(r.deals_count) || 0,
      suppressionsCount: Number(r.suppressions_count) || 0,
    }));

    res.json(
      successResponse(formattedData, {
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      })
    );
  } catch (error) {
    console.error('Error fetching aggregated mailings:', error);
    res.status(500).json(errorResponse('Failed to fetch mailings'));
  }
});

// POST /api/mailings/bulk - Bulk create mailings. Each item can link to an
// existing property/owner/campaign by id, or resolve/create one by apn /
// owner identity (name+zip+address, see scripts/owner-identity.ts) / campaign
// name. A top-level campaignId applies to items that don't specify their own
// campaign fields.
router.post('/mailings/bulk', async (req, res) => {
  try {
    const { campaignId: fallbackCampaignIdRaw, mailings: mailingsList } = req.body;

    if (!Array.isArray(mailingsList) || mailingsList.length === 0) {
      return res.status(400).json(errorResponse('mailings array is required and must not be empty', 400));
    }
    if (mailingsList.length > MAX_BULK_BATCH) {
      return res.status(400).json(errorResponse(`mailings array must not exceed ${MAX_BULK_BATCH} items`, 400));
    }

    // Validate field formats up front so a malformed row rejects the whole
    // batch with a 400 before anything is written (instead of a DB error
    // mid-loop).
    const validationErrors: { index: number; field: string; error: string }[] = [];
    for (let i = 0; i < mailingsList.length; i++) {
      const item = mailingsList[i];
      if (!item || typeof item !== 'object') continue;
      if (item.mailDate && Number.isNaN(new Date(item.mailDate).getTime())) {
        validationErrors.push({ index: i, field: 'mailDate', error: `invalid date: ${JSON.stringify(item.mailDate)}` });
      }
      if (item.offerPrice !== undefined && item.offerPrice !== null && !isNumericValue(item.offerPrice)) {
        validationErrors.push({ index: i, field: 'offerPrice', error: `invalid number: ${JSON.stringify(item.offerPrice)}` });
      }
      for (const field of ['acres', 'latitude', 'longitude'] as const) {
        const v = item[field];
        if (v !== undefined && v !== null && v !== '' && !isNumericValue(v)) {
          validationErrors.push({ index: i, field, error: `invalid number: ${JSON.stringify(v)}` });
        }
      }
    }
    if (validationErrors.length > 0) {
      const first = validationErrors[0];
      return res.status(400).json({
        ...errorResponse(`mailings[${first.index}].${first.field}: ${first.error}`, 400),
        errors: validationErrors,
      });
    }

    // ---- Property cache (lazy: point lookups/creates by APN) ----
    const propertyIdByApn = new Map<string, number>();
    const verifiedPropertyIds = new Set<number>();

    // ---- Owner cache (preloaded, matches the name+zip+address identity rule) ----
    const existingOwners = await db
      .select({
        id: owners.id,
        ownerName: owners.ownerName,
        addressId: mailingAddresses.id,
        line1: mailingAddresses.addressLine1,
        line2: mailingAddresses.addressLine2,
        city: mailingAddresses.city,
        state: mailingAddresses.state,
        zip: mailingAddresses.zip,
      })
      .from(owners)
      .leftJoin(mailingAddresses, eq(mailingAddresses.ownerId, owners.id));

    const identityToOwnerId = new Map<string, number>();
    const ownerAddressId = new Map<string, number>();
    const verifiedOwnerIds = new Set<number>();
    for (const o of existingOwners) {
      verifiedOwnerIds.add(o.id);
      const key = ownerIdentityKey(o.ownerName, o);
      identityToOwnerId.set(key, o.id);
      if (o.addressId) ownerAddressId.set(`${o.id}|${key}`, o.addressId);
    }

    // ---- Campaign cache (preloaded; small table) ----
    const existingCampaigns = await db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns);
    const campaignIdByKey = new Map<string, number>();
    const verifiedCampaignIds = new Set<number>();
    for (const c of existingCampaigns) {
      verifiedCampaignIds.add(c.id);
      const key = normalizeCampaignKey(c.name);
      if (!campaignIdByKey.has(key)) campaignIdByKey.set(key, c.id);
    }

    let fallbackCampaignId: number | null = null;
    if (fallbackCampaignIdRaw !== undefined && fallbackCampaignIdRaw !== null) {
      const id = Number(fallbackCampaignIdRaw);
      if (!Number.isInteger(id)) {
        return res.status(400).json(errorResponse('campaignId must be an integer', 400));
      }
      if (!verifiedCampaignIds.has(id)) {
        return res.status(404).json(errorResponse('Campaign not found', 404));
      }
      fallbackCampaignId = id;
    }

    async function resolvePropertyId(tx: DbTx, item: any): Promise<{ propertyId: number | null; error?: string }> {
      if (item.propertyId !== undefined && item.propertyId !== null) {
        const id = Number(item.propertyId);
        if (!Number.isInteger(id)) return { propertyId: null, error: 'propertyId must be an integer' };
        if (!verifiedPropertyIds.has(id)) {
          const found = await tx.select({ id: properties.id }).from(properties).where(eq(properties.id, id)).limit(1);
          if (found.length === 0) return { propertyId: null, error: `propertyId ${id} not found` };
          verifiedPropertyIds.add(id);
        }
        return { propertyId: id };
      }

      if (typeof item.apn === 'string' && item.apn.trim()) {
        const apn = item.apn.trim();
        // An APN is only unique within a county: match on the item's
        // property state + county too.
        const location = { state: item.propertyState || null, county: item.propertyCounty || null };
        const cacheKey = `${apn}|${location.state ?? ''}|${location.county ?? ''}`;
        const cached = propertyIdByApn.get(cacheKey);
        if (cached !== undefined) return { propertyId: cached };

        const candidates = await tx
          .select({ id: properties.id, state: properties.state, county: properties.county })
          .from(properties)
          .where(eq(properties.apn, apn));
        const { match, ambiguous } = matchPropertyByLocation(candidates, location);
        if (ambiguous) {
          return { propertyId: null, error: `apn ${apn} exists in more than one county; propertyState and propertyCounty are required` };
        }
        if (match) {
          propertyIdByApn.set(cacheKey, match.id);
          return { propertyId: match.id };
        }

        const acres = item.acres !== undefined && item.acres !== null && item.acres !== ''
          ? String(item.acres) : null;
        const latitude = item.latitude !== undefined && item.latitude !== null && item.latitude !== ''
          ? String(item.latitude) : null;
        const longitude = item.longitude !== undefined && item.longitude !== null && item.longitude !== ''
          ? String(item.longitude) : null;

        const createdProp = await tx.insert(properties).values({
          apn,
          state: item.propertyState || null,
          county: canonicalCountyInput(item.propertyCounty),
          zip: item.propertyZip || null,
          rawData: item.propertyRawData,
          legalDescription: item.legalDescription || null,
          acres,
          latitude,
          longitude,
        }).returning();
        propertyIdByApn.set(cacheKey, createdProp[0].id);
        return { propertyId: createdProp[0].id };
      }

      return { propertyId: null };
    }

    async function resolveOwnerId(tx: DbTx, item: any): Promise<{ ownerId: number | null; mailingAddressId: number | null; error?: string }> {
      if (item.ownerId !== undefined && item.ownerId !== null) {
        const id = Number(item.ownerId);
        if (!Number.isInteger(id)) return { ownerId: null, mailingAddressId: null, error: 'ownerId must be an integer' };
        if (!verifiedOwnerIds.has(id)) {
          const found = await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, id)).limit(1);
          if (found.length === 0) return { ownerId: null, mailingAddressId: null, error: `ownerId ${id} not found` };
          verifiedOwnerIds.add(id);
        }
        return { ownerId: id, mailingAddressId: null };
      }

      if (typeof item.ownerName === 'string' && item.ownerName.trim()) {
        const ownerName = item.ownerName.trim();
        const address = {
          line1: item.addressLine1 || null,
          line2: item.addressLine2 || null,
          city: item.city || null,
          state: item.state || null,
          zip: item.zip || null,
        };
        const identityKey = ownerIdentityKey(ownerName, address);

        let ownerId = identityToOwnerId.get(identityKey);
        if (ownerId === undefined) {
          const createdOwner = await tx.insert(owners).values({
            ownerName,
            firstName: item.firstName || null,
            lastName: item.lastName || null,
            ownerType: item.ownerType,
            phone: item.phone || null,
            email: item.email || null,
            rawData: item.ownerRawData,
          }).returning();
          ownerId = createdOwner[0].id;
          identityToOwnerId.set(identityKey, ownerId);
        }

        const addressKey = `${ownerId}|${identityKey}`;
        let mailingAddressId = ownerAddressId.get(addressKey) ?? null;
        if (!mailingAddressId && (address.line1 || address.city)) {
          const addrResult = await tx.insert(mailingAddresses).values({
            ownerId,
            addressLine1: address.line1,
            addressLine2: address.line2,
            city: address.city,
            state: address.state,
            zip: address.zip,
          }).returning();
          mailingAddressId = addrResult[0].id;
          ownerAddressId.set(addressKey, mailingAddressId);
        }

        return { ownerId, mailingAddressId };
      }

      return { ownerId: null, mailingAddressId: null };
    }

    async function resolveCampaignId(tx: DbTx, item: any): Promise<{ campaignId: number | null; error?: string }> {
      if (item.campaignId !== undefined && item.campaignId !== null) {
        const id = Number(item.campaignId);
        if (!Number.isInteger(id)) return { campaignId: null, error: 'campaignId must be an integer' };
        if (!verifiedCampaignIds.has(id)) {
          const found = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
          if (found.length === 0) return { campaignId: null, error: `campaignId ${id} not found` };
          verifiedCampaignIds.add(id);
        }
        return { campaignId: id };
      }

      if (typeof item.campaignName === 'string' && item.campaignName.trim()) {
        const name = item.campaignName.trim();
        const key = normalizeCampaignKey(name);
        let campId = campaignIdByKey.get(key);
        if (campId === undefined) {
          const createdCampaign = await tx.insert(campaigns).values({
            name,
            link: item.campaignLink || null,
          }).returning();
          campId = createdCampaign[0].id;
          campaignIdByKey.set(key, campId);
        }
        return { campaignId: campId };
      }

      return { campaignId: fallbackCampaignId };
    }

    const createdIds: number[] = [];
    const errors: { index: number; error: string }[] = [];
    let created = 0;

    // All writes share one transaction: any thrown error rolls back the whole
    // batch so a failed import leaves no partial rows behind.
    await db.transaction(async (tx) => {
      for (let i = 0; i < mailingsList.length; i++) {
        const item = mailingsList[i];
        if (!item || typeof item !== 'object') {
          errors.push({ index: i, error: 'mailing item must be an object' });
          continue;
        }

        const propResult = await resolvePropertyId(tx, item);
        if (propResult.error) {
          errors.push({ index: i, error: propResult.error });
          continue;
        }

        const ownerResult = await resolveOwnerId(tx, item);
        if (ownerResult.error) {
          errors.push({ index: i, error: ownerResult.error });
          continue;
        }

        const campResult = await resolveCampaignId(tx, item);
        if (campResult.error) {
          errors.push({ index: i, error: campResult.error });
          continue;
        }

        if (propResult.propertyId && ownerResult.ownerId) {
          await tx.insert(propertyOwners).values({
            propertyId: propResult.propertyId,
            ownerId: ownerResult.ownerId,
          }).onConflictDoNothing();
        }

        const result = await tx.insert(mailings).values({
          propertyId: propResult.propertyId,
          ownerId: ownerResult.ownerId,
          mailingAddressId: ownerResult.mailingAddressId,
          campaignId: campResult.campaignId,
          mailDate: item.mailDate ? new Date(item.mailDate) : null,
          offerPrice: item.offerPrice,
        }).returning();

        if (result[0]) {
          createdIds.push(result[0].id);
          created++;
        }
      }
    });

    res.status(201).json(successResponse({
      created,
      ids: createdIds,
      errors,
    }));
  } catch (error) {
    console.error('Error bulk creating mailings:', error);
    res.status(500).json(errorResponse('Failed to bulk create mailings'));
  }
});

// POST /api/mailings/move - Reassign a batch of mailings to a different
// campaign (e.g. after a rename/merge cleanup). Capped at 2000 ids per call
// to match the bulk-endpoint pattern of bounding single-request work.
const MAX_MOVE_BATCH = 2000;

router.post('/mailings/move', async (req, res) => {
  try {
    const { mailingIds, campaignId } = req.body;

    if (!Array.isArray(mailingIds) || mailingIds.length === 0) {
      return res.status(400).json(errorResponse('mailingIds array is required and must not be empty', 400));
    }
    if (mailingIds.length > MAX_MOVE_BATCH) {
      return res.status(400).json(errorResponse(`mailingIds array must not exceed ${MAX_MOVE_BATCH} items`, 400));
    }
    if (!mailingIds.every((id: any) => Number.isInteger(id))) {
      return res.status(400).json(errorResponse('mailingIds must be an array of integers', 400));
    }

    const campId = Number(campaignId);
    if (!Number.isInteger(campId)) {
      return res.status(400).json(errorResponse('campaignId must be an integer', 400));
    }

    const campaignExists = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campId)).limit(1);
    if (campaignExists.length === 0) {
      return res.status(404).json(errorResponse('Campaign not found', 404));
    }

    const result = await db.update(mailings)
      .set({ campaignId: campId })
      .where(inArray(mailings.id, mailingIds))
      .returning({ id: mailings.id });

    res.json(successResponse({ moved: result.length, campaignId: campId }));
  } catch (error) {
    console.error('Error moving mailings:', error);
    res.status(500).json(errorResponse('Failed to move mailings'));
  }
});

// GET /api/mailings/by-state - Stats: count by state
router.get('/mailings/by-state', async (req, res) => {
  try {
    // Aggregate in SQL rather than loading every mailing into memory: the
    // mailing_addresses join supplies the state, NULL addresses fall under
    // "Unknown", and offer_price is summed (coalesced to 0) per state.
    const result = await db.execute<{ state: string; count: number; offers: number }>(sql`
      SELECT
        COALESCE(ma.state, 'Unknown') AS state,
        COUNT(m.id)::int AS count,
        COALESCE(SUM(m.offer_price::numeric), 0)::float AS offers
      FROM mailings m
      LEFT JOIN mailing_addresses ma ON m.mailing_address_id = ma.id
      GROUP BY COALESCE(ma.state, 'Unknown')
      ORDER BY count DESC
    `);

    const stats = result.rows.map((row) => ({
      state: row.state,
      count: Number(row.count),
      offers: Number(row.offers),
    }));

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching mailing stats by state:', error);
    res.status(500).json(errorResponse('Failed to fetch mailing stats'));
  }
});

// GET /api/mailings/by-county?state=X - Stats: count by county
router.get('/mailings/by-county', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';

    // Aggregate in SQL on the raw (state, county) as stored, rather than
    // loading every mailing into memory. A state filter, when given, matches
    // properties.state case-insensitively and whitespace-tolerantly; it also
    // excludes property-less mailings, since those have no state to match.
    const result = await db.execute<{ state: string | null; county: string | null; count: number; offers: number }>(sql`
      SELECT
        p.state AS state,
        p.county AS county,
        COUNT(m.id)::int AS count,
        COALESCE(SUM(m.offer_price::numeric), 0)::float AS offers
      FROM mailings m
      LEFT JOIN properties p ON m.property_id = p.id
      ${state ? sql`WHERE LOWER(TRIM(p.state)) = LOWER(TRIM(${state}))` : sql``}
      GROUP BY p.state, p.county
    `);

    // Collapse the raw SQL groups onto the canonical county name so "Benton",
    // "Benton County" and "BENTON" merge into one row even for values stored
    // before normalization, while same-named counties in different states stay
    // apart. Property-less mailings group under state/county "Unknown".
    const countyCounts: Record<string, { county: string; state: string; count: number; offers: number }> = {};

    for (const row of result.rows) {
      const county = canonicalCounty(row.county) || 'Unknown';
      const mailingState = row.state || 'Unknown';
      // NUL separator: the key only groups by the (state, county) pair. The
      // county is never parsed back out of it, so "Miami-Dade" survives intact.
      const key = `${mailingState}\u0000${county}`;

      if (!countyCounts[key]) {
        countyCounts[key] = { county, state: mailingState, count: 0, offers: 0 };
      }
      countyCounts[key].count += Number(row.count);
      countyCounts[key].offers += Number(row.offers);
    }

    const stats = Object.values(countyCounts)
      .sort((a, b) => b.count - a.count);

    res.json(successResponse(stats, { filter: state ? { state } : undefined }));
  } catch (error) {
    console.error('Error fetching mailing stats by county:', error);
    res.status(500).json(errorResponse('Failed to fetch mailing stats'));
  }
});

// GET /api/mailings/by-month-detail?startDate=&endDate= - Chronological
// (newest month first) campaign overview for the dashboard. Answers "what did
// we mail, where, and how much, in a given month?". Everything is aggregated
// in SQL: the only rows crossing the wire are one per (month, campaign), each
// already carrying its per-state and per-county volume breakdown as JSON.
// Volume = count of mailing rows in that campaign/month; month comes from
// mail_date (UTC-truncated, matching the UTC date display elsewhere).
router.get('/mailings/by-month-detail', async (req, res) => {
  try {
    const startDate = typeof req.query.startDate === 'string' && req.query.startDate.trim()
      ? req.query.startDate.trim()
      : null;
    const endDate = typeof req.query.endDate === 'string' && req.query.endDate.trim()
      ? req.query.endDate.trim()
      : null;

    // `base` restricts to dated, campaign-tagged mailings and tags each with
    // its UTC month + property location. The per-state / per-county rollups and
    // the campaign-month totals all derive from it, so nothing but grouped
    // aggregates ever materialize. States/counties for property-less mailings
    // fall under "Unknown" rather than being dropped from the volume.
    const result = await db.execute<{
      month: string;
      month_label: string;
      campaign_id: number;
      name: string;
      first_mail_date: string;
      volume: number;
      volume_by_state: Record<string, number> | null;
      volume_by_county: Record<string, number> | null;
    }>(sql`
      WITH base AS (
        SELECT
          to_char((m.mail_date AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
          m.campaign_id AS campaign_id,
          m.mail_date AS mail_date,
          p.state AS state,
          p.county AS county
        FROM mailings m
        LEFT JOIN properties p ON p.id = m.property_id
        WHERE m.mail_date IS NOT NULL
          AND m.campaign_id IS NOT NULL
          ${startDate ? sql`AND m.mail_date >= ${startDate}::timestamptz` : sql``}
          ${endDate ? sql`AND m.mail_date <= ${endDate}::timestamptz` : sql``}
      ),
      by_state AS (
        SELECT month, campaign_id, COALESCE(NULLIF(TRIM(state), ''), 'Unknown') AS state, COUNT(*)::int AS cnt
        FROM base
        GROUP BY month, campaign_id, COALESCE(NULLIF(TRIM(state), ''), 'Unknown')
      ),
      by_county AS (
        SELECT month, campaign_id, COALESCE(NULLIF(TRIM(county), ''), 'Unknown') AS county, COUNT(*)::int AS cnt
        FROM base
        GROUP BY month, campaign_id, COALESCE(NULLIF(TRIM(county), ''), 'Unknown')
      ),
      campaign_month AS (
        SELECT month, campaign_id, MIN(mail_date) AS first_mail_date, COUNT(*)::int AS volume
        FROM base
        GROUP BY month, campaign_id
      )
      SELECT
        cm.month AS month,
        to_char(to_date(cm.month, 'YYYY-MM'), 'FMMonth YYYY') AS month_label,
        cm.campaign_id AS campaign_id,
        c.name AS name,
        cm.first_mail_date AS first_mail_date,
        cm.volume AS volume,
        (SELECT json_object_agg(bs.state, bs.cnt) FROM by_state bs
          WHERE bs.month = cm.month AND bs.campaign_id = cm.campaign_id) AS volume_by_state,
        (SELECT json_object_agg(bc.county, bc.cnt) FROM by_county bc
          WHERE bc.month = cm.month AND bc.campaign_id = cm.campaign_id) AS volume_by_county
      FROM campaign_month cm
      JOIN campaigns c ON c.id = cm.campaign_id
      ORDER BY cm.month DESC, cm.volume DESC, cm.campaign_id DESC
    `);

    // Rows arrive newest-month-first with campaigns in descending volume, so a
    // Map keyed by month preserves that order. County keys are canonicalized
    // here (e.g. "Benton" / "Benton County" merge) the same way /by-county does.
    interface MonthBucket {
      month: string;
      monthLabel: string;
      campaignCount: number;
      totalVolume: number;
      campaigns: Array<{
        campaignId: number;
        name: string;
        firstMailDate: string | null;
        states: string[];
        counties: string[];
        volume: number;
        volumeByState: Record<string, number>;
        volumeByCounty: Record<string, number>;
      }>;
    }

    const monthsMap = new Map<string, MonthBucket>();

    for (const row of result.rows) {
      let bucket = monthsMap.get(row.month);
      if (!bucket) {
        bucket = {
          month: row.month,
          monthLabel: row.month_label,
          campaignCount: 0,
          totalVolume: 0,
          campaigns: [],
        };
        monthsMap.set(row.month, bucket);
      }

      const volumeByState: Record<string, number> = {};
      for (const [st, n] of Object.entries(row.volume_by_state ?? {})) {
        volumeByState[st] = Number(n);
      }

      const volumeByCounty: Record<string, number> = {};
      for (const [rawCounty, n] of Object.entries(row.volume_by_county ?? {})) {
        const county = rawCounty === 'Unknown' ? 'Unknown' : (canonicalCounty(rawCounty) || 'Unknown');
        volumeByCounty[county] = (volumeByCounty[county] || 0) + Number(n);
      }

      const volume = Number(row.volume);
      bucket.campaigns.push({
        campaignId: Number(row.campaign_id),
        name: row.name,
        firstMailDate: row.first_mail_date || null,
        states: Object.keys(volumeByState).sort((a, b) => (volumeByState[b] - volumeByState[a]) || a.localeCompare(b)),
        counties: Object.keys(volumeByCounty).sort((a, b) => (volumeByCounty[b] - volumeByCounty[a]) || a.localeCompare(b)),
        volume,
        volumeByState,
        volumeByCounty,
      });
      bucket.campaignCount += 1;
      bucket.totalVolume += volume;
    }

    res.json(successResponse(Array.from(monthsMap.values())));
  } catch (error) {
    console.error('Error fetching mailings by month detail:', error);
    res.status(500).json(errorResponse('Failed to fetch mailings by month detail'));
  }
});

// ============================================================
// Intelligence Routes (forward-looking analytics)
// ============================================================

// A county needs at least this many mailings before its rates are trusted
// enough to flag it. Below this, a lucky 1-of-3 conversion would look elite,
// so sub-threshold counties are shown but never flagged and never counted
// toward the conversion-rate median that the re-mail test compares against.
const INTEL_MIN_MAILED = 50;
// Re-mail candidates must be "rested": no mail sent in at least this many
// whole months, so we're suggesting fresh dollars, not re-hitting a list
// that's still warm.
const INTEL_REMAIL_MIN_MONTHS = 3;
// A county whose bad-address suppressions are at least this share of its
// mailed volume is burning postage on undeliverable parcels -> avoid.
const INTEL_BAD_ADDRESS_SHARE = 0.1;

// Whole calendar months between a past date and now (0 if same month).
function monthsSince(date: Date | null, now: Date): number | null {
  if (!date || isNaN(date.getTime())) return null;
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  return months < 0 ? 0 : months;
}

// GET /api/intelligence/county-ranking
// Ranks every mailed (state, county) by performance and flags where the next
// mail dollar should (re-mail candidates) or should not (avoid/saturated) go.
//
// Attribution: a mailing/deal/suppression belongs to the county of its
// linked PROPERTY. Property-less rows have no county and are excluded.
//
// Rates (expressed 0-100):
//   responseRate   = (touches + leads + conversions) / mailed  (= all hits / mailed)
//   leadRate       = leads / mailed
//   conversionRate = conversions / mailed
// where a "touch" is a deal that is neither a lead nor a conversion, so the
// three buckets partition the deals and responseRate stays an honest
// hits-per-mailing figure consistent with the dashboard's response rate.
router.get('/intelligence/county-ranking', async (_req, res) => {
  try {
    // One pass over each fact table, grouped on the raw (state, county) as
    // stored; the canonical collapse ("Benton" / "Benton County" / "BENTON")
    // happens in JS below, mirroring /mailings/by-county. Everything returned
    // is additive (counts, sums) or a MAX, so collapsing raw spellings is just
    // summing / max-ing -- averages are rebuilt from acre_sum / acre_cnt.
    const result = await db.execute<{
      state: string | null;
      county: string | null;
      mailed: number;
      offers_sum: number;
      last_mailed: string | null;
      acre_sum: number;
      acre_cnt: number;
      touches: number;
      leads: number;
      conversions: number;
      suppressions: number;
      bad_address: number;
    }>(sql`
      WITH mail_agg AS (
        SELECT
          p.state AS state,
          p.county AS county,
          COUNT(m.id)::int AS mailed,
          COALESCE(SUM(m.offer_price::numeric), 0)::float AS offers_sum,
          MAX(m.mail_date) AS last_mailed
        FROM mailings m
        JOIN properties p ON m.property_id = p.id
        GROUP BY p.state, p.county
      ),
      acre_agg AS (
        SELECT state, county,
          COALESCE(SUM(acres::numeric), 0)::float AS acre_sum,
          COUNT(acres)::int AS acre_cnt
        FROM (
          SELECT DISTINCT p.id, p.state, p.county, p.acres
          FROM properties p
          JOIN mailings m ON m.property_id = p.id
        ) mp
        GROUP BY state, county
      ),
      deal_agg AS (
        SELECT
          p.state AS state,
          p.county AS county,
          COUNT(d.id) FILTER (WHERE NOT COALESCE(d.is_lead, false) AND NOT COALESCE(d.is_conversion, false))::int AS touches,
          COUNT(d.id) FILTER (WHERE d.is_lead)::int AS leads,
          COUNT(d.id) FILTER (WHERE d.is_conversion)::int AS conversions
        FROM deals d
        JOIN properties p ON d.property_id = p.id
        GROUP BY p.state, p.county
      ),
      supp_agg AS (
        SELECT
          p.state AS state,
          p.county AS county,
          COUNT(s.id)::int AS suppressions,
          COUNT(s.id) FILTER (WHERE s.reason = 'bad_address')::int AS bad_address
        FROM mailing_suppression s
        JOIN properties p ON s.property_id = p.id
        GROUP BY p.state, p.county
      )
      SELECT
        ma.state,
        ma.county,
        ma.mailed,
        ma.offers_sum,
        ma.last_mailed,
        COALESCE(aa.acre_sum, 0)::float AS acre_sum,
        COALESCE(aa.acre_cnt, 0)::int AS acre_cnt,
        COALESCE(da.touches, 0)::int AS touches,
        COALESCE(da.leads, 0)::int AS leads,
        COALESCE(da.conversions, 0)::int AS conversions,
        COALESCE(sa.suppressions, 0)::int AS suppressions,
        COALESCE(sa.bad_address, 0)::int AS bad_address
      FROM mail_agg ma
      LEFT JOIN acre_agg aa ON ma.state IS NOT DISTINCT FROM aa.state AND ma.county IS NOT DISTINCT FROM aa.county
      LEFT JOIN deal_agg da ON ma.state IS NOT DISTINCT FROM da.state AND ma.county IS NOT DISTINCT FROM da.county
      LEFT JOIN supp_agg sa ON ma.state IS NOT DISTINCT FROM sa.state AND ma.county IS NOT DISTINCT FROM sa.county
    `);

    // Collapse raw spellings onto the canonical county name, keyed by
    // (state, canonicalCounty) with a NUL separator so hyphenated names like
    // "Miami-Dade" survive. Same-named counties in different states stay apart.
    interface Accum {
      state: string;
      county: string;
      mailed: number;
      offersSum: number;
      lastMailed: Date | null;
      acreSum: number;
      acreCnt: number;
      touches: number;
      leads: number;
      conversions: number;
      suppressions: number;
      badAddress: number;
    }
    const byCounty: Record<string, Accum> = {};

    for (const row of result.rows) {
      const county = canonicalCounty(row.county) || 'Unknown';
      const state = row.state || 'Unknown';
      const key = `${state}\u0000${county}`;
      const last = row.last_mailed ? new Date(row.last_mailed) : null;

      let acc = byCounty[key];
      if (!acc) {
        acc = byCounty[key] = {
          state, county,
          mailed: 0, offersSum: 0, lastMailed: null,
          acreSum: 0, acreCnt: 0,
          touches: 0, leads: 0, conversions: 0,
          suppressions: 0, badAddress: 0,
        };
      }
      acc.mailed += Number(row.mailed);
      acc.offersSum += Number(row.offers_sum);
      acc.acreSum += Number(row.acre_sum);
      acc.acreCnt += Number(row.acre_cnt);
      acc.touches += Number(row.touches);
      acc.leads += Number(row.leads);
      acc.conversions += Number(row.conversions);
      acc.suppressions += Number(row.suppressions);
      acc.badAddress += Number(row.bad_address);
      if (last && (!acc.lastMailed || last > acc.lastMailed)) acc.lastMailed = last;
    }

    const now = new Date();
    const rows = Object.values(byCounty).map((a) => {
      const responses = a.touches + a.leads + a.conversions;
      const rate = (n: number) => (a.mailed > 0 ? (n / a.mailed) * 100 : 0);
      const badAddressRate = a.mailed > 0 ? (a.badAddress / a.mailed) * 100 : 0;
      return {
        state: a.state,
        county: a.county,
        mailed: a.mailed,
        // Deliverable proxy: mailed volume net of known bad-address parcels
        // (we don't track true USPS delivery, so this is the best stand-in).
        deliveredProxy: Math.max(0, a.mailed - a.badAddress),
        responses,
        touches: a.touches,
        leads: a.leads,
        conversions: a.conversions,
        responseRate: Math.round(rate(responses) * 100) / 100,
        leadRate: Math.round(rate(a.leads) * 100) / 100,
        conversionRate: Math.round(rate(a.conversions) * 100) / 100,
        lastMailedDate: a.lastMailed ? a.lastMailed.toISOString() : null,
        monthsSinceLastMail: monthsSince(a.lastMailed, now),
        avgAcres: a.acreCnt > 0 ? Math.round((a.acreSum / a.acreCnt) * 100) / 100 : null,
        totalOffersSum: Math.round(a.offersSum * 100) / 100,
        suppressions: a.suppressions,
        badAddress: a.badAddress,
        badAddressRate: Math.round(badAddressRate * 100) / 100,
      };
    });

    // Median conversion rate across counties that clear the volume threshold,
    // so the "above median" test isn't skewed by tiny, noisy samples.
    const eligible = rows.filter((r) => r.mailed >= INTEL_MIN_MAILED);
    const sortedConv = eligible.map((r) => r.conversionRate).sort((a, b) => a - b);
    const medianConversionRate = sortedConv.length
      ? sortedConv.length % 2
        ? sortedConv[(sortedConv.length - 1) / 2]
        : (sortedConv[sortedConv.length / 2 - 1] + sortedConv[sortedConv.length / 2]) / 2
      : 0;

    const ranked = rows.map((r) => {
      const qualifies = r.mailed >= INTEL_MIN_MAILED;
      const remailCandidate =
        qualifies &&
        r.conversionRate > medianConversionRate &&
        r.monthsSinceLastMail !== null &&
        r.monthsSinceLastMail >= INTEL_REMAIL_MIN_MONTHS;
      const avoid =
        qualifies &&
        ((r.responses === 0) || r.badAddressRate >= INTEL_BAD_ADDRESS_SHARE * 100);
      return { ...r, remailCandidate, avoid };
    });

    // Default order: strongest performers first (conversion, then response,
    // then volume). The client table is fully re-sortable.
    ranked.sort(
      (a, b) =>
        b.conversionRate - a.conversionRate ||
        b.responseRate - a.responseRate ||
        b.mailed - a.mailed,
    );

    res.json(
      successResponse(ranked, {
        meta: {
          medianConversionRate: Math.round(medianConversionRate * 100) / 100,
          minMailed: INTEL_MIN_MAILED,
          remailMinMonths: INTEL_REMAIL_MIN_MONTHS,
          badAddressShareThreshold: INTEL_BAD_ADDRESS_SHARE * 100,
          totalCounties: ranked.length,
          remailCount: ranked.filter((r) => r.remailCandidate).length,
          avoidCount: ranked.filter((r) => r.avoid).length,
        },
      }),
    );
  } catch (error) {
    console.error('Error fetching county ranking:', error);
    res.status(500).json(errorResponse('Failed to fetch county ranking'));
// GET /api/mailings/by-acre-band?state=&county=&startDate=&endDate=
// Targeting intelligence: for each parcel-size band (see shared/acreage.ts),
// how many pieces were mailed, the average offer, and how many of those
// mailings drew a lead or closed a deal. Shows which parcel sizes convert.
router.get('/mailings/by-acre-band', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    const county = typeof req.query.county === 'string' ? req.query.county.trim() : '';
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';

    // Shared filter, applied to the mailing's property/date. County is matched
    // on the same normalized key as the properties unique index so "Benton",
    // "Benton County" and "BENTON" all match. A deal counts for a band when it
    // links (by property or owner) to a mailing that falls in that band.
    const filters = sql.join(
      [
        sql`1=1`,
        state ? sql`LOWER(TRIM(p.state)) = LOWER(TRIM(${state}))` : undefined,
        county ? sql`regexp_replace(regexp_replace(upper(coalesce(p.county, '')), '\\s+COUNTY$', ''), '[^A-Z]', '', 'g') = ${normalizeCounty(county)}` : undefined,
        startDate ? sql`m.mail_date >= ${startDate}::timestamptz` : undefined,
        endDate ? sql`m.mail_date <= ${endDate}::timestamptz` : undefined,
      ].filter(Boolean) as ReturnType<typeof sql>[],
      sql` AND `,
    );

    // Band assigned from the property's acreage; the CASE is generated from the
    // same band definitions the client uses. Aggregate entirely in SQL.
    const bandExpr = sql.raw(acreBandCaseSql('p.acres'));

    const result = await db.execute<{
      band: string;
      mailed: number;
      avg_offer: number;
      leads: number;
      deals: number;
    }>(sql`
      WITH banded AS (
        SELECT
          m.id AS mailing_id,
          m.property_id AS property_id,
          m.owner_id AS owner_id,
          m.offer_price AS offer_price,
          ${bandExpr} AS band
        FROM mailings m
        LEFT JOIN properties p ON m.property_id = p.id
        WHERE ${filters}
      ),
      hits AS (
        SELECT
          b.band AS band,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_lead = true)::int AS leads,
          COUNT(DISTINCT d.id) FILTER (WHERE d.is_conversion = true)::int AS deals
        FROM banded b
        INNER JOIN deals d ON (d.property_id = b.property_id OR d.owner_id = b.owner_id)
        GROUP BY b.band
      )
      SELECT
        b.band AS band,
        COUNT(b.mailing_id)::int AS mailed,
        COALESCE(AVG(b.offer_price::numeric), 0)::float AS avg_offer,
        COALESCE(h.leads, 0)::int AS leads,
        COALESCE(h.deals, 0)::int AS deals
      FROM banded b
      LEFT JOIN hits h ON h.band = b.band
      GROUP BY b.band, h.leads, h.deals
    `);

    const byBand = new Map(result.rows.map((r) => [r.band, r]));

    // Emit every band in canonical order (even empty ones) so the chart axis
    // is stable. conversionRate = deals closed per piece mailed, in percent.
    const stats = ACRE_BAND_KEYS.map((band) => {
      const row = byBand.get(band);
      const mailed = Number(row?.mailed) || 0;
      const leads = Number(row?.leads) || 0;
      const deals = Number(row?.deals) || 0;
      return {
        band,
        label: acreBandLabel(band),
        mailed,
        avgOffer: Number(row?.avg_offer) || 0,
        leads,
        deals,
        conversionRate: mailed > 0 ? (deals / mailed) * 100 : 0,
      };
    });

    res.json(successResponse(stats, {
      filter: {
        ...(state ? { state } : {}),
        ...(county ? { county } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
    }));
  } catch (error) {
    console.error('Error fetching mailing stats by acre band:', error);
    res.status(500).json(errorResponse('Failed to fetch acre-band stats'));
  }
});

// ============================================================
// Deals/Responses Routes
// ============================================================

// GET /api/deals - List all deals/responses
router.get('/deals', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { isLead, isConversion, hitType, outcome, startDate, endDate, sortBy = 'hitDate', sortOrder = 'desc' } = req.query;

    let conditions = [];
    if (isLead !== undefined) conditions.push(eq(deals.isLead, isLead === 'true'));
    if (isConversion !== undefined) conditions.push(eq(deals.isConversion, isConversion === 'true'));
    // outcome is a simplified, mutually-exclusive view of isLead/isConversion:
    //   conversion = closed deal, lead = qualified but not converted, touch = raw response
    if (outcome === 'conversion') {
      conditions.push(eq(deals.isConversion, true));
    } else if (outcome === 'lead') {
      conditions.push(eq(deals.isLead, true));
      conditions.push(eq(deals.isConversion, false));
    } else if (outcome === 'touch') {
      conditions.push(eq(deals.isLead, false));
      conditions.push(eq(deals.isConversion, false));
    }
    if (hitType) conditions.push(eq(deals.hitType, hitType as any));
    if (startDate) conditions.push(gte(deals.hitDate, new Date(startDate as string)));
    if (endDate) conditions.push(lte(deals.hitDate, new Date(endDate as string)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(deals).where(whereClause);
    const total = totalResult[0]?.count || 0;

    // Get paginated results
    const results = await db.query.deals.findMany({
      where: whereClause,
      with: {
        property: true,
        owner: true,
      },
      orderBy: getDealOrderBy(sortBy as string, sortOrder as string),
      limit,
      offset,
    });

    res.json(successResponse(results, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching deals:', error);
    res.status(500).json(errorResponse('Failed to fetch deals'));
  }
});

// GET /api/deals/stats - Response rate stats
router.get('/deals/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let conditions = [];
    if (startDate) conditions.push(gte(deals.hitDate, new Date(startDate as string)));
    if (endDate) conditions.push(lte(deals.hitDate, new Date(endDate as string)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get all deals stats
    const [totalResult, leadsResult, conversionsResult, byTypeResult] = await Promise.all([
      db.select({ count: count() }).from(deals).where(whereClause),
      db.select({ count: count() }).from(deals).where(and(...(whereClause ? [whereClause] : []), eq(deals.isLead, true))),
      db.select({ count: count() }).from(deals).where(and(...(whereClause ? [whereClause] : []), eq(deals.isConversion, true))),
      db.select({ hitType: deals.hitType, count: count() }).from(deals).where(whereClause).groupBy(deals.hitType),
    ]);

    const total = totalResult[0]?.count || 0;
    const leads = leadsResult[0]?.count || 0;
    const conversions = conversionsResult[0]?.count || 0;

    // Get mailing count for response rate calculation
    const mailingCountResult = await db.select({ count: count() }).from(mailings);
    const totalMailings = mailingCountResult[0]?.count || 0;

    const stats = {
      totalDeals: total,
      totalLeads: leads,
      totalConversions: conversions,
      totalMailings,
      responseRate: totalMailings > 0 ? ((total / totalMailings) * 100).toFixed(2) : '0.00',
      leadRate: total > 0 ? ((leads / total) * 100).toFixed(2) : '0.00',
      conversionRate: total > 0 ? ((conversions / total) * 100).toFixed(2) : '0.00',
      byType: byTypeResult,
    };

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching deal stats:', error);
    res.status(500).json(errorResponse('Failed to fetch deal stats'));
  }
});

// ============================================================
// Suppression Routes
// ============================================================

// GET /api/suppression - List suppressed records
router.get('/suppression', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { reason, sortBy = 'id', sortOrder = 'desc' } = req.query;

    let conditions = [];
    if (reason) conditions.push(eq(mailingSuppression.reason, reason as any));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(mailingSuppression).where(whereClause);
    const total = totalResult[0]?.count || 0;

    // Get paginated results
    const results = await db.query.mailingSuppression.findMany({
      where: whereClause,
      with: {
        owner: true,
        property: true,
      },
      orderBy: getSuppressionOrderBy(sortBy as string, sortOrder as string),
      limit,
      offset,
    });

    res.json(successResponse(results, {
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }));
  } catch (error) {
    console.error('Error fetching suppression list:', error);
    res.status(500).json(errorResponse('Failed to fetch suppression list'));
  }
});

// POST /api/suppression - Add new suppression
router.post('/suppression', async (req, res) => {
  try {
    const { ownerId, propertyId, reason = 'do_not_mail' } = req.body;

    // Validate required fields
    if (!ownerId || !propertyId) {
      return res.status(400).json(errorResponse('ownerId and propertyId are required', 400));
    }

    // Validate reason
    const validReasons = ['do_not_mail', 'bad_address'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json(errorResponse(`Invalid reason. Must be one of: ${validReasons.join(', ')}`, 400));
    }

    // Check if suppression already exists using select instead of query
    const existingResult = await db
      .select()
      .from(mailingSuppression)
      .where(
        and(
          eq(mailingSuppression.ownerId, ownerId),
          eq(mailingSuppression.propertyId, propertyId)
        )
      )
      .limit(1);

    if (existingResult.length > 0) {
      return res.status(409).json(errorResponse('Suppression already exists for this owner and property', 409));
    }

    // Insert new suppression
    const result = await db.insert(mailingSuppression).values({
      ownerId,
      propertyId,
      reason: reason as any,
    }).returning();

    res.status(201).json(successResponse(result[0]));
  } catch (error) {
    console.error('Error creating suppression:', error);
    res.status(500).json(errorResponse('Failed to create suppression'));
  }
});

// ============================================================
// Dashboard/Analytics Routes
// ============================================================

// GET /api/dashboard/mail-volume-by-month - Get mailings grouped by month
router.get('/dashboard/mail-volume-by-month', async (_req, res) => {
  try {
    // Aggregate the per-month counts in SQL rather than loading every mailing
    // into memory. Each mailing falls in the month of its mail_date, or its
    // created_at when there is no mail_date. The label matches the x-axis
    // format below (e.g. "Oct 2026") so the counts can be mapped by month.
    const result = await db.execute<{ month: string; count: number }>(sql`
      SELECT
        to_char(date_trunc('month', COALESCE(mail_date, created_at)), 'Mon YYYY') AS month,
        COUNT(id)::int AS count
      FROM mailings
      WHERE COALESCE(mail_date, created_at) IS NOT NULL
      GROUP BY date_trunc('month', COALESCE(mail_date, created_at))
    `);

    const countsByMonth = new Map<string, number>(
      result.rows.map((row) => [row.month, Number(row.count)])
    );

    // Generate the last 12 months, oldest first, ending with the current
    // month, and map the SQL counts onto them (0 for months with no mailings).
    const months: { month: string; count: number }[] = [];
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      months.push({ month: monthLabel, count: countsByMonth.get(monthLabel) ?? 0 });
    }

    res.json(successResponse(months));
  } catch (error) {
    console.error('Error fetching mail volume by month:', error);
    res.status(500).json(errorResponse('Failed to fetch mail volume by month'));
  }
});

// GET /api/dashboard/stats - Overview: total properties, owners, mailings, response rate
router.get('/dashboard/stats', async (req, res) => {
  try {
    // Fetch all counts in parallel
    const [
      propertiesResult,
      ownersResult,
      mailingsResult,
      campaignsResult,
      dealsResult,
      leadsResult,
      conversionsResult,
      suppressionResult,
      recentMailingsResult,
      recentDealsResult,
      recentCampaignsResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(properties),
      db.select({ count: count() }).from(owners),
      db.select({ count: count() }).from(mailings),
      db.select({ count: count() }).from(campaigns),
      db.select({ count: count() }).from(deals),
      db.select({ count: count() }).from(deals).where(eq(deals.isLead, true)),
      db.select({ count: count() }).from(deals).where(eq(deals.isConversion, true)),
      db.select({ count: count() }).from(mailingSuppression),
      db.query.mailings.findMany({
        orderBy: desc(mailings.createdAt),
        limit: 5,
        with: {
          property: true,
          owner: true,
          campaign: true,
        },
      }),
      db.query.deals.findMany({
        // Newest response first; id desc breaks ties so ordering is stable.
        orderBy: [desc(deals.hitDate), desc(deals.id)],
        limit: 5,
        with: {
          property: true,
          owner: true,
        },
      }),
      // Most recent campaigns by latest mail date, with aggregated attributes
      // (date range, states, counties, volume, leads, deals, suppressions).
      // Only campaigns that have actually been mailed (last_mail_date not null).
      pool.query(
        `${campaignStatsCte()}
         SELECT * FROM campaign_stats
         WHERE last_mail_date IS NOT NULL
         ORDER BY last_mail_date DESC, id DESC
         LIMIT 5`
      ),
    ]);

    const totalProperties = propertiesResult[0]?.count || 0;
    const totalOwners = ownersResult[0]?.count || 0;
    const totalMailings = mailingsResult[0]?.count || 0;
    const totalCampaigns = campaignsResult[0]?.count || 0;
    const totalDeals = dealsResult[0]?.count || 0;
    const totalLeads = leadsResult[0]?.count || 0;
    const totalConversions = conversionsResult[0]?.count || 0;
    const totalSuppressed = suppressionResult[0]?.count || 0;

    // Calculate aggregated stats
    const stats = {
      overview: {
        totalProperties,
        totalOwners,
        totalMailings,
        totalCampaigns,
        totalDeals,
        totalLeads,
        totalConversions,
        totalSuppressed,
        responseRate: totalMailings > 0 ? ((totalDeals / totalMailings) * 100).toFixed(2) : '0.00',
        leadRate: totalDeals > 0 ? ((totalLeads / totalDeals) * 100).toFixed(2) : '0.00',
        conversionRate: totalDeals > 0 ? ((totalConversions / totalDeals) * 100).toFixed(2) : '0.00',
      },
      recentActivity: {
        mailings: recentMailingsResult,
        deals: recentDealsResult,
        campaigns: recentCampaignsResult.rows.map(formatCampaignStatsRow),
      },
    };

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json(errorResponse('Failed to fetch dashboard stats'));
  }
});

export default router;
