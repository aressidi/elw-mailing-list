import { Router } from 'express';
import { eq, and, like, ilike, desc, asc, sql, count, isNull, not, or, gte, lte, inArray } from 'drizzle-orm';
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

const router = Router();

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
// Properties Routes
// ============================================================

// GET /api/properties - List all (paginated), filter by state/county/APN
router.get('/properties', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { state, county, apn, sortBy = 'id', sortOrder = 'asc' } = req.query;

    let conditions = [];
    if (state) conditions.push(eq(properties.state, state as string));
    if (county) conditions.push(like(properties.county, `%${county}%`));
    if (apn) conditions.push(like(properties.apn, `%${apn}%`));

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

    res.json(successResponse(results, {
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
          like(properties.apn, searchTerm),
          like(properties.county, searchTerm),
          like(properties.zip, searchTerm)
        )
      )
      .limit(limit);

    res.json(successResponse(results, { query: q }));
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

    res.json(successResponse(property));
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json(errorResponse('Failed to fetch property'));
  }
});

// POST /api/properties/bulk - Bulk create properties
router.post('/properties/bulk', async (req, res) => {
  try {
    const { properties: propertiesList } = req.body;

    if (!Array.isArray(propertiesList) || propertiesList.length === 0) {
      return res.status(400).json(errorResponse('properties array is required and must not be empty', 400));
    }

    const createdIds: number[] = [];
    let created = 0;
    let duplicates = 0;

    for (const prop of propertiesList) {
      // Check for duplicate by APN
      const existing = await db
        .select()
        .from(properties)
        .where(eq(properties.apn, prop.apn))
        .limit(1);

      if (existing.length > 0) {
        duplicates++;
        continue;
      }

      const result = await db.insert(properties).values({
        apn: prop.apn,
        state: prop.state,
        county: prop.county,
        acres: prop.acres,
        legalDescription: prop.legalDescription,
        zip: prop.zip,
        latitude: prop.latitude,
        longitude: prop.longitude,
      }).returning();

      if (result[0]) {
        createdIds.push(result[0].id);
        created++;
      }
    }

    res.status(201).json(successResponse({
      created,
      duplicates,
      ids: createdIds,
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

    res.json(successResponse(filteredResults, {
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
          like(owners.firstName, searchTerm),
          like(owners.lastName, searchTerm),
          like(owners.ownerName, searchTerm)
        )
      )
      .limit(limit);

    res.json(successResponse(results, { query: q }));
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

    res.json(successResponse(owner));
  } catch (error) {
    console.error('Error fetching owner:', error);
    res.status(500).json(errorResponse('Failed to fetch owner'));
  }
});

// POST /api/owners/bulk - Bulk create owners
router.post('/owners/bulk', async (req, res) => {
  try {
    const { owners: ownersList } = req.body;

    if (!Array.isArray(ownersList) || ownersList.length === 0) {
      return res.status(400).json(errorResponse('owners array is required and must not be empty', 400));
    }

    // Pre-fetch all existing owner names for duplicate detection
    const allOwners = await db.select({ id: owners.id, ownerName: owners.ownerName }).from(owners);
    const existingNormalizedNames = new Set(
      allOwners.map(o => o.ownerName.replace(/\s+/g, '').toLowerCase())
    );

    const createdIds: number[] = [];
    let created = 0;
    let duplicates = 0;

    for (const owner of ownersList) {
      const normalizedName = owner.ownerName?.replace(/\s+/g, '').toLowerCase();

      if (!normalizedName || existingNormalizedNames.has(normalizedName)) {
        duplicates++;
        continue;
      }

      const result = await db.insert(owners).values({
        ownerName: owner.ownerName,
        firstName: owner.firstName,
        lastName: owner.lastName,
        ownerType: owner.ownerType,
      }).returning();

      if (result[0]) {
        createdIds.push(result[0].id);
        created++;
        existingNormalizedNames.add(normalizedName);
      }
    }

    res.status(201).json(successResponse({
      created,
      duplicates,
      ids: createdIds,
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

// POST /api/campaigns - Create single campaign
router.post('/campaigns', async (req, res) => {
  try {
    const { name, link } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json(errorResponse('name is required', 400));
    }

    // Check if campaign with same name exists
    const existing = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.name, name.trim()))
      .limit(1);

    if (existing.length > 0) {
      return res.status(409).json(errorResponse('Campaign with this name already exists', 409));
    }

    const result = await db.insert(campaigns).values({
      name: name.trim(),
      link,
    }).returning();

    res.status(201).json(successResponse(result[0]));
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

// POST /api/mailings/bulk - Bulk create mailings
router.post('/mailings/bulk', async (req, res) => {
  try {
    const { campaignId, mailings: mailingsList } = req.body;

    if (!campaignId || typeof campaignId !== 'number') {
      return res.status(400).json(errorResponse('campaignId is required and must be a number', 400));
    }

    if (!Array.isArray(mailingsList) || mailingsList.length === 0) {
      return res.status(400).json(errorResponse('mailings array is required and must not be empty', 400));
    }

    // Verify campaign exists
    const campaign = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (campaign.length === 0) {
      return res.status(404).json(errorResponse('Campaign not found', 404));
    }

    const createdIds: number[] = [];
    let created = 0;

    for (const mailing of mailingsList) {
      const result = await db.insert(mailings).values({
        campaignId,
        propertyId: mailing.propertyId,
        ownerId: mailing.ownerId,
        mailingAddressId: mailing.mailingAddressId,
        mailDate: mailing.mailDate ? new Date(mailing.mailDate) : null,
        offerPrice: mailing.offerPrice,
      }).returning();

      if (result[0]) {
        createdIds.push(result[0].id);
        created++;
      }
    }

    res.status(201).json(successResponse({
      created,
      ids: createdIds,
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
