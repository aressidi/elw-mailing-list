import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from '../../client/src/pages/dashboard.tsx';
import { mockFetch, requestedUrls, createWrapper } from './utils.tsx';

const COUNTIES = {
  all: [
    { county: 'Wake', state: 'NC', count: 3, offers: 3000 },
    { county: 'Fulton', state: 'GA', count: 2, offers: 300 },
  ],
  nc: [{ county: 'Wake', state: 'NC', count: 3, offers: 3000 }],
};

function mockDashboardApi() {
  return mockFetch({
    '/api/dashboard/stats': () => ({
      body: {
        success: true,
        data: {
          overview: {
            totalProperties: 1234, totalOwners: 56, totalMailings: 7890, totalCampaigns: 4,
            totalDeals: 12, totalLeads: 6, totalConversions: 2, totalSuppressed: 3,
            responseRate: '0.15', leadRate: '50.00', conversionRate: '16.67',
          },
          recentActivity: { mailings: [], deals: [] },
        },
      },
    }),
    '/api/mailings/by-state': () => ({ body: { success: true, data: [] } }),
    '/api/dashboard/mail-volume-by-month': () => ({ body: { success: true, data: [] } }),
    // Stand-in for the server contract: state matching is case-insensitive.
    '/api/mailings/by-county': (url) => {
      const state = url.searchParams.get('state');
      if (state === null) return { body: { success: true, data: COUNTIES.all } };
      return { body: { success: true, data: state.toLowerCase() === 'nc' ? COUNTIES.nc : [] } };
    },
  });
}

function renderDashboard() {
  const fetchMock = mockDashboardApi();
  const { Wrapper } = createWrapper();
  render(<Dashboard />, { wrapper: Wrapper });
  return fetchMock;
}

/** The "By County" coverage card, located by its visible title. */
async function countyCard() {
  const title = await screen.findByRole('heading', { name: /by county/i });
  return title.closest('.rounded-xl') as HTMLElement;
}

const countyRequests = (fetchMock: ReturnType<typeof mockFetch>) =>
  requestedUrls(fetchMock).filter((u) => u.startsWith('/api/mailings/by-county'));

describe('Dashboard overview', () => {
  it('shows headline totals with thousands separators and rates as percentages', async () => {
    renderDashboard();
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('7,890')).toBeInTheDocument();
    expect(screen.getByText('16.7%')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
  });

  it('shows empty states when there is no activity', async () => {
    renderDashboard();
    expect(await screen.findByText('No recent mailings')).toBeInTheDocument();
    expect(screen.getByText('No recent deals')).toBeInTheDocument();
  });
});

describe('Dashboard → Mailing Coverage → By County', () => {
  it('initially shows every county without a state filter', async () => {
    const fetchMock = renderDashboard();
    const card = await countyCard();
    expect(await within(card).findByText('Wake')).toBeInTheDocument();
    expect(within(card).getByText('Fulton')).toBeInTheDocument();
    expect(countyRequests(fetchMock)).toEqual(['/api/mailings/by-county']);
  });

  it('trims the typed state and sends it to the API, showing only matching counties', async () => {
    const user = userEvent.setup();
    const fetchMock = renderDashboard();
    const card = await countyCard();
    await within(card).findByText('Fulton');

    await user.type(within(card).getByPlaceholderText('e.g. MI'), '  nc  ');

    await waitFor(() => expect(within(card).queryByText('Fulton')).not.toBeInTheDocument());
    expect(within(card).getByText('Wake')).toBeInTheDocument();
    const last = countyRequests(fetchMock).at(-1)!;
    expect(last).toBe('/api/mailings/by-county?state=nc');
    // No request ever carried surrounding whitespace.
    for (const u of countyRequests(fetchMock)) {
      const state = new URL(u, 'http://localhost').searchParams.get('state');
      if (state !== null) expect(state).toBe(state.trim());
    }
  });

  it('treats a whitespace-only filter as no filter', async () => {
    const user = userEvent.setup();
    const fetchMock = renderDashboard();
    const card = await countyCard();
    await within(card).findByText('Fulton');

    await user.type(within(card).getByPlaceholderText('e.g. MI'), '   ');

    expect(within(card).getByText('Fulton')).toBeInTheDocument();
    expect(countyRequests(fetchMock).every((u) => u === '/api/mailings/by-county')).toBe(true);
  });

  it('shows the no-data message and a hint to clear the filter when no county matches', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const card = await countyCard();
    await within(card).findByText('Fulton');

    await user.type(within(card).getByPlaceholderText('e.g. MI'), 'TX');

    expect(await within(card).findByText('No data available')).toBeInTheDocument();
    expect(within(card).getByText('Try removing the state filter')).toBeInTheDocument();
    expect(within(card).queryByText('Wake')).not.toBeInTheDocument();
  });

  it('restores all counties when the filter is cleared', async () => {
    const user = userEvent.setup();
    renderDashboard();
    const card = await countyCard();
    const input = within(card).getByPlaceholderText('e.g. MI');
    await user.type(input, 'TX');
    await within(card).findByText('No data available');

    await user.clear(input);

    expect(await within(card).findByText('Fulton')).toBeInTheDocument();
    expect(within(card).queryByText('Try removing the state filter')).not.toBeInTheDocument();
  });
});
