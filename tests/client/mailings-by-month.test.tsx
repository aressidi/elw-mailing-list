import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailingsByMonth } from '../../client/src/components/MailingsByMonth.tsx';
import { mockFetch, createWrapper } from './utils.tsx';

const DATA = [
  {
    month: '2026-09',
    monthLabel: 'September 2026',
    campaignCount: 2,
    totalVolume: 900,
    campaigns: [
      {
        campaignId: 7,
        name: 'September Push',
        firstMailDate: '2026-09-03T00:00:00Z',
        states: ['NC', 'SC'],
        counties: ['Wake', 'York'],
        volume: 700,
        volumeByState: { NC: 500, SC: 200 },
        volumeByCounty: { Wake: 500, York: 200 },
      },
      {
        campaignId: 8,
        name: 'September Late',
        firstMailDate: '2026-09-20T00:00:00Z',
        states: ['FL'],
        counties: ['Miami-Dade'],
        volume: 200,
        volumeByState: { FL: 200 },
        volumeByCounty: { 'Miami-Dade': 200 },
      },
    ],
  },
  {
    month: '2026-08',
    monthLabel: 'August 2026',
    campaignCount: 1,
    totalVolume: 100,
    campaigns: [
      {
        campaignId: 3,
        name: 'August Push',
        firstMailDate: '2026-08-05T00:00:00Z',
        states: ['NC'],
        counties: ['Wake'],
        volume: 100,
        volumeByState: { NC: 100 },
        volumeByCounty: { Wake: 100 },
      },
    ],
  },
];

function renderView() {
  mockFetch({
    '/api/mailings/by-month-detail': () => ({ body: { success: true, data: DATA } }),
  });
  const { Wrapper } = createWrapper();
  render(<MailingsByMonth />, { wrapper: Wrapper });
}

describe('MailingsByMonth', () => {
  it('lists months newest-first with campaign count and total volume', async () => {
    renderView();
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    expect(screen.getByText('August 2026')).toBeInTheDocument();
    expect(screen.getByText('2 campaigns')).toBeInTheDocument();
    expect(screen.getByText('900')).toBeInTheDocument(); // Sept total volume
  });

  it('expands the newest month by default, showing its campaigns by date and volume', async () => {
    renderView();
    // First month open on load: its campaigns (dates) are visible.
    expect(await screen.findByText('Sep 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sep 20, 2026')).toBeInTheDocument();
    // Older month collapsed: its campaign date is not shown yet.
    expect(screen.queryByText('Aug 5, 2026')).not.toBeInTheDocument();
  });

  it('drills into a campaign to reveal per-state and per-county volumes', async () => {
    const user = userEvent.setup();
    renderView();
    const dateCell = await screen.findByText('Sep 3, 2026');
    const row = dateCell.closest('button') as HTMLElement;
    await user.click(row);

    // The drill-down panel follows the row; locate it and assert breakdowns.
    const panel = row.parentElement as HTMLElement;
    // Scope to each breakdown section so state badges in the collapsed summary
    // (also in this subtree) don't collide with the drill-down labels.
    const stateSection = (within(panel).getByText('Volume by State').parentElement) as HTMLElement;
    expect(within(stateSection).getByText('NC')).toBeInTheDocument();
    expect(within(stateSection).getByText('SC')).toBeInTheDocument();
    expect(within(stateSection).getByText('500')).toBeInTheDocument();

    const countySection = (within(panel).getByText('Volume by County').parentElement) as HTMLElement;
    expect(within(countySection).getByText('Wake')).toBeInTheDocument();
    expect(within(countySection).getByText('York')).toBeInTheDocument();
    expect(within(countySection).getByText('200')).toBeInTheDocument();
  });

  it('expands an older month on click', async () => {
    const user = userEvent.setup();
    renderView();
    const augHeader = (await screen.findByText('August 2026')).closest('button') as HTMLElement;
    await user.click(augHeader);
    expect(await screen.findByText('Aug 5, 2026')).toBeInTheDocument();
  });
});
