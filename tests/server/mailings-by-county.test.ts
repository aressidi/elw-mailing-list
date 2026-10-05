import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { resetDb, addProperty, addMailing, addCampaign, loadApp } from './helpers.ts';

// REGRESSION: the dashboard "Mailing Coverage → By County" state filter used
// to compare state codes case-sensitively, so typing "nc" returned nothing
// while "NC" worked. These tests pin the user-visible contract: the filter is
// case-insensitive, whitespace-tolerant, and a non-matching state is empty.

let app: Express;

type CountyRow = { county: string; state: string; count: number; offers: number };

function byCounty(rows: CountyRow[]) {
  return [...rows]
    .map(({ county, count, offers }) => ({ county, count, offers }))
    .sort((a, b) => a.county.localeCompare(b.county));
}

// Fixture: 5 NC mailings across 3 counties (one property stored with a
// lower-case state code), 2 GA mailings, 1 mailing with no property.
const EXPECTED_NC = [
  { county: 'Durham', count: 1, offers: 500 },
  { county: 'Orange', count: 1, offers: 750 },
  { county: 'Wake', count: 3, offers: 3000 },
];

beforeAll(async () => {
  app = await loadApp();
  await resetDb();
  const campaign = await addCampaign({ name: 'Coverage Fixture' });
  const wake1 = await addProperty({ apn: 'NC-WAKE-1', state: 'NC', county: 'Wake' });
  const wake2 = await addProperty({ apn: 'NC-WAKE-2', state: 'NC', county: 'Wake' });
  const durham = await addProperty({ apn: 'NC-DUR-1', state: 'NC', county: 'Durham' });
  const orangeLower = await addProperty({ apn: 'NC-ORA-1', state: 'nc', county: 'Orange' });
  const fulton = await addProperty({ apn: 'GA-FUL-1', state: 'GA', county: 'Fulton' });

  const c = campaign.id;
  await addMailing({ propertyId: wake1.id, campaignId: c, offerPrice: '1000.00' });
  await addMailing({ propertyId: wake1.id, campaignId: c, offerPrice: '2000.00' });
  await addMailing({ propertyId: wake2.id, campaignId: c, offerPrice: null });
  await addMailing({ propertyId: durham.id, campaignId: c, offerPrice: '500.00' });
  await addMailing({ propertyId: orangeLower.id, campaignId: c, offerPrice: '750.00' });
  await addMailing({ propertyId: fulton.id, campaignId: c, offerPrice: '100.00' });
  await addMailing({ propertyId: fulton.id, campaignId: c, offerPrice: '200.00' });
  await addMailing({ propertyId: null, campaignId: c, offerPrice: '999.00' });
});

describe('GET /api/mailings/by-county — state filter (regression)', () => {
  it.each([
    ['upper case', 'NC'],
    ['lower case', 'nc'],
    ['mixed case', 'nC'],
    ['surrounding whitespace', '  NC  '],
    ['lower case with surrounding whitespace', ' nc '],
  ])('matches the state regardless of %s (%j)', async (_label, state) => {
    const res = await request(app).get('/api/mailings/by-county').query({ state });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(byCounty(res.body.data)).toEqual(EXPECTED_NC);
  });

  it('returns an empty list (not an error) for a state with no mailings', async () => {
    const res = await request(app).get('/api/mailings/by-county').query({ state: 'TX' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('does not leak other states into a filtered result', async () => {
    const res = await request(app).get('/api/mailings/by-county').query({ state: 'ga' });
    expect(byCounty(res.body.data)).toEqual([{ county: 'Fulton', count: 2, offers: 300 }]);
  });

  it('treats a whitespace-only state as "no filter" and returns every county', async () => {
    const res = await request(app).get('/api/mailings/by-county').query({ state: '   ' });
    expect(res.status).toBe(200);
    const counties = (res.body.data as CountyRow[]).map((r) => r.county).sort();
    expect(counties).toEqual(['Durham', 'Fulton', 'Orange', 'Unknown', 'Wake']);
  });
});

describe('GET /api/mailings/by-county — unfiltered stats', () => {
  it('counts every mailing once, grouping mailings without a property under "Unknown"', async () => {
    const res = await request(app).get('/api/mailings/by-county');
    expect(res.status).toBe(200);
    const rows = res.body.data as CountyRow[];
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(8);
    expect(rows.find((r) => r.county === 'Unknown')).toMatchObject({ count: 1, offers: 999 });
    expect(rows.find((r) => r.county === 'Fulton')).toMatchObject({ state: 'GA', count: 2, offers: 300 });
  });

  it('lists the county with the most mailings first', async () => {
    const res = await request(app).get('/api/mailings/by-county');
    expect(res.body.data[0]).toMatchObject({ county: 'Wake', count: 3 });
  });
});

// REGRESSION: county is free text, so one county used to show up as several
// rows ("Benton" / "Benton County", "DAVIDSON" / "Davidson"), double-counting
// it. The report groups on the canonical name: Title Case, no "County" suffix.
describe('GET /api/mailings/by-county — county spellings collapse', () => {
  it('reports each county once however its name was stored', async () => {
    const campaign = await addCampaign({ name: 'Spelling Fixture' });
    const spellings: [string, string][] = [
      ['AZ', 'Apache'], ['AZ', 'APACHE'], ['AZ', 'Apache County'], ['AZ', 'APACHE COUNTY'],
      ['AR', 'Benton'], ['AR', 'Benton County'],
      ['AR', 'Washington'], ['AR', 'WASHINGTON COUNTY'],
      ['AR', 'SALINE'], ['AR', 'SALINE COUNTY'],
      ['TN', 'Davidson'], ['TN', 'DAVIDSON'],
      ['CO', 'Saguache County'], ['CO', 'SAGUACHE COUNTY'],
    ];
    for (const [i, [state, county]] of spellings.entries()) {
      const p = await addProperty({ apn: `SPELL-${i}`, state, county });
      await addMailing({ propertyId: p.id, campaignId: campaign.id, offerPrice: '100.00' });
    }

    const rows: CountyRow[] = [];
    for (const state of ['AZ', 'AR', 'TN', 'CO']) {
      const res = await request(app).get('/api/mailings/by-county').query({ state });
      expect(res.status).toBe(200);
      rows.push(...res.body.data);
    }

    expect(byCounty(rows)).toEqual([
      { county: 'Apache', count: 4, offers: 400 },
      { county: 'Benton', count: 2, offers: 200 },
      { county: 'Davidson', count: 2, offers: 200 },
      { county: 'Saguache', count: 2, offers: 200 },
      { county: 'Saline', count: 2, offers: 200 },
      { county: 'Washington', count: 2, offers: 200 },
    ]);
    // Merging rows must not drop or duplicate a mailing.
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(spellings.length);
  });

  it('keeps same-named counties in different states apart', async () => {
    const campaign = await addCampaign({ name: 'Two Washingtons Fixture' });
    const p = await addProperty({ apn: 'SPELL-OR-1', state: 'OR', county: 'Washington County' });
    await addMailing({ propertyId: p.id, campaignId: campaign.id, offerPrice: '50.00' });

    const res = await request(app).get('/api/mailings/by-county');
    const washingtons = (res.body.data as CountyRow[]).filter((r) => r.county === 'Washington');
    expect(washingtons.map(({ state, count }) => ({ state, count })).sort((a, b) => a.state.localeCompare(b.state)))
      .toEqual([{ state: 'AR', count: 2 }, { state: 'OR', count: 1 }]);
  });
});

describe('GET /api/mailings/by-county — county names', () => {
  it('preserves hyphenated county names such as "Miami-Dade"', async () => {
    const campaign = await addCampaign({ name: 'Hyphen Fixture' });
    const p = await addProperty({ apn: 'FL-MD-1', state: 'FL', county: 'Miami-Dade' });
    await addMailing({ propertyId: p.id, campaignId: campaign.id, offerPrice: '10.00' });

    const res = await request(app).get('/api/mailings/by-county').query({ state: 'FL' });
    expect(res.status).toBe(200);
    expect(byCounty(res.body.data)).toEqual([{ county: 'Miami-Dade', count: 1, offers: 10 }]);
  });
});
