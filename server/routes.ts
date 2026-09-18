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
  offerCount: number;
}

async function getLastOfferByProperty(propertyIds: number[]): Promise<Map<number, LastOfferInfo>> {
  if (propertyIds.length === 0) return new Map();
  const result = await db.execute<{ id: number; offer_price: string | null; mail_date: string | null; offer_count: string }>(sql`
    SELECT id, offer_price, mail_date, offer_count FROM (
      SELECT
        property_id AS id,
        offer_price,
        mail_date,
        count(*) OVER (PARTITION BY property_id) AS offer_count,
        row_number() OVER (PARTITION BY property_id ORDER BY mail_date DESC NULLS LAST, id DESC) AS rn
      FROM mailings
      WHERE property_id = ANY(${propertyIds})
    ) sub
    WHERE rn = 1
  `);
  const map = new Map<number, LastOfferInfo>();
  for (const row of result.rows) {
    map.set(Number(row.id), {
      lastOfferPrice: row.offer_price,
      lastOfferDate: row.mail_date,
      offerCount: Number(row.offer_count),
    });
  }
  return map;
}

async function getLastOfferByOwner(ownerIds: number[]): Promise<Map<number, LastOfferInfo>> {
  if (ownerIds.length === 0) return new Map();
  const result = await db.execute<{ id: number; offer_price: string | null; mail_date: string | null; offer_count: string }>(sql`
    SELECT id, offer_price, mail_date, offer_count FROM (
      SELECT
        owner_id AS id,
        offer_price,
        mail_date,
        count(*) OVER (PARTITION BY owner_id) AS offer_count,
        row_number() OVER (PARTITION BY owner_id ORDER BY mail_date DESC NULLS LAST, id DESC) AS rn
      FROM mailings
      WHERE owner_id = ANY(${ownerIds})
    ) sub
    WHERE rn = 1
  `);
  const map = new Map<number, LastOfferInfo>();
  for (const row of result.rows) {
    map.set(Number(row.id), {
      lastOfferPrice: row.offer_price,
      lastOfferDate: row.mail_date,
      offerCount: Number(row.offer_count),
    });
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
}

interface OwnerPreview {
  id: number;
  ownerName: string;
}

const RELATED_RECORD_PREVIEW_LIMIT = 3;

async function getPropertiesByOwner(
  ownerIds: number[]
): Promise<Map<number, { propertyCount: number; properties: PropertyPreview[] }>> {
  if (ownerIds.length === 0) return new Map();
  const result = await db.execute<{ owner_id: number; property_count: string; properties: PropertyPreview[] }>(sql`
    SELECT po.owner_id,
           count(*) AS property_count,
           json_agg(json_build_object('id', p.id, 'apn', p.apn) ORDER BY p.id ASC) AS properties
    FROM property_owners po
    JOIN properties p ON p.id = po.property_id
    WHERE po.owner_id = ANY(${ownerIds})
    GROUP BY po.owner_id
  `);
  const map = new Map<number, { propertyCount: number; properties: PropertyPreview[] }>();
  for (const row of result.rows) {
    const all = Array.isArray(row.properties) ? row.properties : [];
    map.set(Number(row.owner_id), {
      propertyCount: Number(row.property_count),
      properties: all.slice(0, RELATED_RECORD_PREVIEW_LIMIT),
    });
  }
  return map;
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
    WHERE po.property_id = ANY(${propertyIds})
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
            WHERE po.property_id = ANY(${propertyIds})
            ORDER BY po.property_id, o.id ASC
          `)
        : Promise.resolve({ rows: [] as { property_id: number; owner_name: string }[] }),
      ownerIds.length > 0
        ? db.execute<{ owner_id: number; city: string | null; state: string | null }>(sql`
            SELECT DISTINCT ON (owner_id) owner_id, city, state
            FROM mailing_addresses
            WHERE owner_id = ANY(${ownerIds})
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

// GET /api/properties - List all (paginated), filter by state/county/APN
router.get('/properties', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { state, county, apn, sortBy = 'id', sortOrder = 'asc' } = req.query;

    let conditions = [];
    if (state) conditions.push(eq(properties.state, state as string));
    if (county) conditions.push(ilike(properties.county, `%${county}%`));
    if (apn) conditions.push(ilike(properties.apn, `%${apn}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(properties)
      .where(whereClause);
    const total = totalResult[0]?.count || 0;

    // Get paginated results
    const results = await db
      .select()
      .from(properties)
      .where(whereClause)
      .orderBy(getPropertyOrderBy(sortBy as string, sortOrder as string))
      .limit(limit)
      .offset(offset);

    const propertyIds = results.map((p) => p.id);
    const [lastOfferByProperty, ownersByProperty] = await Promise.all([
      getLastOfferByProperty(propertyIds),
      getOwnersByProperty(propertyIds),
    ]);
    const resultsWithRelations = results.map((p) => {
      const owners = ownersByProperty.get(p.id);
      return {
        ...withLastOffer(p, lastOfferByProperty),
        ownerCount: owners?.ownerCount ?? 0,
        owners: owners?.owners ?? [],
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
// (matched by APN) have their provided fields updated in place instead of
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

      const existing = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.apn, apn))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        skippedApns.push(apn);

        const updates: Record<string, any> = {};
        if (prop.state !== undefined) updates.state = prop.state;
        if (prop.county !== undefined) updates.county = prop.county;
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
        county: prop.county || null,
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
    const { name, firstName, lastName, ownerName, state, sortBy = 'id', sortOrder = 'asc' } = req.query;

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

    // For state filter, we need to check mailing addresses
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

    // If state filter is provided, filter results after fetching
    let filteredResults = results;
    if (state) {
      const ownersWithAddresses = await db
        .select({ ownerId: mailingAddresses.ownerId })
        .from(mailingAddresses)
        .where(eq(mailingAddresses.state, state as string));
      
      const ownerIds = new Set(ownersWithAddresses.map(o => o.ownerId));
      filteredResults = results.filter(o => ownerIds.has(o.id));
    }

    const ownerIdsForPage = filteredResults.map((o) => o.id);
    const [lastOfferByOwner, propertiesByOwner] = await Promise.all([
      getLastOfferByOwner(ownerIdsForPage),
      getPropertiesByOwner(ownerIdsForPage),
    ]);
    const resultsWithRelations = filteredResults.map((o) => {
      const properties = propertiesByOwner.get(o.id);
      return {
        ...withLastOffer(o, lastOfferByOwner),
        propertyCount: properties?.propertyCount ?? 0,
        properties: properties?.properties ?? [],
      };
    });

    res.json(successResponse(resultsWithRelations, {
      pagination: {
        total: state ? filteredResults.length : total,
        page,
        limit,
        totalPages: Math.ceil((state ? filteredResults.length : total) / limit),
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
        COALESCE(ARRAY_AGG(DISTINCT p.state) FILTER (WHERE p.state IS NOT NULL), ARRAY[]::varchar[]) AS states,
        COALESCE(ARRAY_AGG(DISTINCT p.county) FILTER (WHERE p.county IS NOT NULL), ARRAY[]::varchar[]) AS counties,
        COALESCE(cdc.leads_count, 0)::int AS leads_count,
        COALESCE(cdc.deals_count, 0)::int AS deals_count,
        COALESCE(csc.suppressions_count, 0)::int AS suppressions_count
      FROM campaigns c
      LEFT JOIN mailings m ON m.campaign_id = c.id
      LEFT JOIN properties p ON m.property_id = p.id
      LEFT JOIN (
        SELECT
          m1.campaign_id,
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
      GROUP BY c.id, c.name, c.link, c.created_at, cs.sample_source_link, cdc.leads_count, cdc.deals_count, csc.suppressions_count
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
    states: Array.isArray(r.states) ? r.states : [],
    counties: Array.isArray(r.counties) ? r.counties : [],
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
          orderCol = 'total_mailings';
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

    // Check if a campaign with the same normalized name exists
    const existing = await db
      .select()
      .from(campaigns)
      .where(ilike(campaigns.name, trimmedName))
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

      let filteredResults = results;
      if (state) {
        filteredResults = results.filter(
          (m) => m.mailingAddress?.state === state || m.property?.state === state
        );
      }

      return res.json(
        successResponse(filteredResults, {
          pagination: {
            total: state ? filteredResults.length : total,
            page,
            limit,
            totalPages: Math.ceil((state ? filteredResults.length : total) / limit),
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

    async function resolvePropertyId(item: any): Promise<{ propertyId: number | null; error?: string }> {
      if (item.propertyId !== undefined && item.propertyId !== null) {
        const id = Number(item.propertyId);
        if (!Number.isInteger(id)) return { propertyId: null, error: 'propertyId must be an integer' };
        if (!verifiedPropertyIds.has(id)) {
          const found = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, id)).limit(1);
          if (found.length === 0) return { propertyId: null, error: `propertyId ${id} not found` };
          verifiedPropertyIds.add(id);
        }
        return { propertyId: id };
      }

      if (typeof item.apn === 'string' && item.apn.trim()) {
        const apn = item.apn.trim();
        const cached = propertyIdByApn.get(apn);
        if (cached !== undefined) return { propertyId: cached };

        const existing = await db.select({ id: properties.id }).from(properties).where(eq(properties.apn, apn)).limit(1);
        if (existing.length > 0) {
          propertyIdByApn.set(apn, existing[0].id);
          return { propertyId: existing[0].id };
        }

        const createdProp = await db.insert(properties).values({
          apn,
          state: item.propertyState || null,
          county: item.propertyCounty || null,
          zip: item.propertyZip || null,
          rawData: item.propertyRawData,
        }).returning();
        propertyIdByApn.set(apn, createdProp[0].id);
        return { propertyId: createdProp[0].id };
      }

      return { propertyId: null };
    }

    async function resolveOwnerId(item: any): Promise<{ ownerId: number | null; mailingAddressId: number | null; error?: string }> {
      if (item.ownerId !== undefined && item.ownerId !== null) {
        const id = Number(item.ownerId);
        if (!Number.isInteger(id)) return { ownerId: null, mailingAddressId: null, error: 'ownerId must be an integer' };
        if (!verifiedOwnerIds.has(id)) {
          const found = await db.select({ id: owners.id }).from(owners).where(eq(owners.id, id)).limit(1);
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
          const createdOwner = await db.insert(owners).values({
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
          const addrResult = await db.insert(mailingAddresses).values({
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

    async function resolveCampaignId(item: any): Promise<{ campaignId: number | null; error?: string }> {
      if (item.campaignId !== undefined && item.campaignId !== null) {
        const id = Number(item.campaignId);
        if (!Number.isInteger(id)) return { campaignId: null, error: 'campaignId must be an integer' };
        if (!verifiedCampaignIds.has(id)) {
          const found = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, id)).limit(1);
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
          const createdCampaign = await db.insert(campaigns).values({
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

    for (let i = 0; i < mailingsList.length; i++) {
      const item = mailingsList[i];
      if (!item || typeof item !== 'object') {
        errors.push({ index: i, error: 'mailing item must be an object' });
        continue;
      }

      const propResult = await resolvePropertyId(item);
      if (propResult.error) {
        errors.push({ index: i, error: propResult.error });
        continue;
      }

      const ownerResult = await resolveOwnerId(item);
      if (ownerResult.error) {
        errors.push({ index: i, error: ownerResult.error });
        continue;
      }

      const campResult = await resolveCampaignId(item);
      if (campResult.error) {
        errors.push({ index: i, error: campResult.error });
        continue;
      }

      if (propResult.propertyId && ownerResult.ownerId) {
        await db.insert(propertyOwners).values({
          propertyId: propResult.propertyId,
          ownerId: ownerResult.ownerId,
        }).onConflictDoNothing();
      }

      const result = await db.insert(mailings).values({
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

// GET /api/mailings/by-state - Stats: count by state
router.get('/mailings/by-state', async (req, res) => {
  try {
    // Get all mailings with their mailing addresses
    const results = await db.query.mailings.findMany({
      with: {
        mailingAddress: true,
      },
    });

    // Calculate stats by state
    const stateCounts: Record<string, { count: number; offers: number }> = {};
    
    for (const mailing of results) {
      const state = mailing.mailingAddress?.state || 'Unknown';
      if (!stateCounts[state]) {
        stateCounts[state] = { count: 0, offers: 0 };
      }
      stateCounts[state].count++;
      stateCounts[state].offers += Number(mailing.offerPrice) || 0;
    }

    const stats = Object.entries(stateCounts)
      .map(([state, data]) => ({ state, ...data }))
      .sort((a, b) => b.count - a.count);

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching mailing stats by state:', error);
    res.status(500).json(errorResponse('Failed to fetch mailing stats'));
  }
});

// GET /api/mailings/by-county?state=X - Stats: count by county
router.get('/mailings/by-county', async (req, res) => {
  try {
    const { state } = req.query;

    // Get mailings with property info
    const results = await db.query.mailings.findMany({
      with: {
        property: true,
      },
    });

    // Filter by state if provided
    let filteredResults = results;
    if (state) {
      filteredResults = results.filter(m => m.property?.state === state);
    }

    // Calculate stats by county
    const countyCounts: Record<string, { count: number; state: string; offers: number }> = {};
    
    for (const mailing of filteredResults) {
      const county = mailing.property?.county || 'Unknown';
      const mailingState = mailing.property?.state || 'Unknown';
      const key = `${mailingState}-${county}`;
      
      if (!countyCounts[key]) {
        countyCounts[key] = { count: 0, state: mailingState, offers: 0 };
      }
      countyCounts[key].count++;
      countyCounts[key].offers += Number(mailing.offerPrice) || 0;
    }

    const stats = Object.entries(countyCounts)
      .map(([key, data]) => ({ county: key.split('-')[1] || key, ...data }))
      .sort((a, b) => b.count - a.count);

    res.json(successResponse(stats, { filter: state ? { state } : undefined }));
  } catch (error) {
    console.error('Error fetching mailing stats by county:', error);
    res.status(500).json(errorResponse('Failed to fetch mailing stats'));
  }
});

// ============================================================
// Deals/Responses Routes
// ============================================================

// GET /api/deals - List all deals/responses
router.get('/deals', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { isLead, isConversion, hitType, startDate, endDate, sortBy = 'id', sortOrder = 'desc' } = req.query;

    let conditions = [];
    if (isLead !== undefined) conditions.push(eq(deals.isLead, isLead === 'true'));
    if (isConversion !== undefined) conditions.push(eq(deals.isConversion, isConversion === 'true'));
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
    const validReasons = ['do_not_mail', 'bad_address', 'deceased', 'sold', 'other'];
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
    // Get all mailings with their mailDate
    const results = await db.query.mailings.findMany({
      orderBy: asc(mailings.mailDate),
      columns: {
        mailDate: true,
        createdAt: true,
      },
    });

    // Generate last 12 months including current month
    const months: { month: string; count: number }[] = [];
    const now = new Date();
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      months.push({ month: monthLabel, count: 0 });
    }

    // Count mailings per month
    for (const mailing of results) {
      const date = mailing.mailDate ? new Date(mailing.mailDate) : mailing.createdAt ? new Date(mailing.createdAt) : null;
      if (!date) continue;
      
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      const monthEntry = months.find(m => m.month === monthLabel);
      if (monthEntry) {
        monthEntry.count++;
      }
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
        orderBy: desc(deals.hitDate),
        limit: 5,
        with: {
          property: true,
          owner: true,
        },
      }),
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
      },
    };

    res.json(successResponse(stats));
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json(errorResponse('Failed to fetch dashboard stats'));
  }
});

export default router;
