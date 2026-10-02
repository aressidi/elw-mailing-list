import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useProperties, useProperty, usePropertySearch, useOwners, useOwner, useOwnerSearch, useGlobalSearch,
  useCampaigns, useCampaign, useCampaignsWithStats, useMailings, useAggregatedMailings,
  useMailingStatsByState, useMailingStatsByCounty, useDeals, useDealStats, useSuppression,
  useAddSuppression, useDashboardStats, useMailVolumeByMonth,
} from '../../client/src/hooks/use-api.ts';
import { mockFetch, requestedUrls, createWrapper } from './utils.tsx';

const ok = (data: unknown = []) => () => ({ body: { success: true, data, pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } } });

function everyRouteOk() {
  const paths = [
    '/api/properties', '/api/properties/7', '/api/properties/search', '/api/owners', '/api/owners/3',
    '/api/owners/search', '/api/search', '/api/campaigns', '/api/campaigns/5', '/api/mailings',
    '/api/mailings/by-state', '/api/mailings/by-county', '/api/deals', '/api/deals/stats',
    '/api/suppression', '/api/dashboard/stats', '/api/dashboard/mail-volume-by-month',
  ];
  return mockFetch(Object.fromEntries(paths.map((p) => [p, ok()])));
}

async function urlFor(useHook: () => { isSuccess: boolean; isError: boolean }) {
  const fetchMock = everyRouteOk();
  const { Wrapper } = createWrapper();
  const { result } = renderHook(useHook, { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
  const urls = requestedUrls(fetchMock);
  expect(urls).toHaveLength(1);
  return new URL(urls[0], 'http://localhost');
}

const params = (u: URL) => Object.fromEntries(u.searchParams.entries());

describe('use-api request URLs', () => {
  it('useProperties sends every provided filter, sort and page param', async () => {
    const u = await urlFor(() =>
      useProperties({ page: 2, limit: 50, state: 'NC', county: 'Wake', apn: '12-3', sortBy: 'acres', sortOrder: 'desc' })
    );
    expect(u.pathname).toBe('/api/properties');
    expect(params(u)).toEqual({ page: '2', limit: '50', state: 'NC', county: 'Wake', apn: '12-3', sortBy: 'acres', sortOrder: 'desc' });
  });

  it('useProperties omits empty filters', async () => {
    const u = await urlFor(() => useProperties({ state: '', county: undefined }));
    expect(params(u)).toEqual({});
  });

  it('useOwners sends name filters and state', async () => {
    const u = await urlFor(() => useOwners({ page: 1, name: 'lee', lastName: 'Lee', ownerName: 'Robert Lee', state: 'NC' }));
    expect(u.pathname).toBe('/api/owners');
    expect(params(u)).toEqual({ page: '1', name: 'lee', lastName: 'Lee', ownerName: 'Robert Lee', state: 'NC' });
  });

  it('detail hooks request the record by id', async () => {
    expect((await urlFor(() => useProperty(7))).pathname).toBe('/api/properties/7');
    expect((await urlFor(() => useOwner(3))).pathname).toBe('/api/owners/3');
    expect((await urlFor(() => useCampaign('5'))).pathname).toBe('/api/campaigns/5');
  });

  it('search hooks URL-encode the query', async () => {
    const u = await urlFor(() => usePropertySearch('12 & 34', 5));
    expect(u.pathname).toBe('/api/properties/search');
    expect(params(u)).toEqual({ q: '12 & 34', limit: '5' });

    const o = await urlFor(() => useOwnerSearch('O\'Brien'));
    expect(params(o)).toEqual({ q: "O'Brien", limit: '20' });
  });

  it('useGlobalSearch trims the query and sends the per-group limit', async () => {
    const u = await urlFor(() => useGlobalSearch('  smith  '));
    expect(u.pathname).toBe('/api/search');
    expect(params(u)).toEqual({ q: 'smith', limit: '10' });
  });

  it('useCampaigns and useCampaignsWithStats page through campaigns; the stats variant always asks for stats', async () => {
    expect(params(await urlFor(() => useCampaigns({ page: 3, limit: 10 })))).toEqual({ page: '3', limit: '10' });
    expect(params(await urlFor(() => useCampaignsWithStats()))).toEqual({ include: 'stats' });
    expect(params(await urlFor(() => useCampaignsWithStats({ sortBy: 'totalMailings', sortOrder: 'asc' }))))
      .toEqual({ include: 'stats', sortBy: 'totalMailings', sortOrder: 'asc' });
  });

  it('useMailings passes filters, including an explicit raw=false', async () => {
    const u = await urlFor(() =>
      useMailings({ campaignId: 9, state: 'NC', county: 'Wake', search: 'spring', startDate: '2026-01-01', endDate: '2026-02-01', raw: false })
    );
    expect(u.pathname).toBe('/api/mailings');
    expect(params(u)).toEqual({
      campaignId: '9', state: 'NC', county: 'Wake', search: 'spring', startDate: '2026-01-01', endDate: '2026-02-01', raw: 'false',
    });
  });

  it('useAggregatedMailings never requests raw rows', async () => {
    const u = await urlFor(() => useAggregatedMailings({ state: 'GA', sortBy: 'name' }));
    expect(params(u)).toEqual({ state: 'GA', sortBy: 'name' });
  });

  it('useMailingStatsByCounty adds an encoded state only when one is given', async () => {
    const all = await urlFor(() => useMailingStatsByCounty());
    expect(all.pathname).toBe('/api/mailings/by-county');
    expect(all.search).toBe('');

    const filtered = await urlFor(() => useMailingStatsByCounty('N&C'));
    expect(params(filtered)).toEqual({ state: 'N&C' });
  });

  it('useDeals sends boolean filters even when false', async () => {
    const u = await urlFor(() => useDeals({ isLead: false, isConversion: true }));
    expect(params(u)).toEqual({ isLead: 'false', isConversion: 'true' });
  });

  it('stat hooks hit their endpoints', async () => {
    expect((await urlFor(() => useMailingStatsByState())).pathname).toBe('/api/mailings/by-state');
    expect((await urlFor(() => useDealStats())).pathname).toBe('/api/deals/stats');
    expect((await urlFor(() => useDashboardStats())).pathname).toBe('/api/dashboard/stats');
    expect((await urlFor(() => useMailVolumeByMonth())).pathname).toBe('/api/dashboard/mail-volume-by-month');
    expect(params(await urlFor(() => useSuppression({ reason: 'bad_address', page: 2 })))).toEqual({ page: '2', reason: 'bad_address' });
  });
});

describe('use-api hooks that should not fire', () => {
  it.each([
    ['global search under 2 characters', () => useGlobalSearch('a')],
    ['global search of only whitespace', () => useGlobalSearch('    ')],
    ['property search with blank query', () => usePropertySearch('  ')],
    ['owner search with empty query', () => useOwnerSearch('')],
    ['property detail without id', () => useProperty('')],
    ['owner detail with id 0', () => useOwner(0)],
  ])('does not call the API for %s', async (_l, useHook) => {
    const fetchMock = everyRouteOk();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(useHook as () => { fetchStatus: string }, { wrapper: Wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('use-api auth and error handling', () => {
  it('sends the stored token as a Bearer Authorization header', async () => {
    localStorage.setItem('elw_auth_token', 'tok-123');
    const fetchMock = everyRouteOk();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardStats(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('sends no Authorization header when logged out', async () => {
    const fetchMock = everyRouteOk();
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardStats(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('returns the parsed response body on success', async () => {
    mockFetch({ '/api/deals/stats': () => ({ body: { success: true, data: { totalDeals: 4 } } }) });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDealStats(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data.totalDeals).toBe(4);
  });

  it("surfaces the server's error message on failure", async () => {
    mockFetch({ '/api/properties/7': () => ({ status: 404, body: { success: false, error: 'Property not found' } }) });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useProperty(7), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Property not found');
  });

  it('falls back to "HTTP <status>" when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardStats(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('HTTP 502');
  });

  it('on 401 it logs the user out and reports the session as expired', async () => {
    localStorage.setItem('elw_auth_token', 'stale');
    mockFetch({ '/api/dashboard/stats': () => ({ status: 401, body: { success: false, error: 'Invalid or expired token' } }) });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDashboardStats(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Session expired');
    expect(localStorage.getItem('elw_auth_token')).toBeNull();
  });
});

describe('useAddSuppression', () => {
  it('POSTs the suppression as JSON and refreshes the suppression list', async () => {
    const fetchMock = mockFetch({
      '/api/suppression': (_u, init) =>
        init?.method === 'POST'
          ? { status: 201, body: { success: true, data: { id: 1, ownerId: 3, propertyId: 4, reason: 'bad_address' } } }
          : { body: { success: true, data: [], pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } } },
    });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => ({ list: useSuppression(), add: useAddSuppression() }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const listCallsBefore = fetchMock.mock.calls.filter(([, i]) => !i?.method || i.method === 'GET').length;

    await act(async () => {
      await result.current.add.mutateAsync({ ownerId: 3, propertyId: 4, reason: 'bad_address' });
    });

    const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(String(post[0])).toBe('/api/suppression');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ ownerId: 3, propertyId: 4, reason: 'bad_address' });
    expect((post[1]!.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    await waitFor(() => {
      const listCallsAfter = fetchMock.mock.calls.filter(([, i]) => !i?.method || i.method === 'GET').length;
      expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
    });
  });

  it('rejects with the server error for a duplicate', async () => {
    mockFetch({ '/api/suppression': () => ({ status: 409, body: { success: false, error: 'Suppression already exists' } }) });
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useAddSuppression(), { wrapper: Wrapper });
    await expect(result.current.mutateAsync({ ownerId: 1, propertyId: 1 })).rejects.toThrow('Suppression already exists');
  });
});
