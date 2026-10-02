import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addCampaign, addMailing, addDeal, addSuppression, countRows,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('deals', () => {
  beforeAll(async () => {
    await resetDb();
    const p = await addProperty({ apn: 'DEAL-P', state: 'NC', county: 'Wake' });
    const o = await addOwner({ ownerName: 'Deal Owner' });
    const c = await addCampaign({ name: 'Deal Campaign' });
    for (let i = 0; i < 8; i++) await addMailing({ campaignId: c.id, propertyId: p.id, ownerId: o.id });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'call', isLead: true, isConversion: false, hitDate: new Date('2026-01-10T12:00:00Z') });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'email', isLead: true, isConversion: true, hitDate: new Date('2026-02-10T12:00:00Z') });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'text', isLead: false, isConversion: false, hitDate: new Date('2026-03-10T12:00:00Z') });
    await addDeal({ propertyId: p.id, ownerId: o.id, hitType: 'call', isLead: false, isConversion: false, hitDate: new Date('2026-04-10T12:00:00Z') });
  });

  describe('GET /api/deals', () => {
    it('lists deals with their property and owner, and pagination metadata', async () => {
      const res = await request(app).get('/api/deals');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);
      expect(res.body.data[0].property.apn).toBe('DEAL-P');
      expect(res.body.data[0].owner.ownerName).toBe('Deal Owner');
      expect(res.body.pagination).toEqual({ total: 4, page: 1, limit: 20, totalPages: 1 });
    });

    it('filters to leads', async () => {
      const res = await request(app).get('/api/deals').query({ isLead: 'true' });
      expect(res.body.data.map((d: any) => d.hitType).sort()).toEqual(['call', 'email']);
      expect(res.body.pagination.total).toBe(2);
    });

    it('filters to non-conversions', async () => {
      const res = await request(app).get('/api/deals').query({ isConversion: 'false' });
      expect(res.body.pagination.total).toBe(3);
    });

    it('filters by hit type', async () => {
      const res = await request(app).get('/api/deals').query({ hitType: 'call' });
      expect(res.body.pagination.total).toBe(2);
      for (const d of res.body.data) expect(d.hitType).toBe('call');
    });

    it('filters by hit date range', async () => {
      const res = await request(app).get('/api/deals').query({ startDate: '2026-02-01', endDate: '2026-03-31' });
      expect(res.body.data.map((d: any) => d.hitType).sort()).toEqual(['email', 'text']);
    });

    it('sorts by hit date ascending on request', async () => {
      const res = await request(app).get('/api/deals').query({ sortBy: 'hitDate', sortOrder: 'asc' });
      expect(res.body.data.map((d: any) => d.hitType)).toEqual(['call', 'email', 'text', 'call']);
    });

    it('paginates', async () => {
      const res = await request(app).get('/api/deals').query({ limit: 3, page: 2 });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ total: 4, totalPages: 2 });
    });
  });

  describe('GET /api/deals/stats', () => {
    it('reports totals and response / lead / conversion rates as percentages', async () => {
      const res = await request(app).get('/api/deals/stats');
      expect(res.status).toBe(200);
      const s = res.body.data;
      expect(s).toMatchObject({ totalDeals: 4, totalLeads: 2, totalConversions: 1, totalMailings: 8 });
      expect(Number(s.responseRate)).toBe(50); // 4 deals / 8 mailings
      expect(Number(s.leadRate)).toBe(50); // 2 leads / 4 deals
      expect(Number(s.conversionRate)).toBe(25); // 1 conversion / 4 deals
    });

    it('breaks deals down by hit type', async () => {
      const res = await request(app).get('/api/deals/stats');
      const byType = Object.fromEntries(res.body.data.byType.map((b: any) => [b.hitType, Number(b.count)]));
      expect(byType).toEqual({ call: 2, email: 1, text: 1 });
    });

    it('restricts deal counts to the requested date range', async () => {
      const res = await request(app).get('/api/deals/stats').query({ startDate: '2026-03-01' });
      expect(res.body.data).toMatchObject({ totalDeals: 2, totalLeads: 0, totalConversions: 0 });
    });
  });
});

describe('GET /api/deals/stats with no data', () => {
  it('reports zero rates instead of dividing by zero', async () => {
    await resetDb();
    const res = await request(app).get('/api/deals/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalDeals: 0, totalMailings: 0, byType: [] });
    for (const k of ['responseRate', 'leadRate', 'conversionRate']) expect(Number(res.body.data[k])).toBe(0);
  });
});

describe('suppression', () => {
  let ownerId: number, propertyId: number, otherPropertyId: number;

  beforeEach(async () => {
    await resetDb();
    ownerId = (await addOwner({ ownerName: 'Suppressed Owner' })).id;
    propertyId = (await addProperty({ apn: 'SUP-1' })).id;
    otherPropertyId = (await addProperty({ apn: 'SUP-2' })).id;
  });

  describe('GET /api/suppression', () => {
    beforeEach(async () => {
      await addSuppression({ ownerId, propertyId, reason: 'do_not_mail' });
      await addSuppression({ ownerId, propertyId: otherPropertyId, reason: 'bad_address' });
    });

    it('lists suppressions with owner and property', async () => {
      const res = await request(app).get('/api/suppression');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      for (const s of res.body.data) {
        expect(s.owner.ownerName).toBe('Suppressed Owner');
        expect(s.property.apn).toMatch(/^SUP-/);
      }
      expect(res.body.pagination).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('filters by reason', async () => {
      const res = await request(app).get('/api/suppression').query({ reason: 'do_not_mail' });
      expect(res.body.data.map((s: any) => s.property.apn)).toEqual(['SUP-1']);
      expect(res.body.pagination.total).toBe(1);
    });
  });

  describe('POST /api/suppression', () => {
    it('creates a suppression with 201, defaulting the reason to do_not_mail', async () => {
      const res = await request(app).post('/api/suppression').send({ ownerId, propertyId });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({ ownerId, propertyId, reason: 'do_not_mail' });
    });

    it.each(['do_not_mail', 'bad_address'])('accepts reason %j', async (reason) => {
      const res = await request(app).post('/api/suppression').send({ ownerId, propertyId, reason });
      expect(res.status).toBe(201);
      expect(res.body.data.reason).toBe(reason);
    });

    it.each(['deceased', 'sold', 'other'])('rejects retired reason %j with 400', async (reason) => {
      const res = await request(app).post('/api/suppression').send({ ownerId, propertyId, reason });
      expect(res.status).toBe(400);
      expect(await countRows('mailing_suppression')).toBe(0);
    });

    it('refuses a duplicate owner+property suppression with 409', async () => {
      await request(app).post('/api/suppression').send({ ownerId, propertyId });
      const res = await request(app).post('/api/suppression').send({ ownerId, propertyId, reason: 'bad_address' });
      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(await countRows('mailing_suppression')).toBe(1);
    });

    it.each([
      ['missing ownerId', () => ({ propertyId })],
      ['missing propertyId', () => ({ ownerId })],
      ['invalid reason', () => ({ ownerId, propertyId, reason: 'annoyed' })],
    ])('rejects %s with 400', async (_l, body) => {
      const res = await request(app).post('/api/suppression').send(body());
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(await countRows('mailing_suppression')).toBe(0);
    });

    it('rejects a reference to an owner that does not exist with a 4xx, not a server error', async () => {
      const res = await request(app).post('/api/suppression').send({ ownerId: 999999, propertyId });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.success).toBe(false);
    });

    it('rejects a non-numeric ownerId with a 4xx, not a server error', async () => {
      const res = await request(app).post('/api/suppression').send({ ownerId: 'abc', propertyId });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
