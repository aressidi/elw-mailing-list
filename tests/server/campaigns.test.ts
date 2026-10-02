import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addAddress, addCampaign, addMailing, addDeal, addSuppression,
  addSourceLink, countRows,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

// Fixture shared by the stats tests: one campaign with 3 mailings to 2
// properties / 2 owners in NC, one lead + one conversion, one suppression.
async function seedStatsFixture() {
  await resetDb();
  const spring = await addCampaign({ name: 'Spring Mailer' });
  const empty = await addCampaign({ name: 'Empty Campaign' });
  const linked = await addCampaign({ name: 'Linked Campaign', link: 'https://docs.google.com/linked' });

  const wake = await addProperty({ apn: 'S-WAKE', state: 'NC', county: 'Wake' });
  const durham = await addProperty({ apn: 'S-DUR', state: 'NC', county: 'Durham' });
  await addSourceLink(wake.id, 'https://docs.google.com/from-source');
  const o1 = await addOwner({ ownerName: 'Owner One' });
  const o2 = await addOwner({ ownerName: 'Owner Two' });
  const a1 = await addAddress({ ownerId: o1.id, addressLine1: '1 St', city: 'Cary', state: 'NC', zip: '27511' });

  await addMailing({ campaignId: spring.id, propertyId: wake.id, ownerId: o1.id, mailingAddressId: a1.id, mailDate: new Date('2026-03-01T12:00:00Z'), offerPrice: '1000.00' });
  await addMailing({ campaignId: spring.id, propertyId: durham.id, ownerId: o2.id, mailDate: new Date('2026-04-01T12:00:00Z'), offerPrice: '2000.00' });
  await addMailing({ campaignId: spring.id, propertyId: wake.id, ownerId: o1.id, mailDate: new Date('2026-03-15T12:00:00Z'), offerPrice: '500.00' });

  await addDeal({ propertyId: wake.id, ownerId: o1.id, isLead: true, isConversion: false });
  await addDeal({ propertyId: durham.id, ownerId: o2.id, isLead: false, isConversion: true });
  await addSuppression({ propertyId: durham.id, ownerId: o2.id, reason: 'bad_address' });

  return { spring, empty, linked };
}

describe('GET /api/campaigns', () => {
  beforeAll(async () => {
    await resetDb();
    for (const name of ['Charlie', 'Alpha', 'Bravo']) await addCampaign({ name });
  });

  it('lists campaigns with pagination metadata', async () => {
    const res = await request(app).get('/api/campaigns');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toEqual({ total: 3, page: 1, limit: 20, totalPages: 1 });
  });

  it('sorts by name on request', async () => {
    const res = await request(app).get('/api/campaigns').query({ sortBy: 'name', sortOrder: 'asc' });
    expect(res.body.data.map((c: any) => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('paginates', async () => {
    const res = await request(app).get('/api/campaigns').query({ limit: 2, page: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 3, totalPages: 2 });
  });
});

describe('GET /api/campaigns?include=stats', () => {
  let ids: Awaited<ReturnType<typeof seedStatsFixture>>;

  beforeAll(async () => {
    ids = await seedStatsFixture();
  });

  async function statsFor(id: number) {
    const res = await request(app).get('/api/campaigns').query({ include: 'stats' });
    expect(res.status).toBe(200);
    return res.body.data.find((c: any) => c.id === id);
  }

  it('aggregates mailings, owners, properties, offers, states and counties per campaign', async () => {
    const s = await statsFor(ids.spring.id);
    expect(s).toMatchObject({
      name: 'Spring Mailer',
      totalMailings: 3,
      totalOwners: 2,
      totalProperties: 2,
      totalOfferAmount: 3500,
      states: ['NC'],
    });
    expect([...s.counties].sort()).toEqual(['Durham', 'Wake']);
    expect(new Date(s.firstMailDate).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(new Date(s.lastMailDate).toISOString()).toBe('2026-04-01T12:00:00.000Z');
  });

  it('counts leads, deals (conversions) and suppressions tied to the campaign', async () => {
    const s = await statsFor(ids.spring.id);
    expect(s).toMatchObject({ leadsCount: 1, dealsCount: 1, suppressionsCount: 1 });
  });

  it('still lists a campaign with zero mailings, with zeroed stats', async () => {
    const s = await statsFor(ids.empty.id);
    expect(s).toMatchObject({
      totalMailings: 0, totalOwners: 0, totalProperties: 0, totalOfferAmount: 0,
      states: [], counties: [], leadsCount: 0, dealsCount: 0, suppressionsCount: 0,
      firstMailDate: null, lastMailDate: null,
    });
  });

  it("uses the campaign's own link as its sheet link, falling back to a source link", async () => {
    expect((await statsFor(ids.linked.id)).googleSheetLink).toBe('https://docs.google.com/linked');
    expect((await statsFor(ids.spring.id)).googleSheetLink).toBe('https://docs.google.com/from-source');
    expect((await statsFor(ids.empty.id)).googleSheetLink).toBeNull();
  });

  it('sorts by total mailings on request', async () => {
    const res = await request(app).get('/api/campaigns').query({ include: 'stats', sortBy: 'totalMailings', sortOrder: 'desc' });
    expect(res.body.data[0].id).toBe(ids.spring.id);
  });

  it('paginates with an accurate total', async () => {
    const res = await request(app).get('/api/campaigns').query({ include: 'stats', limit: 2, page: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });
});

describe('GET /api/campaigns/:id', () => {
  let ids: Awaited<ReturnType<typeof seedStatsFixture>>;

  beforeAll(async () => {
    ids = await seedStatsFixture();
  });

  it('returns the campaign with its mailings (property, owner, address) and stats', async () => {
    const res = await request(app).get(`/api/campaigns/${ids.spring.id}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.name).toBe('Spring Mailer');
    expect(d.mailings).toHaveLength(3);
    const withAddress = d.mailings.find((m: any) => m.mailingAddress);
    expect(withAddress.mailingAddress.city).toBe('Cary');
    expect(withAddress.property.apn).toBe('S-WAKE');
    expect(withAddress.owner.ownerName).toBe('Owner One');
    expect(d.stats).toMatchObject({
      mailingsCount: 3, totalOfferPrice: 3500, totalOwners: 2, totalProperties: 2,
      states: ['NC'], leadsCount: 1, dealsCount: 1, suppressionsCount: 1,
    });
  });

  it('returns zeroed stats for a campaign with no mailings', async () => {
    const res = await request(app).get(`/api/campaigns/${ids.empty.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.mailings).toEqual([]);
    expect(res.body.data.stats).toMatchObject({ mailingsCount: 0, totalOfferPrice: 0, states: [], firstMailDate: null });
  });

  it('returns 404 for a missing campaign', async () => {
    const res = await request(app).get('/api/campaigns/987654');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/campaigns/xyz');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/campaigns (idempotent create)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a new campaign with 201 and created=true, storing the trimmed name', async () => {
    const res = await request(app).post('/api/campaigns').send({ name: '  Fall 2026  ', link: 'https://x' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, created: true });
    expect(res.body.data).toMatchObject({ name: 'Fall 2026', link: 'https://x' });
  });

  it('returns the existing campaign (200, created=false) for the same name in different case', async () => {
    const first = await request(app).post('/api/campaigns').send({ name: 'Fall 2026' });
    const again = await request(app).post('/api/campaigns').send({ name: 'FALL 2026' });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await countRows('campaigns')).toBe(1);
  });

  it('treats names differing only by internal whitespace as the same campaign', async () => {
    const first = await request(app).post('/api/campaigns').send({ name: 'Fall 2026 Mailer' });
    const again = await request(app).post('/api/campaigns').send({ name: 'Fall   2026  Mailer' });
    expect(again.body.created).toBe(false);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await countRows('campaigns')).toBe(1);
  });

  it('does not treat SQL wildcard characters in a name as wildcards', async () => {
    await request(app).post('/api/campaigns').send({ name: 'Spring1Mailer' });
    const res = await request(app).post('/api/campaigns').send({ name: 'Spring_Mailer' });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.data.name).toBe('Spring_Mailer');
  });

  it.each([
    ['missing name', {}],
    ['blank name', { name: '   ' }],
    ['non-string name', { name: 42 }],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(app).post('/api/campaigns').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(await countRows('campaigns')).toBe(0);
  });
});

describe('PATCH /api/campaigns/:id (rename)', () => {
  let a: { id: number }, b: { id: number };

  beforeEach(async () => {
    await resetDb();
    a = await addCampaign({ name: 'Campaign A' });
    b = await addCampaign({ name: 'Campaign B' });
  });

  it('renames a campaign and returns the updated row', async () => {
    const res = await request(app).patch(`/api/campaigns/${a.id}`).send({ name: '  Renamed A ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: a.id, name: 'Renamed A' });
    const detail = await request(app).get(`/api/campaigns/${a.id}`);
    expect(detail.body.data.name).toBe('Renamed A');
  });

  it('allows changing only the capitalisation of its own name', async () => {
    const res = await request(app).patch(`/api/campaigns/${a.id}`).send({ name: 'CAMPAIGN A' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('CAMPAIGN A');
  });

  it('refuses with 409 a name that collides with a different campaign (case/whitespace-insensitive)', async () => {
    const res = await request(app).patch(`/api/campaigns/${a.id}`).send({ name: 'campaign   b' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    const detail = await request(app).get(`/api/campaigns/${a.id}`);
    expect(detail.body.data.name).toBe('Campaign A');
  });

  it('returns 404 for a missing campaign', async () => {
    const res = await request(app).patch('/api/campaigns/99999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a non-numeric id or a blank name', async () => {
    expect((await request(app).patch('/api/campaigns/abc').send({ name: 'X' })).status).toBe(400);
    expect((await request(app).patch(`/api/campaigns/${b.id}`).send({ name: ' ' })).status).toBe(400);
    expect((await request(app).patch(`/api/campaigns/${b.id}`).send({})).status).toBe(400);
  });
});
