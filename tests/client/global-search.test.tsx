import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { GlobalSearch } from '../../client/src/components/GlobalSearch.tsx';
import { mockFetch, requestedUrls, createWrapper } from './utils.tsx';

const property = {
  id: 11, apn: '115-01009009', state: 'NC', county: 'Moore', zip: '28374', ownerName: 'John Smith',
  lastOfferPrice: '8800.00', lastOfferDate: '2026-02-01T12:00:00Z', offerCount: 1,
};
const owner = {
  id: 22, ownerName: 'John Smith', ownerType: 'individual', mailingCity: 'Pinehurst', mailingState: 'NC',
  lastOfferPrice: null, lastOfferDate: null, offerCount: 0,
};

function mockSearchApi() {
  return mockFetch({
    '/api/search': (url) => {
      const q = url.searchParams.get('q') ?? '';
      if (q.toLowerCase().includes('smith') || q.includes('115')) {
        return { body: { success: true, data: { properties: [property], owners: [owner] }, query: q, counts: { properties: 1, owners: 7 } } };
      }
      return { body: { success: true, data: { properties: [], owners: [] }, query: q, counts: { properties: 0, owners: 0 } } };
    },
  });
}

function renderSearch() {
  const fetchMock = mockSearchApi();
  const location = memoryLocation({ path: '/', record: true });
  const { Wrapper } = createWrapper();
  render(
    <Wrapper>
      <Router hook={location.hook}>
        <GlobalSearch />
      </Router>
    </Wrapper>
  );
  const input = screen.getByPlaceholderText('Search APN, owner name...');
  return { fetchMock, location, input, user: userEvent.setup() };
}

const searchRequests = (fetchMock: ReturnType<typeof mockFetch>) =>
  requestedUrls(fetchMock).filter((u) => u.startsWith('/api/search'));

describe('GlobalSearch', () => {
  it('asks for at least 2 characters and does not search on a single character', async () => {
    const { input, user, fetchMock } = renderSearch();
    await user.type(input, 's');
    expect(screen.getByText('Type at least 2 characters')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(searchRequests(fetchMock)).toEqual([]);
  });

  it('searches with the trimmed query once typing pauses and shows grouped results with totals', async () => {
    const { input, user, fetchMock } = renderSearch();
    await user.type(input, '  smith ');

    expect(await screen.findByText('115-01009009')).toBeInTheDocument();
    const urls = searchRequests(fetchMock);
    expect(urls).toHaveLength(1); // debounced: one request for the whole burst of typing
    expect(new URL(urls[0], 'http://localhost').searchParams.get('q')).toBe('smith');

    expect(screen.getByText('Properties')).toBeInTheDocument();
    expect(screen.getByText('Owners')).toBeInTheDocument();
    expect(screen.getByText('(7)')).toBeInTheDocument(); // true owner total, not just the shown rows
    expect(screen.getByText('$8,800')).toBeInTheDocument(); // property's last offer
    expect(screen.getByText(/Moore, NC/)).toBeInTheDocument();
    expect(screen.getByText(/Pinehurst, NC/)).toBeInTheDocument();
  });

  it('tells the user when nothing matches', async () => {
    const { input, user } = renderSearch();
    await user.type(input, 'zzzz');
    expect(await screen.findByText('No results for "zzzz"')).toBeInTheDocument();
  });

  it('navigates to the owner page when an owner result is clicked, then clears the box', async () => {
    const { input, user, location } = renderSearch();
    await user.type(input, 'smith');
    const ownerRow = await screen.findByText('individual');
    await user.click(ownerRow);
    expect(location.history.at(-1)).toBe('/owners/22');
    expect(input).toHaveValue('');
  });

  it('keyboard: Enter opens the first (highlighted) result', async () => {
    const { input, user, location } = renderSearch();
    await user.type(input, 'smith');
    await screen.findByText('115-01009009');
    await user.keyboard('{Enter}');
    expect(location.history.at(-1)).toBe('/properties/11');
  });

  it('keyboard: ArrowDown then Enter opens the second result', async () => {
    const { input, user, location } = renderSearch();
    await user.type(input, 'smith');
    await screen.findByText('115-01009009');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(location.history.at(-1)).toBe('/owners/22');
  });

  it('Escape closes the results', async () => {
    const { input, user } = renderSearch();
    await user.type(input, 'smith');
    await screen.findByText('115-01009009');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('115-01009009')).not.toBeInTheDocument());
  });

  it('the clear button empties the query', async () => {
    const { input, user } = renderSearch();
    await user.type(input, 'smith');
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.queryByText('115-01009009')).not.toBeInTheDocument();
  });
});
