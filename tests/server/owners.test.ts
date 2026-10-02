import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addAddress, linkOwner, addCampaign, addMailing, addDeal,
  addSuppression, countRows,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('GET /api/owners (list)', () => {
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    await resetDb();
    const specs = [
      { ownerName: 'John Smith', firstName: 'John', lastName: 'Smith' },
      { ownerName: 'Mary Johnson', firstName: 'Mary', lastName: 'Johnson' },
      { ownerName: 'Acme Land LLC', ownerType: 'llc' as const },
      { ownerName: 'Peter Parker', firstName: 'Peter', lastName: 'Parker' },
    ];
    for (const s of specs) ids[s.ownerName] = (await addOwner(s)).id;
    for (const apn of ['A-1', 'A-2', 'A-3', 'A-4', 'A-5']) {
      const p = await addProperty({ apn });
      await linkOwner(p.id, ids['Acme Land LLC']);
    }
  });

  it('returns the success envelope with pagination metadata', async () => {
    const res = await request(app).get('/api/owners');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.pagination).toEqual({ total: 4, page: 1, limit: 20, totalPages: 1 });
  });

  it('paginates', async () => {
    const res = await request(app).get('/api/owners').query({ limit: 3, page: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 4, page: 2, totalPages: 2 });
  });

  it('name filter matches first, last, or full owner name case-insensitively', async () => {
    const byLast = await request(app).get('/api/owners').query({ name: 'john' });
    // "john" hits John Smith (first name) and Mary Johnson (last name)
    expect(byLast.body.data.map((o: any) => o.ownerName).sort()).toEqual(['John Smith', 'Mary Johnson']);

    const byOwnerName = await request(app).get('/api/owners').query({ name: 'acme' });
    expect(byOwnerName.body.data.map((o: any) => o.ownerName)).toEqual(['Acme Land LLC']);
  });

  it('lastName filter only looks at last name', async () => {
    const res = await request(app).get('/api/owners').query({ lastName: 'john' });
    expect(res.body.data.map((o: any) => o.ownerName)).toEqual(['Mary Johnson']);
  });

  it('sorts by owner name descending on request', async () => {
    const res = await request(app).get('/api/owners').query({ sortBy: 'ownerName', sortOrder: 'desc' });
    const names = res.body.data.map((o: any) => o.ownerName);
    expect(names).toEqual([...names].sort().reverse());
  });

  it('previews at most 3 linked properties while reporting the true property count', async () => {
    const res = await request(app).get('/api/owners').query({ name: 'acme' });
    const acme = res.body.data[0];
    expect(acme.propertyCount).toBe(5);
    expect(acme.properties).toHaveLength(3);
    for (const p of acme.properties) expect(p).toEqual({ id: expect.any(Number), apn: expect.any(String) });
  });

  it('includes last-offer fields on every owner row', async () => {
    const res = await request(app).get('/api/owners');
    for (const o of res.body.data) {
      expect(o).toMatchObject({ lastOfferPrice: null, lastOfferDate: null, offerCount: 0 });
    }
  });
});

describe('GET /api/owners?state= (mailing-address state filter)', () => {
  beforeAll(async () => {
    await resetDb();
    // Owners created in id order; only the 1st and 3rd mail to NC.
    const a = await addOwner({ ownerName: 'NC Owner One' });
    const b = await addOwner({ ownerName: 'GA Owner' });
    const c = await addOwner({ ownerName: 'NC Owner Two' });
    await addAddress({ ownerId: a.id, addressLine1: '1 A St', city: 'Raleigh', state: 'NC', zip: '27601' });
    await addAddress({ ownerId: b.id, addressLine1: '2 B St', city: 'Atlanta', state: 'GA', zip: '30301' });
    await addAddress({ ownerId: c.id, addressLine1: '3 C St', city: 'Durham', state: 'NC', zip: '27701' });
  });

  it('returns only owners whose mailing address is in the state', async () => {
    const res = await request(app).get('/api/owners').query({ state: 'NC' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: any) => o.ownerName).sort()).toEqual(['NC Owner One', 'NC Owner Two']);
    expect(res.body.pagination.total).toBe(2);
  });

  it('finds matching owners even when they fall outside the first unfiltered page', async () => {
    // limit=1 → the filtered result set is 2 owners, so page 1 must contain one NC owner
    // and the total must say there are 2 of them.
    const res = await request(app).get('/api/owners').query({ state: 'NC', limit: 1, page: 1 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ownerName).toMatch(/^NC Owner/);
    expect(res.body.pagination).toMatchObject({ total: 2, totalPages: 2 });

    const page2 = await request(app).get('/api/owners').query({ state: 'NC', limit: 1, page: 2 });
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].ownerName).toMatch(/^NC Owner/);
    expect(page2.body.data[0].id).not.toBe(res.body.data[0].id);
  });
});

describe('GET /api/owners/search', () => {
  beforeAll(async () => {
    await resetDb();
    await addOwner({ ownerName: 'Grace Hopper', firstName: 'Grace', lastName: 'Hopper' });
    await addOwner({ ownerName: 'Hopper Family Trust', ownerType: 'trust' });
    await addOwner({ ownerName: 'Alan Turing', firstName: 'Alan', lastName: 'Turing' });
  });

  it('finds owners by any name field, case-insensitively', async () => {
    const res = await request(app).get('/api/owners/search').query({ q: 'HOPPER' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((o: any) => o.ownerName).sort()).toEqual(['Grace Hopper', 'Hopper Family Trust']);
    expect(res.body.query).toBe('HOPPER');
  });

  it('respects the limit parameter', async () => {
    const res = await request(app).get('/api/owners/search').query({ q: 'hopper', limit: 1 });
    expect(res.body.data).toHaveLength(1);
  });

  it('requires q with 400', async () => {
    const res = await request(app).get('/api/owners/search').query({ q: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/owners/:id', () => {
  let ownerId: number;

  beforeAll(async () => {
    await resetDb();
    const o = await addOwner({ ownerName: 'Detail Owner' });
    ownerId = o.id;
    const p = await addProperty({ apn: 'OWN-DETAIL-1', state: 'NC' });
    await linkOwner(p.id, o.id);
    await addAddress({ ownerId: o.id, addressLine1: '9 Elm', city: 'Cary', state: 'NC', zip: '27511' });
    const c = await addCampaign({ name: 'Owner Detail Campaign' });
    await addMailing({ propertyId: p.id, ownerId: o.id, campaignId: c.id, mailDate: new Date('2026-04-01T12:00:00Z'), offerPrice: '1234.00' });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'email' });
    await addSuppression({ propertyId: p.id, ownerId: o.id, reason: 'bad_address' });
  });

  it('returns the owner with properties, addresses, mailings, deals and suppressions', async () => {
    const res = await request(app).get(`/api/owners/${ownerId}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.ownerName).toBe('Detail Owner');
    expect(d.propertyOwners[0].property.apn).toBe('OWN-DETAIL-1');
    expect(d.mailingAddresses[0]).toMatchObject({ city: 'Cary', state: 'NC' });
    expect(d.mailings[0].campaign.name).toBe('Owner Detail Campaign');
    expect(d.mailings[0].property.apn).toBe('OWN-DETAIL-1');
    expect(d.deals[0]).toMatchObject({ hitType: 'email' });
    expect(d.suppressions[0]).toMatchObject({ reason: 'bad_address' });
    expect(Number(d.lastOfferPrice)).toBe(1234);
    expect(d.offerCount).toBe(1);
  });

  it('returns 404 for a missing owner', async () => {
    const res = await request(app).get('/api/owners/424242');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app).get('/api/owners/abc');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/owners/bulk — owner identity rule (name + zip + full address)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  const mainSt = { addressLine1: '1 Main St', city: 'Raleigh', state: 'NC', zip: '27601' };

  it('creates owners and their mailing addresses', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: 'Robert Lee', firstName: 'Robert', lastName: 'Lee', ...mainSt }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ created: 1, skipped: 0, errors: [] });

    const detail = await request(app).get(`/api/owners/${res.body.data.ids[0]}`);
    expect(detail.body.data.mailingAddresses[0]).toMatchObject(mainSt);
  });

  it('treats the same name at a different address as a different person', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [
        { ownerName: 'Robert Lee', ...mainSt },
        { ownerName: 'Robert Lee', addressLine1: '77 Oak Ave', city: 'Austin', state: 'TX', zip: '78701' },
      ],
    });
    expect(res.body.data).toMatchObject({ created: 2, skipped: 0 });
    expect(await countRows('owners')).toBe(2);
  });

  it('treats the same name and street at a different zip as a different person', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: 'Robert Lee', ...mainSt }, { ownerName: 'Robert Lee', ...mainSt, zip: '27602' }],
    });
    expect(res.body.data.created).toBe(2);
  });

  it('reuses an existing owner when name and full address match, ignoring case and extra whitespace', async () => {
    await request(app).post('/api/owners/bulk').send({ owners: [{ ownerName: 'Robert Lee', ...mainSt }] });
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: '  robert   LEE ', addressLine1: '1 MAIN ST', city: 'raleigh', state: 'nc', zip: '27601' }],
    });
    expect(res.body.data).toMatchObject({ created: 0, skipped: 1 });
    expect(await countRows('owners')).toBe(1);
  });

  it('keeps generational suffixes distinct (Jr is not the same person)', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: 'Robert Lee', ...mainSt }, { ownerName: 'Robert Lee Jr', ...mainSt }],
    });
    expect(res.body.data.created).toBe(2);
  });

  it('dedupes repeats within the same batch', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: 'Robert Lee', ...mainSt }, { ownerName: 'Robert Lee', ...mainSt }],
    });
    expect(res.body.data).toMatchObject({ created: 1, skipped: 1 });
  });

  it('reports items without an ownerName per-index', async () => {
    const res = await request(app).post('/api/owners/bulk').send({
      owners: [{ ownerName: 'Valid' }, { firstName: 'No', lastName: 'Name' }, { ownerName: '   ' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.errors.map((e: any) => e.index)).toEqual([1, 2]);
  });

  it.each([
    ['missing owners', {}],
    ['empty array', { owners: [] }],
  ])('rejects %s with 400', async (_l, body) => {
    const res = await request(app).post('/api/owners/bulk').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects batches over 500 items with 400', async () => {
    const owners = Array.from({ length: 501 }, (_, i) => ({ ownerName: `Owner ${i}` }));
    const res = await request(app).post('/api/owners/bulk').send({ owners });
    expect(res.status).toBe(400);
    expect(await countRows('owners')).toBe(0);
  });
});
