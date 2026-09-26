import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addAddress, addCampaign, addMailing, countRows, pool,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('GET /api/mailings (aggregated: one row per campaign)', () => {
  let ncSpring: number, gaSummer: number;

  beforeAll(async () => {
    await resetDb();
    ncSpring = (await addCampaign({ name: 'NC Spring' })).id;
    gaSummer = (await addCampaign({ name: 'GA Summer' })).id;
    const wake1 = await addProperty({ apn: 'M-WAKE-1', state: 'NC', county: 'Wake' });
    const wake2 = await addProperty({ apn: 'M-WAKE-2', state: 'NC', county: 'Wake' });
    const fulton = await addProperty({ apn: 'M-FUL-1', state: 'GA', county: 'Fulton' });
    await addMailing({ campaignId: ncSpring, propertyId: wake1.id, mailDate: new Date('2026-03-01T12:00:00Z'), offerPrice: '1000.00' });
    await addMailing({ campaignId: ncSpring, propertyId: wake2.id, mailDate: new Date('2026-03-10T12:00:00Z'), offerPrice: '1500.00' });
    await addMailing({ campaignId: gaSummer, propertyId: fulton.id, mailDate: new Date('2026-06-01T12:00:00Z'), offerPrice: '700.00' });
  });

  it('returns one aggregated row per campaign with totals', async () => {
    const res = await request(app).get('/api/mailings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const nc = res.body.data.find((r: any) => r.campaignId === ncSpring);
    expect(nc).toMatchObject({
      name: 'NC Spring', campaignName: 'NC Spring', totalMailings: 2, totalProperties: 2,
      totalOfferAmount: 2500, states: ['NC'], counties: ['Wake'],
    });
    expect(new Date(nc.mailDate).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(new Date(nc.latestMailDate).toISOString()).toBe('2026-03-10T12:00:00.000Z');
    expect(res.body.pagination).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
  });

  it('lists the most recently mailed campaign first by default', async () => {
    const res = await request(app).get('/api/mailings');
    expect(res.body.data.map((r: any) => r.campaignId)).toEqual([gaSummer, ncSpring]);
  });

  it.each(['NC', 'nc', ' Nc '])('filters by state case-insensitively (%j)', async (state) => {
    const res = await request(app).get('/api/mailings').query({ state });
    expect(res.body.data.map((r: any) => r.campaignId)).toEqual([ncSpring]);
    expect(res.body.pagination.total).toBe(1);
  });

  it('filters by partial county, case-insensitively', async () => {
    const res = await request(app).get('/api/mailings').query({ county: 'FULT' });
    expect(res.body.data.map((r: any) => r.campaignId)).toEqual([gaSummer]);
  });

  it('searches by campaign name', async () => {
    const res = await request(app).get('/api/mailings').query({ search: 'spring' });
    expect(res.body.data.map((r: any) => r.campaignId)).toEqual([ncSpring]);
  });

  it('filters by mail date range', async () => {
    const after = await request(app).get('/api/mailings').query({ startDate: '2026-05-01' });
    expect(after.body.data.map((r: any) => r.campaignId)).toEqual([gaSummer]);
    const before = await request(app).get('/api/mailings').query({ endDate: '2026-04-01' });
    expect(before.body.data.map((r: any) => r.campaignId)).toEqual([ncSpring]);
  });

  it('returns an empty page with total 0 when nothing matches', async () => {
    const res = await request(app).get('/api/mailings').query({ state: 'WY' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ total: 0, totalPages: 0 });
  });

  it('paginates with an accurate total', async () => {
    const res = await request(app).get('/api/mailings').query({ limit: 1, page: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ total: 2, page: 2, limit: 1, totalPages: 2 });
  });

  it('sorts by name ascending on request', async () => {
    const res = await request(app).get('/api/mailings').query({ sortBy: 'name', sortOrder: 'asc' });
    expect(res.body.data.map((r: any) => r.name)).toEqual(['GA Summer', 'NC Spring']);
  });
});

describe('GET /api/mailings?raw=true (individual mailings)', () => {
  let ncSpring: number, gaSummer: number;

  beforeAll(async () => {
    await resetDb();
    ncSpring = (await addCampaign({ name: 'Raw NC' })).id;
    gaSummer = (await addCampaign({ name: 'Raw GA' })).id;
    const nc = await addProperty({ apn: 'R-NC', state: 'NC', county: 'Wake' });
    const ga = await addProperty({ apn: 'R-GA', state: 'GA', county: 'Fulton' });
    const o = await addOwner({ ownerName: 'Raw Owner' });
    await addMailing({ campaignId: ncSpring, propertyId: nc.id, ownerId: o.id, mailDate: new Date('2026-01-01T12:00:00Z') });
    await addMailing({ campaignId: ncSpring, propertyId: nc.id, ownerId: o.id, mailDate: new Date('2026-02-01T12:00:00Z') });
    await addMailing({ campaignId: gaSummer, propertyId: ga.id, ownerId: o.id, mailDate: new Date('2026-03-01T12:00:00Z') });
  });

  it('returns individual mailings with their property, owner and campaign', async () => {
    const res = await request(app).get('/api/mailings').query({ raw: 'true' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    for (const m of res.body.data) {
      expect(m.property.apn).toMatch(/^R-/);
      expect(m.owner.ownerName).toBe('Raw Owner');
      expect(m.campaign.name).toMatch(/^Raw /);
    }
    expect(res.body.pagination.total).toBe(3);
  });

  it('filters by campaignId', async () => {
    const res = await request(app).get('/api/mailings').query({ raw: 'true', campaignId: gaSummer });
    expect(res.body.data.map((m: any) => m.property.apn)).toEqual(['R-GA']);
    expect(res.body.pagination.total).toBe(1);
  });

  it('filters by date range', async () => {
    const res = await request(app).get('/api/mailings')
      .query({ raw: 'true', startDate: '2026-01-15', endDate: '2026-02-15' });
    expect(res.body.data).toHaveLength(1);
    expect(new Date(res.body.data[0].mailDate).toISOString()).toBe('2026-02-01T12:00:00.000Z');
  });

  it('state filter finds matching mailings even when they are not on the first unfiltered page', async () => {
    // Oldest-first ordering puts the single GA mailing last; with limit=2 it is
    // outside the first page of *all* mailings but is the only GA result.
    const res = await request(app).get('/api/mailings')
      .query({ raw: 'true', state: 'GA', limit: 2, sortBy: 'mailDate', sortOrder: 'asc' });
    expect(res.body.data.map((m: any) => m.property.apn)).toEqual(['R-GA']);
    expect(res.body.pagination.total).toBe(1);
  });
});

describe('POST /api/mailings/bulk', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const item = {
    apn: 'BULK-1', propertyState: 'NC', propertyCounty: 'Wake', propertyZip: '27601', acres: 3.5,
    ownerName: 'Bulk Owner', addressLine1: '10 Elm St', city: 'Raleigh', state: 'NC', zip: '27601',
    campaignName: 'Bulk Campaign', mailDate: '2026-05-05T12:00:00Z', offerPrice: '12500.00',
  };

  it('creates the mailing and resolves/creates its property, owner, address and campaign', async () => {
    const res = await request(app).post('/api/mailings/bulk').send({ mailings: [item] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 1, errors: [] });
    expect(res.body.data.ids).toHaveLength(1);

    const props = await request(app).get('/api/properties').query({ apn: 'BULK-1' });
    const prop = props.body.data[0];
    expect(prop).toMatchObject({ state: 'NC', county: 'Wake', zip: '27601' });
    expect(Number(prop.acres)).toBe(3.5);

    const detail = await request(app).get(`/api/properties/${prop.id}`);
    // property ↔ owner link is recorded
    expect(detail.body.data.propertyOwners[0].owner.ownerName).toBe('Bulk Owner');
    expect(detail.body.data.propertyOwners[0].owner.mailingAddresses[0]).toMatchObject({ addressLine1: '10 Elm St', city: 'Raleigh' });
    expect(detail.body.data.mailings[0].campaign.name).toBe('Bulk Campaign');
    expect(Number(detail.body.data.mailings[0].offerPrice)).toBe(12500);
  });

  it('reuses the same property, owner and campaign for repeats within and across batches', async () => {
    await request(app).post('/api/mailings/bulk').send({ mailings: [item, { ...item, campaignName: 'bulk   CAMPAIGN' }] });
    await request(app).post('/api/mailings/bulk').send({ mailings: [{ ...item, ownerName: 'BULK OWNER' }] });
    expect(await countRows('mailings')).toBe(3);
    expect(await countRows('properties')).toBe(1);
    expect(await countRows('owners')).toBe(1);
    expect(await countRows('mailing_addresses')).toBe(1);
    expect(await countRows('campaigns')).toBe(1);
    expect(await countRows('property_owners')).toBe(1);
  });

  it('applies a top-level campaignId to items without their own campaign', async () => {
    const camp = await addCampaign({ name: 'Top Level' });
    const res = await request(app).post('/api/mailings/bulk').send({
      campaignId: camp.id,
      mailings: [{ apn: 'TL-1' }, { apn: 'TL-2', campaignName: 'Item Level' }],
    });
    expect(res.body.data.created).toBe(2);
    const { rows } = await pool.query(
      `SELECT p.apn, c.name FROM mailings m JOIN properties p ON p.id = m.property_id JOIN campaigns c ON c.id = m.campaign_id ORDER BY p.apn`
    );
    expect(rows).toEqual([{ apn: 'TL-1', name: 'Top Level' }, { apn: 'TL-2', name: 'Item Level' }]);
  });

  it('links to existing records by id', async () => {
    const p = await addProperty({ apn: 'EXIST-1' });
    const o = await addOwner({ ownerName: 'Existing Owner' });
    const c = await addCampaign({ name: 'Existing Campaign' });
    const res = await request(app).post('/api/mailings/bulk').send({
      mailings: [{ propertyId: p.id, ownerId: o.id, campaignId: c.id }],
    });
    expect(res.body.data.created).toBe(1);
    const detail = await request(app).get(`/api/owners/${o.id}`);
    expect(detail.body.data.mailings[0].property.apn).toBe('EXIST-1');
    expect(detail.body.data.mailings[0].campaign.name).toBe('Existing Campaign');
  });

  it('reports per-item errors for unknown ids / bad items while creating the valid ones', async () => {
    const res = await request(app).post('/api/mailings/bulk').send({
      mailings: [
        { apn: 'GOOD-1' },
        { propertyId: 999999 },
        { ownerId: 888888 },
        { campaignId: 777777 },
        { propertyId: 'abc' },
        'not-an-object',
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.errors.map((e: any) => e.index)).toEqual([1, 2, 3, 4, 5]);
    expect(await countRows('mailings')).toBe(1);
  });

  it('returns 404 and writes nothing when the top-level campaignId does not exist', async () => {
    const res = await request(app).post('/api/mailings/bulk').send({ campaignId: 5555, mailings: [{ apn: 'X-1' }] });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(await countRows('mailings')).toBe(0);
    expect(await countRows('properties')).toBe(0);
  });

  it('returns 400 when the top-level campaignId is not an integer', async () => {
    const res = await request(app).post('/api/mailings/bulk').send({ campaignId: 'abc', mailings: [{ apn: 'X-1' }] });
    expect(res.status).toBe(400);
  });

  it.each([
    ['missing mailings', {}],
    ['empty array', { mailings: [] }],
    ['over 500 items', { mailings: Array.from({ length: 501 }, () => ({})) }],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(app).post('/api/mailings/bulk').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await countRows('mailings')).toBe(0);
  });

  it('handles an unparseable mailDate as a client error, not a server crash', async () => {
    const res = await request(app).post('/api/mailings/bulk').send({
      mailings: [{ apn: 'DATE-OK', mailDate: '2026-01-01' }, { apn: 'DATE-BAD', mailDate: 'not a date' }],
    });
    expect(res.status).not.toBe(500);
    if (res.status === 201) {
      // Per-item reporting: the bad row is flagged, the good one is kept.
      expect(res.body.data.errors.map((e: any) => e.index)).toEqual([1]);
      expect(res.body.data.created).toBe(1);
    } else {
      // Whole-batch rejection: nothing is written.
      expect(res.status).toBe(400);
      expect(await countRows('mailings')).toBe(0);
    }
  });
});

describe('POST /api/mailings/move', () => {
  let from: number, to: number, mailingIds: number[];

  beforeEach(async () => {
    await resetDb();
    from = (await addCampaign({ name: 'From' })).id;
    to = (await addCampaign({ name: 'To' })).id;
    const p = await addProperty({ apn: 'MOVE-1', state: 'NC' });
    mailingIds = [];
    for (let i = 0; i < 3; i++) mailingIds.push((await addMailing({ campaignId: from, propertyId: p.id })).id);
  });

  it('moves the given mailings to the target campaign and reports how many moved', async () => {
    const res = await request(app).post('/api/mailings/move').send({ mailingIds: mailingIds.slice(0, 2), campaignId: to });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ moved: 2, campaignId: to });

    const target = await request(app).get(`/api/campaigns/${to}`);
    expect(target.body.data.stats.mailingsCount).toBe(2);
    const source = await request(app).get(`/api/campaigns/${from}`);
    expect(source.body.data.stats.mailingsCount).toBe(1);
  });

  it('only counts mailings that actually exist', async () => {
    const res = await request(app).post('/api/mailings/move').send({ mailingIds: [mailingIds[0], 999999], campaignId: to });
    expect(res.body.data.moved).toBe(1);
  });

  it('accepts a numeric-string campaignId', async () => {
    const res = await request(app).post('/api/mailings/move').send({ mailingIds, campaignId: String(to) });
    expect(res.status).toBe(200);
    expect(res.body.data.moved).toBe(3);
  });

  it('returns 404 and moves nothing when the target campaign does not exist', async () => {
    const res = await request(app).post('/api/mailings/move').send({ mailingIds, campaignId: 424242 });
    expect(res.status).toBe(404);
    const source = await request(app).get(`/api/campaigns/${from}`);
    expect(source.body.data.stats.mailingsCount).toBe(3);
  });

  it.each([
    ['missing mailingIds', () => ({ campaignId: 1 })],
    ['empty mailingIds', () => ({ mailingIds: [], campaignId: 1 })],
    ['non-integer mailingIds', () => ({ mailingIds: [1, 'two'], campaignId: 1 })],
    ['fractional mailingIds', () => ({ mailingIds: [1.5], campaignId: 1 })],
    ['more than 2000 ids', () => ({ mailingIds: Array.from({ length: 2001 }, (_, i) => i + 1), campaignId: 1 })],
    ['missing campaignId', () => ({ mailingIds: [1] })],
    ['non-integer campaignId', () => ({ mailingIds: [1], campaignId: 'abc' })],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(app).post('/api/mailings/move').send(body());
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/mailings/by-state', () => {
  beforeAll(async () => {
    await resetDb();
    const c = await addCampaign({ name: 'By State' });
    const ncOwner = await addOwner({ ownerName: 'NC Mailer' });
    const gaOwner = await addOwner({ ownerName: 'GA Mailer' });
    const ncAddr = await addAddress({ ownerId: ncOwner.id, addressLine1: '1', city: 'Raleigh', state: 'NC', zip: '1' });
    const gaAddr = await addAddress({ ownerId: gaOwner.id, addressLine1: '2', city: 'Atlanta', state: 'GA', zip: '2' });
    await addMailing({ campaignId: c.id, ownerId: ncOwner.id, mailingAddressId: ncAddr.id, offerPrice: '100.00' });
    await addMailing({ campaignId: c.id, ownerId: ncOwner.id, mailingAddressId: ncAddr.id, offerPrice: '200.00' });
    await addMailing({ campaignId: c.id, ownerId: ncOwner.id, mailingAddressId: ncAddr.id, offerPrice: null });
    await addMailing({ campaignId: c.id, ownerId: gaOwner.id, mailingAddressId: gaAddr.id, offerPrice: '50.00' });
    await addMailing({ campaignId: c.id, offerPrice: '5.00' });
  });

  it('counts mailings and sums offers per mailing-address state, most mailings first', async () => {
    const res = await request(app).get('/api/mailings/by-state');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      { state: 'NC', count: 3, offers: 300 },
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 1 }),
    ]);
    expect(res.body.data).toContainEqual({ state: 'GA', count: 1, offers: 50 });
  });

  it('groups mailings with no address under "Unknown"', async () => {
    const res = await request(app).get('/api/mailings/by-state');
    expect(res.body.data).toContainEqual({ state: 'Unknown', count: 1, offers: 5 });
  });
});
