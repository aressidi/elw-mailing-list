import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addAddress, linkOwner, addCampaign, addMailing, addDeal, countRows, pool,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('GET /api/properties (list)', () => {
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await resetDb();
    const specs = [
      { apn: '100-200-001', state: 'NC', county: 'Wake', acres: '5.0000' },
      { apn: '100-200-002', state: 'NC', county: 'Wake', acres: '1.5000' },
      { apn: '300-400-003', state: 'NC', county: 'Durham', acres: '20.0000' },
      { apn: '500-600-004', state: 'GA', county: 'Fulton', acres: '0.2500' },
      { apn: '700-800-005', state: 'TX', county: 'Travis', acres: '10.0000' },
    ];
    for (const s of specs) ids[s.apn] = (await addProperty(s)).id;
  });

  it('returns the success envelope with pagination metadata', async () => {
    const res = await request(app).get('/api/properties');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.pagination).toEqual({ total: 5, page: 1, limit: 20, totalPages: 1 });
  });

  it('paginates: the last page holds the remainder', async () => {
    const res = await request(app).get('/api/properties').query({ limit: 2, page: 3 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ total: 5, page: 3, limit: 2, totalPages: 3 });
  });

  it('pages do not overlap and together cover every property', async () => {
    const seen = new Set<number>();
    for (const page of [1, 2, 3]) {
      const res = await request(app).get('/api/properties').query({ limit: 2, page });
      for (const p of res.body.data) seen.add(p.id);
    }
    expect([...seen].sort()).toEqual(Object.values(ids).sort());
  });

  it('returns an empty page (not an error) past the end', async () => {
    const res = await request(app).get('/api/properties').query({ limit: 2, page: 99 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(5);
  });

  it('falls back to sane pagination for nonsense page/limit values', async () => {
    const res = await request(app).get('/api/properties').query({ limit: 'abc', page: '-4' });
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBeGreaterThan(0);
  });

  it('caps very large page sizes', async () => {
    const res = await request(app).get('/api/properties').query({ limit: 100000 });
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBeLessThanOrEqual(100);
  });

  it('filters by state code', async () => {
    const res = await request(app).get('/api/properties').query({ state: 'NC' });
    expect(res.body.data.map((p: any) => p.apn).sort()).toEqual(['100-200-001', '100-200-002', '300-400-003']);
    expect(res.body.pagination.total).toBe(3);
  });

  it('filters by partial, case-insensitive county', async () => {
    const res = await request(app).get('/api/properties').query({ county: 'wak' });
    expect(res.body.data.map((p: any) => p.county)).toEqual(['Wake', 'Wake']);
  });

  it('filters by partial APN', async () => {
    const res = await request(app).get('/api/properties').query({ apn: '200-00' });
    expect(res.body.data.map((p: any) => p.apn).sort()).toEqual(['100-200-001', '100-200-002']);
  });

  it('combines filters with AND semantics', async () => {
    const res = await request(app).get('/api/properties').query({ state: 'NC', county: 'Durham' });
    expect(res.body.data.map((p: any) => p.apn)).toEqual(['300-400-003']);
  });

  it('returns nothing for a filter that matches nothing', async () => {
    const res = await request(app).get('/api/properties').query({ state: 'WY' });
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ total: 0, totalPages: 0 });
  });

  it('sorts by acres descending on request', async () => {
    const res = await request(app).get('/api/properties').query({ sortBy: 'acres', sortOrder: 'desc' });
    expect(res.body.data.map((p: any) => Number(p.acres))).toEqual([20, 10, 5, 1.5, 0.25]);
  });

  it('sorts by APN ascending on request', async () => {
    const res = await request(app).get('/api/properties').query({ sortBy: 'apn', sortOrder: 'asc' });
    const apns = res.body.data.map((p: any) => p.apn);
    expect(apns).toEqual([...apns].sort());
  });
});

describe('GET /api/properties — last offer and owner previews', () => {
  let withOffers: number, newestNull: number, noMailings: number, manyOwners: number;

  beforeAll(async () => {
    await resetDb();
    const camp = await addCampaign({ name: 'Offers' });
    withOffers = (await addProperty({ apn: 'OFFER-1' })).id;
    newestNull = (await addProperty({ apn: 'OFFER-2' })).id;
    noMailings = (await addProperty({ apn: 'OFFER-3' })).id;
    manyOwners = (await addProperty({ apn: 'OFFER-4' })).id;

    await addMailing({ propertyId: withOffers, campaignId: camp.id, mailDate: new Date('2026-01-15T12:00:00Z'), offerPrice: '100.00' });
    await addMailing({ propertyId: withOffers, campaignId: camp.id, mailDate: new Date('2026-03-15T12:00:00Z'), offerPrice: '300.00' });
    await addMailing({ propertyId: withOffers, campaignId: camp.id, mailDate: new Date('2026-02-15T12:00:00Z'), offerPrice: '200.00' });

    await addMailing({ propertyId: newestNull, campaignId: camp.id, mailDate: new Date('2026-01-01T12:00:00Z'), offerPrice: '50.00' });
    await addMailing({ propertyId: newestNull, campaignId: camp.id, mailDate: new Date('2026-06-01T12:00:00Z'), offerPrice: null });

    for (const name of ['Ann', 'Bob', 'Cat', 'Dan']) {
      const o = await addOwner({ ownerName: name });
      await linkOwner(manyOwners, o.id);
    }
  });

  async function fetchById(id: number) {
    const res = await request(app).get('/api/properties').query({ limit: 100 });
    return res.body.data.find((p: any) => p.id === id);
  }

  it('reports the offer from the most recent mailing, not the most recently inserted', async () => {
    const p = await fetchById(withOffers);
    expect(Number(p.lastOfferPrice)).toBe(300);
    expect(new Date(p.lastOfferDate).toISOString()).toBe('2026-03-15T12:00:00.000Z');
    expect(p.offerCount).toBe(3);
  });

  it('reports a null last offer (never 0) when the newest mailing has no offer', async () => {
    const p = await fetchById(newestNull);
    expect(p.lastOfferPrice).toBeNull();
    expect(p.offerCount).toBe(2);
  });

  it('reports no last offer and zero count for a never-mailed property', async () => {
    const p = await fetchById(noMailings);
    expect(p.lastOfferPrice).toBeNull();
    expect(p.lastOfferDate).toBeNull();
    expect(p.offerCount).toBe(0);
  });

  it('previews at most 3 linked owners while reporting the true owner count', async () => {
    const p = await fetchById(manyOwners);
    expect(p.ownerCount).toBe(4);
    expect(p.owners).toHaveLength(3);
    for (const o of p.owners) expect(o).toEqual({ id: expect.any(Number), ownerName: expect.any(String) });
  });

  it('shows an empty owner preview for an unlinked property', async () => {
    const p = await fetchById(noMailings);
    expect(p.ownerCount).toBe(0);
    expect(p.owners).toEqual([]);
  });
});

describe('GET /api/properties/search', () => {
  beforeAll(async () => {
    await resetDb();
    await addProperty({ apn: 'ABC-123', county: 'Harnett', zip: '27546' });
    await addProperty({ apn: 'XYZ-999', county: 'Lee', zip: '27330' });
  });

  it.each([['APN', 'abc'], ['county', 'harn'], ['zip', '2754']])('finds a property by %s', async (_l, q) => {
    const res = await request(app).get('/api/properties/search').query({ q });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.apn)).toEqual(['ABC-123']);
  });

  it('echoes the query and includes last-offer fields', async () => {
    const res = await request(app).get('/api/properties/search').query({ q: 'XYZ' });
    expect(res.body.query).toBe('XYZ');
    expect(res.body.data[0]).toMatchObject({ lastOfferPrice: null, offerCount: 0 });
  });

  it.each([[undefined], [''], ['   ']])('requires a non-blank q (q=%j) with 400', async (q) => {
    const res = await request(app).get('/api/properties/search').query(q === undefined ? {} : { q });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/q/);
  });
});

describe('GET /api/properties/:id', () => {
  let propertyId: number;

  beforeAll(async () => {
    await resetDb();
    const p = await addProperty({ apn: 'DETAIL-1', state: 'NC', county: 'Wake' });
    propertyId = p.id;
    const o = await addOwner({ ownerName: 'Jane Doe' });
    await addAddress({ ownerId: o.id, addressLine1: '1 Main St', city: 'Raleigh', state: 'NC', zip: '27601' });
    await linkOwner(p.id, o.id);
    const c = await addCampaign({ name: 'Detail Campaign' });
    await addMailing({ propertyId: p.id, ownerId: o.id, campaignId: c.id, mailDate: new Date('2026-05-01T12:00:00Z'), offerPrice: '4200.00' });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'call', isLead: true });
  });

  it('returns the property with owners (and their addresses), mailings with campaign, and deals', async () => {
    const res = await request(app).get(`/api/properties/${propertyId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.apn).toBe('DETAIL-1');
    expect(d.propertyOwners).toHaveLength(1);
    expect(d.propertyOwners[0].owner.ownerName).toBe('Jane Doe');
    expect(d.propertyOwners[0].owner.mailingAddresses[0]).toMatchObject({ city: 'Raleigh', state: 'NC' });
    expect(d.mailings).toHaveLength(1);
    expect(d.mailings[0].campaign.name).toBe('Detail Campaign');
    expect(d.deals).toHaveLength(1);
    expect(Number(d.lastOfferPrice)).toBe(4200);
    expect(d.offerCount).toBe(1);
  });

  it('returns 404 with the error envelope for a missing property', async () => {
    const res = await request(app).get('/api/properties/999999');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: expect.any(String) });
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/properties/not-a-number');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/properties/bulk', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates new properties and returns their ids with 201', async () => {
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [
        { apn: 'NEW-1', state: 'NC', county: 'Wake', acres: '2.5' },
        { apn: '  NEW-2  ', state: 'GA' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ created: 2, skipped: 0, skippedApns: [], errors: [] });
    expect(res.body.data.ids).toHaveLength(2);

    const list = await request(app).get('/api/properties').query({ apn: 'NEW-2' });
    expect(list.body.data[0].apn).toBe('NEW-2'); // stored trimmed
  });

  it('upserts by APN: an existing APN is reported as skipped and its fields are updated in place', async () => {
    const existing = await addProperty({ apn: 'DUP-1', state: 'NC', county: 'Wake' });
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [{ apn: 'DUP-1', county: 'Wake County', zip: '27601' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 0, skipped: 1, skippedApns: ['DUP-1'] });
    expect(await countRows('properties')).toBe(1);

    const detail = await request(app).get(`/api/properties/${existing.id}`);
    expect(detail.body.data.county).toBe('Wake'); // stored in canonical form
    expect(detail.body.data.zip).toBe('27601');
    expect(detail.body.data.state).toBe('NC'); // untouched field preserved
  });

  it('stores county in canonical form: Title Case, without a "County" suffix', async () => {
    const existing = await addProperty({ apn: 'CANON-0', state: 'TN', county: 'DAVIDSON' });
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [
        { apn: 'CANON-1', state: 'AZ', county: 'APACHE COUNTY' },
        { apn: 'CANON-2', state: 'AR', county: '  benton   county ' },
        { apn: 'CANON-3', state: 'FL', county: 'MIAMI-DADE' },
        { apn: 'CANON-4', state: 'FL', county: 'St. Lucie County' },
        { apn: 'CANON-5', state: 'NC', county: '   ' },
        { apn: 'CANON-0', state: 'TN', county: 'DAVIDSON COUNTY' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 5, skipped: 1, errors: [] });

    const { rows } = await pool.query('SELECT id, apn, county FROM properties ORDER BY apn');
    expect(rows).toEqual([
      { id: existing.id, apn: 'CANON-0', county: 'Davidson' },
      { id: expect.any(Number), apn: 'CANON-1', county: 'Apache' },
      { id: expect.any(Number), apn: 'CANON-2', county: 'Benton' },
      { id: expect.any(Number), apn: 'CANON-3', county: 'Miami-Dade' },
      { id: expect.any(Number), apn: 'CANON-4', county: 'St. Lucie' },
      { id: expect.any(Number), apn: 'CANON-5', county: null },
    ]);
  });

  it('treats the same APN in another county as a different parcel', async () => {
    await addProperty({ apn: '001-09955-000', state: 'AR', county: 'Washington' });
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [
        { apn: '001-09955-000', state: 'AR', county: 'JOHNSON COUNTY' },
        { apn: '001-09955-000', state: 'TX', county: 'Washington' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 2, skipped: 0, errors: [] });
    expect(await countRows('properties')).toBe(3);
  });

  it('rejects an APN with no location when that APN exists in more than one county', async () => {
    await addProperty({ apn: 'SHARED-1', state: 'AR', county: 'Washington' });
    await addProperty({ apn: 'SHARED-1', state: 'AR', county: 'Johnson' });
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [{ apn: 'SHARED-1', acres: '5' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 0, skipped: 0 });
    expect(res.body.data.errors).toEqual([{ index: 0, error: expect.stringContaining('more than one county') }]);
  });

  it('cannot store the same APN twice in one county, however the county is written', async () => {
    await addProperty({ apn: 'ONE-1', state: 'AR', county: 'Benton' });
    await expect(addProperty({ apn: 'ONE-1', state: 'AR', county: 'BENTON COUNTY' })).rejects.toThrow();
  });

  it('reports items without an APN per-index and still creates the rest', async () => {
    const res = await request(app).post('/api/properties/bulk').send({
      properties: [{ apn: 'OK-1' }, { state: 'NC' }, { apn: '   ' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.errors.map((e: any) => e.index)).toEqual([1, 2]);
  });

  it.each([
    ['missing properties', {}],
    ['empty array', { properties: [] }],
    ['non-array', { properties: { apn: 'X' } }],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(app).post('/api/properties/bulk').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects batches over 500 items with 400 and writes nothing', async () => {
    const properties = Array.from({ length: 501 }, (_, i) => ({ apn: `BIG-${i}` }));
    const res = await request(app).post('/api/properties/bulk').send({ properties });
    expect(res.status).toBe(400);
    expect(await countRows('properties')).toBe(0);
  });

  it('accepts a batch of exactly 500 items', async () => {
    const properties = Array.from({ length: 500 }, (_, i) => ({ apn: `EDGE-${i}` }));
    const res = await request(app).post('/api/properties/bulk').send({ properties });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(500);
  }, 30000);
});
