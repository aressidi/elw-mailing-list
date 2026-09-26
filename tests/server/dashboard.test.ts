import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import {
  resetDb, loadApp, addProperty, addOwner, addCampaign, addMailing, addDeal, addSuppression,
} from './helpers.ts';

let app: Express;

beforeAll(async () => {
  app = await loadApp();
});

// Chart label format shown on the "Mail Volume by Month" x-axis, e.g. "Sep 2026".
const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

describe('GET /api/dashboard/stats', () => {
  it('reports all-zero counts and 0% rates on an empty database', async () => {
    await resetDb();
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    const o = res.body.data.overview;
    expect(o).toMatchObject({
      totalProperties: 0, totalOwners: 0, totalMailings: 0, totalCampaigns: 0,
      totalDeals: 0, totalLeads: 0, totalConversions: 0, totalSuppressed: 0,
    });
    for (const k of ['responseRate', 'leadRate', 'conversionRate']) expect(Number(o[k])).toBe(0);
    expect(res.body.data.recentActivity).toEqual({ mailings: [], deals: [] });
  });

  describe('with data', () => {
    beforeAll(async () => {
      await resetDb();
      const props = [];
      for (let i = 0; i < 3; i++) props.push(await addProperty({ apn: `DASH-${i}`, state: 'NC', county: 'Wake' }));
      const owners = [];
      for (let i = 0; i < 2; i++) owners.push(await addOwner({ ownerName: `Dash Owner ${i}` }));
      const c = await addCampaign({ name: 'Dash Campaign' });
      await addCampaign({ name: 'Dash Campaign 2' });
      // 10 mailings, created in order; the last 5 are the "recent" ones.
      for (let i = 0; i < 10; i++) {
        await addMailing({
          campaignId: c.id, propertyId: props[i % 3].id, ownerId: owners[i % 2].id,
          createdAt: new Date(Date.UTC(2026, 0, 1 + i)), offerPrice: String(1000 + i),
        });
      }
      // 6 deals: 3 leads, 1 conversion
      for (let i = 0; i < 6; i++) {
        await addDeal({
          propertyId: props[0].id, ownerId: owners[0].id, isLead: i < 3, isConversion: i === 0,
          hitDate: new Date(Date.UTC(2026, 1, 1 + i)),
        });
      }
      await addSuppression({ ownerId: owners[1].id, propertyId: props[1].id });
    });

    it('reports overview counts', async () => {
      const res = await request(app).get('/api/dashboard/stats');
      expect(res.body.data.overview).toMatchObject({
        totalProperties: 3, totalOwners: 2, totalMailings: 10, totalCampaigns: 2,
        totalDeals: 6, totalLeads: 3, totalConversions: 1, totalSuppressed: 1,
      });
    });

    it('reports response, lead and conversion rates as percentages', async () => {
      const o = (await request(app).get('/api/dashboard/stats')).body.data.overview;
      expect(Number(o.responseRate)).toBe(60); // 6 deals / 10 mailings
      expect(Number(o.leadRate)).toBe(50); // 3 / 6
      expect(Number(o.conversionRate)).toBeCloseTo(16.67, 2); // 1 / 6
    });

    it('shows the 5 newest mailings with property, owner and campaign', async () => {
      const { mailings } = (await request(app).get('/api/dashboard/stats')).body.data.recentActivity;
      expect(mailings).toHaveLength(5);
      expect(mailings.map((m: any) => Number(m.offerPrice))).toEqual([1009, 1008, 1007, 1006, 1005]);
      expect(mailings[0].property.apn).toMatch(/^DASH-/);
      expect(mailings[0].owner.ownerName).toMatch(/^Dash Owner/);
      expect(mailings[0].campaign.name).toBe('Dash Campaign');
    });

    it('shows the 5 most recent deals by hit date', async () => {
      const { deals } = (await request(app).get('/api/dashboard/stats')).body.data.recentActivity;
      expect(deals).toHaveLength(5);
      const dates = deals.map((d: any) => new Date(d.hitDate).getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
      expect(new Date(deals[0].hitDate).toISOString()).toBe('2026-02-06T00:00:00.000Z');
    });
  });
});

describe('GET /api/dashboard/mail-volume-by-month', () => {
  const now = new Date();
  const monthsAgo = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, 15, 12);

  beforeAll(async () => {
    await resetDb();
    const c = await addCampaign({ name: 'Volume' });
    await addMailing({ campaignId: c.id, mailDate: monthsAgo(0) });
    await addMailing({ campaignId: c.id, mailDate: monthsAgo(0) });
    await addMailing({ campaignId: c.id, mailDate: monthsAgo(2) });
    await addMailing({ campaignId: c.id, mailDate: monthsAgo(11) });
    await addMailing({ campaignId: c.id, mailDate: monthsAgo(13) }); // outside the 12-month window
    await addMailing({ campaignId: c.id, mailDate: null, createdAt: monthsAgo(1) }); // no mail date → created date
  });

  it('returns the last 12 months, oldest first, ending with the current month', async () => {
    const res = await request(app).get('/api/dashboard/mail-volume-by-month');
    expect(res.status).toBe(200);
    const months = res.body.data.map((m: any) => m.month);
    expect(months).toHaveLength(12);
    expect(months[11]).toBe(monthLabel(monthsAgo(0)));
    expect(months[0]).toBe(monthLabel(monthsAgo(11)));
  });

  it('counts mailings per month, falling back to the created date when there is no mail date', async () => {
    const res = await request(app).get('/api/dashboard/mail-volume-by-month');
    const counts = Object.fromEntries(res.body.data.map((m: any) => [m.month, m.count]));
    expect(counts[monthLabel(monthsAgo(0))]).toBe(2);
    expect(counts[monthLabel(monthsAgo(1))]).toBe(1);
    expect(counts[monthLabel(monthsAgo(2))]).toBe(1);
    expect(counts[monthLabel(monthsAgo(11))]).toBe(1);
    // the 13-month-old mailing is not counted anywhere
    expect(res.body.data.reduce((s: number, m: any) => s + m.count, 0)).toBe(5);
  });
});
