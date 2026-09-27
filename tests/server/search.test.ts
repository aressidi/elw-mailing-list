import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetDb, loadApp, addProperty, addOwner, addAddress, linkOwner, addCampaign, addMailing } from './helpers.ts';

// GET /api/search — the header "Search APN, owner name..." box. Matches
// properties by APN (formatting-tolerant), county or zip; owners by first,
// last, full name, or reversed "last first" name.

let app: Express;

beforeAll(async () => {
  app = await loadApp();
  await resetDb();
  const moore = await addProperty({ apn: '115-01009009', state: 'NC', county: 'Moore', zip: '28374' });
  await addProperty({ apn: 'WAKE-0001', state: 'NC', county: 'Wake', zip: '27601' });
  const john = await addOwner({ ownerName: 'John Smith', firstName: 'John', lastName: 'Smith' });
  await addAddress({ ownerId: john.id, addressLine1: '5 Pine Rd', city: 'Pinehurst', state: 'NC', zip: '28374' });
  await linkOwner(moore.id, john.id);
  const c = await addCampaign({ name: 'Search Campaign' });
  await addMailing({ propertyId: moore.id, ownerId: john.id, campaignId: c.id, mailDate: new Date('2026-02-01T12:00:00Z'), offerPrice: '8800.00' });
  for (const first of ['Amy', 'Ben', 'Cal']) {
    await addOwner({ ownerName: `${first} Taylor`, firstName: first, lastName: 'Taylor' });
  }
});

describe('GET /api/search', () => {
  it.each([
    ['exact formatted APN', '115-01009009'],
    ['APN typed without dashes', '11501009009'],
    ['APN typed with spaces instead of dashes', '115 01009009'],
    ['partial APN', '0100900'],
  ])('finds a property by %s', async (_l, q) => {
    const res = await request(app).get('/api/search').query({ q });
    expect(res.status).toBe(200);
    expect(res.body.data.properties.map((p: any) => p.apn)).toContain('115-01009009');
  });

  it('finds properties by county and by zip', async () => {
    const byCounty = await request(app).get('/api/search').query({ q: 'wake' });
    expect(byCounty.body.data.properties.map((p: any) => p.apn)).toEqual(['WAKE-0001']);
    const byZip = await request(app).get('/api/search').query({ q: '27601' });
    expect(byZip.body.data.properties.map((p: any) => p.apn)).toEqual(['WAKE-0001']);
  });

  it.each([
    ['first name', 'john'],
    ['last name', 'SMITH'],
    ['full name', 'John Smith'],
    ['reversed "last first" name', 'Smith John'],
  ])('finds an owner by %s', async (_l, q) => {
    const res = await request(app).get('/api/search').query({ q });
    expect(res.body.data.owners.map((o: any) => o.ownerName)).toContain('John Smith');
  });

  it('adds disambiguating context: owner name on properties, mailing city/state on owners', async () => {
    const res = await request(app).get('/api/search').query({ q: '115-01009009' });
    expect(res.body.data.properties[0].ownerName).toBe('John Smith');

    const owners = await request(app).get('/api/search').query({ q: 'John Smith' });
    expect(owners.body.data.owners[0]).toMatchObject({ mailingCity: 'Pinehurst', mailingState: 'NC' });
  });

  it('includes the last offer on matched properties and owners', async () => {
    const res = await request(app).get('/api/search').query({ q: 'moore' });
    expect(Number(res.body.data.properties[0].lastOfferPrice)).toBe(8800);
    const owners = await request(app).get('/api/search').query({ q: 'john' });
    expect(Number(owners.body.data.owners[0].lastOfferPrice)).toBe(8800);
  });

  it('limits results per group but reports the full match counts', async () => {
    const res = await request(app).get('/api/search').query({ q: 'taylor', limit: 2 });
    expect(res.body.data.owners).toHaveLength(2);
    expect(res.body.counts).toEqual({ properties: 0, owners: 3 });
  });

  it('echoes the trimmed query', async () => {
    const res = await request(app).get('/api/search').query({ q: '  taylor  ' });
    expect(res.body.query).toBe('taylor');
  });

  it('returns empty groups (not an error) when nothing matches', async () => {
    const res = await request(app).get('/api/search').query({ q: 'qqqqzzzz' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ properties: [], owners: [] });
    expect(res.body.counts).toEqual({ properties: 0, owners: 0 });
  });

  it.each([[{}], [{ q: '' }], [{ q: '    ' }]])('requires a non-blank q (%j) with 400', async (query) => {
    const res = await request(app).get('/api/search').query(query);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });
});
