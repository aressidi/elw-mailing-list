import { Router } from 'express';
import { eq, and, like, desc, asc, sql, count, isNull, not, or, gte, lte, inArray } from 'drizzle-orm';
import { db } from './db.js';
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

// ============================================================
// Owners Routes
// ============================================================

// GET /api/owners - List all (paginated), filter by name/state
router.get('/owners', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { name, state, sortBy = 'id', sortOrder = 'asc' } = req.query;

    let conditions = [];
    if (name) {
      conditions.push(
        or(
          like(owners.firstName, `%${name}%`),
          like(owners.lastName, `%${name}%`),
          like(owners.ownerName, `%${name}%`)
        )
      );
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

// ============================================================
// Campaigns Routes
// ============================================================

// GET /api/campaigns - List all campaigns
router.get('/campaigns', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { sortBy = 'id', sortOrder = 'desc' } = req.query;

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

// GET /api/campaigns/:id - Get campaign with mailings count
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

    // Calculate stats
    const mailingsCount = campaign.mailings?.length || 0;
    const totalOfferPrice = campaign.mailings?.reduce((sum, m) => sum + (Number(m.offerPrice) || 0), 0) || 0;

    res.json(successResponse({
      ...campaign,
      stats: {
        mailingsCount,
        totalOfferPrice,
      },
    }));
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json(errorResponse('Failed to fetch campaign'));
  }
});

// ============================================================
// Mailings Routes
// ============================================================

// GET /api/mailings - List all (paginated), filter by campaign/state/date
router.get('/mailings', async (req, res) => {
  try {
    const { limit, offset, page } = getPagination(req);
    const { campaignId, state, startDate, endDate, sortBy = 'id', sortOrder = 'desc' } = req.query;

    let conditions = [];
    if (campaignId) conditions.push(eq(mailings.campaignId, parseInt(campaignId as string)));
    if (startDate) conditions.push(gte(mailings.mailDate, new Date(startDate as string)));
    if (endDate) conditions.push(lte(mailings.mailDate, new Date(endDate as string)));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(mailings)
      .where(whereClause);
    const total = totalResult[0]?.count || 0;

    // Get paginated results with relations
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

    // Filter by state if requested (need to filter after fetch as state is in related tables)
    let filteredResults = results;
    if (state) {
      filteredResults = results.filter(m => 
        m.mailingAddress?.state === state || 
        m.property?.state === state
      );
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
    console.error('Error fetching mailings:', error);
    res.status(500).json(errorResponse('Failed to fetch mailings'));
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
