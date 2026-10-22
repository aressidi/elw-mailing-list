import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetDb, loadApp, addProperty, addOwner, addCampaign, addMailing } from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

describe('GET /api/mailings/by-month-detail', () => {
  it('returns an empty array on an empty database', async () => {
    await resetDb();
    const res = await request(app).get('/api/mailings/by-month-detail');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  describe('with data', () => {
    beforeAll(async () => {
      await resetDb();
      const ncA = await addProperty({ apn: 'MM-NC-1', state: 'NC', county: 'Wake' });
      const ncB = await addProperty({ apn: 'MM-NC-2', state: 'NC', county: 'Wake' });
      const scA = await addProperty({ apn: 'MM-SC-1', state: 'SC', county: 'York' });
      const flA = await addProperty({ apn: 'MM-FL-1', state: 'FL', county: 'Miami-Dade' });
      const owner = await addOwner({ ownerName: 'Month Owner' });

      const sept = await addCampaign({ name: 'September Push' });
      const septLate = await addCampaign({ name: 'September Late' });
      const aug = await addCampaign({ name: 'August Push' });

      // September 2026: campaign `sept` mails 3 (2x NC/Wake, 1x SC/York),
      // campaign `septLate` mails 1 (FL/Miami-Dade).
      await addMailing({ campaignId: sept.id, propertyId: ncA.id, ownerId: owner.id, mailDate: new Date('2026-09-03T00:00:00Z') });
      await addMailing({ campaignId: sept.id, propertyId: ncB.id, ownerId: owner.id, mailDate: new Date('2026-09-10T00:00:00Z') });
      await addMailing({ campaignId: sept.id, propertyId: scA.id, ownerId: owner.id, mailDate: new Date('2026-09-15T00:00:00Z') });
      await addMailing({ campaignId: septLate.id, propertyId: flA.id, ownerId: owner.id, mailDate: new Date('2026-09-20T00:00:00Z') });

      // August 2026: campaign `aug` mails 1 (NC/Wake).
      await addMailing({ campaignId: aug.id, propertyId: ncA.id, ownerId: owner.id, mailDate: new Date('2026-08-05T00:00:00Z') });

      // Undated mailing is excluded entirely.
      await addMailing({ campaignId: aug.id, propertyId: ncA.id, ownerId: owner.id, mailDate: null });
    });

    it('groups by month, newest first, with labels', async () => {
      const res = await request(app).get('/api/mailings/by-month-detail');
      expect(res.status).toBe(200);
      const months = res.body.data;
      expect(months.map((m: any) => m.month)).toEqual(['2026-09', '2026-08']);
      expect(months[0].monthLabel).toBe('September 2026');
      expect(months[1].monthLabel).toBe('August 2026');
    });

    it('reports per-month campaign count and total volume', async () => {
      const [sep, aug] = (await request(app).get('/api/mailings/by-month-detail')).body.data;
      expect(sep.campaignCount).toBe(2);
      expect(sep.totalVolume).toBe(4);
      expect(aug.campaignCount).toBe(1);
      expect(aug.totalVolume).toBe(1);
    });

    it('orders campaigns within a month by descending volume', async () => {
      const [sep] = (await request(app).get('/api/mailings/by-month-detail')).body.data;
      expect(sep.campaigns.map((c: any) => c.volume)).toEqual([3, 1]);
      expect(sep.campaigns[0].name).toBe('September Push');
    });

    it('breaks each campaign down by state and county', async () => {
      const [sep] = (await request(app).get('/api/mailings/by-month-detail')).body.data;
      const push = sep.campaigns.find((c: any) => c.name === 'September Push');
      expect(push.volume).toBe(3);
      expect(push.volumeByState).toEqual({ NC: 2, SC: 1 });
      expect(push.volumeByCounty).toEqual({ Wake: 2, York: 1 });
      expect(push.states).toEqual(['NC', 'SC']); // sorted by descending volume
      expect(push.counties).toEqual(['Wake', 'York']);
    });

    it('respects startDate / endDate filters', async () => {
      const res = await request(app)
        .get('/api/mailings/by-month-detail')
        .query({ startDate: '2026-09-01', endDate: '2026-09-30' });
      const months = res.body.data;
      expect(months.map((m: any) => m.month)).toEqual(['2026-09']);
      expect(months[0].totalVolume).toBe(4);
    });
  });
});
