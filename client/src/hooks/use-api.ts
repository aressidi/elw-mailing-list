import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Dashboard ───────────────────────────────────────────────
export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => fetchJson<{ success: boolean; data: DashboardStats }>(`${API_BASE}/dashboard/stats`),
  });
}

export function useMailVolumeByMonth() {
  return useQuery({
    queryKey: ['dashboard', 'mail-volume-by-month'],
    queryFn: () => fetchJson<{ success: boolean; data: MailVolumeByMonth[] }>(`${API_BASE}/dashboard/mail-volume-by-month`),
  });
}

// ─── Properties ──────────────────────────────────────────────
export function useProperties(params?: { page?: number; limit?: number; state?: string; county?: string; apn?: string; sortBy?: string; sortOrder?: string }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.state) query.set('state', params.state);
  if (params?.county) query.set('county', params.county);
  if (params?.apn) query.set('apn', params.apn);
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);

  return useQuery({
    queryKey: ['properties', params],
    queryFn: () => fetchJson<PaginatedResponse<Property[]>>(`${API_BASE}/properties?${query.toString()}`),
  });
}

export function useProperty(id: number | string) {
  return useQuery({
    queryKey: ['property', id],
    queryFn: () => fetchJson<{ success: boolean; data: PropertyDetail }>(`${API_BASE}/properties/${id}`),
    enabled: !!id,
  });
}

export function usePropertySearch(q: string, limit = 20) {
  return useQuery({
    queryKey: ['properties', 'search', q],
    queryFn: () => fetchJson<{ success: boolean; data: Property[] }>(`${API_BASE}/properties/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    enabled: q.trim().length > 0,
  });
}

// ─── Owners ──────────────────────────────────────────────────
export function useOwners(params?: { page?: number; limit?: number; name?: string; state?: string }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.name) query.set('name', params.name);
  if (params?.state) query.set('state', params.state);

  return useQuery({
    queryKey: ['owners', params],
    queryFn: () => fetchJson<PaginatedResponse<Owner[]>>(`${API_BASE}/owners?${query.toString()}`),
  });
}

export function useOwner(id: number | string) {
  return useQuery({
    queryKey: ['owner', id],
    queryFn: () => fetchJson<{ success: boolean; data: OwnerDetail }>(`${API_BASE}/owners/${id}`),
    enabled: !!id,
  });
}

export function useOwnerSearch(q: string, limit = 20) {
  return useQuery({
    queryKey: ['owners', 'search', q],
    queryFn: () => fetchJson<{ success: boolean; data: Owner[] }>(`${API_BASE}/owners/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    enabled: q.trim().length > 0,
  });
}

// ─── Campaigns ───────────────────────────────────────────────
export function useCampaigns(params?: { page?: number; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  return useQuery({
    queryKey: ['campaigns', params],
    queryFn: () => fetchJson<PaginatedResponse<Campaign[]>>(`${API_BASE}/campaigns?${query.toString()}`),
  });
}

export function useCampaign(id: number | string) {
  return useQuery({
    queryKey: ['campaign', id],
    queryFn: () => fetchJson<{ success: boolean; data: CampaignDetail }>(`${API_BASE}/campaigns/${id}`),
    enabled: !!id,
  });
}

// ─── Mailings ────────────────────────────────────────────────
export function useMailings(params?: {
  page?: number;
  limit?: number;
  campaignId?: number;
  state?: string;
  county?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: string;
  raw?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.campaignId) query.set('campaignId', String(params.campaignId));
  if (params?.state) query.set('state', params.state);
  if (params?.county) query.set('county', params.county);
  if (params?.search) query.set('search', params.search);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params?.raw !== undefined) query.set('raw', String(params.raw));

  return useQuery({
    queryKey: ['mailings', params],
    queryFn: () =>
      fetchJson<PaginatedResponse<AggregatedMailing[] | Mailing[]>>(
        `${API_BASE}/mailings?${query.toString()}`
      ),
  });
}

export function useAggregatedMailings(params?: {
  page?: number;
  limit?: number;
  state?: string;
  county?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: string;
}) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.state) query.set('state', params.state);
  if (params?.county) query.set('county', params.county);
  if (params?.search) query.set('search', params.search);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);

  return useQuery({
    queryKey: ['mailings', 'aggregated', params],
    queryFn: () =>
      fetchJson<PaginatedResponse<AggregatedMailing[]>>(
        `${API_BASE}/mailings?${query.toString()}`
      ),
  });
}

export function useMailingStatsByState() {
  return useQuery({
    queryKey: ['mailings', 'stats', 'by-state'],
    queryFn: () => fetchJson<{ success: boolean; data: MailingStateStat[] }>(`${API_BASE}/mailings/by-state`),
  });
}

export function useMailingStatsByCounty(state?: string) {
  const query = state ? `?state=${encodeURIComponent(state)}` : '';
  return useQuery({
    queryKey: ['mailings', 'stats', 'by-county', state],
    queryFn: () => fetchJson<{ success: boolean; data: CountyStat[] }>(`${API_BASE}/mailings/by-county${query}`),
  });
}

// ─── Deals ───────────────────────────────────────────────────
export function useDeals(params?: { page?: number; limit?: number; isLead?: boolean; isConversion?: boolean }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.isLead !== undefined) query.set('isLead', String(params.isLead));
  if (params?.isConversion !== undefined) query.set('isConversion', String(params.isConversion));

  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => fetchJson<PaginatedResponse<Deal[]>>(`${API_BASE}/deals?${query.toString()}`),
  });
}

export function useDealStats() {
  return useQuery({
    queryKey: ['deals', 'stats'],
    queryFn: () => fetchJson<{ success: boolean; data: DealStats }>(`${API_BASE}/deals/stats`),
  });
}

// ─── Suppression ─────────────────────────────────────────────
export function useSuppression(params?: { page?: number; limit?: number; reason?: string }) {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.reason) query.set('reason', params.reason);

  return useQuery({
    queryKey: ['suppression', params],
    queryFn: () => fetchJson<PaginatedResponse<SuppressionRecord[]>>(`${API_BASE}/suppression?${query.toString()}`),
  });
}

export function useAddSuppression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ownerId: number; propertyId: number; reason?: string }) =>
      fetchJson<{ success: boolean; data: SuppressionRecord }>(`${API_BASE}/suppression`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppression'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// ─── Types ───────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  success: boolean;
  data: T;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface Property {
  id: number;
  apn: string;
  state: string | null;
  county: string | null;
  zip: string | null;
  latitude: string | null;
  longitude: string | null;
  acres: string | null;
  legalDescription: string | null;
  dataSourceId: number | null;
  sourceAcquiredDate: string | null;
  createdAt: string;
}

export interface Owner {
  id: number;
  firstName: string | null;
  lastName: string | null;
  ownerName: string;
  ownerType: 'individual' | 'company' | 'trust' | 'llc' | 'other';
  createdAt: string;
}

export interface MailingAddress {
  id: number;
  ownerId: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  createdAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  link: string | null;
  createdAt: string;
}

export interface AggregatedMailing {
  id: number;
  campaignId: number;
  name: string;
  campaignName: string;
  googleSheetLink: string | null;
  mailDate: string | null;
  latestMailDate: string | null;
  totalMailings: number;
  totalOwners: number;
  totalProperties: number;
  totalOfferAmount: number;
  states: string[];
  counties: string[];
  leadsCount: number;
  dealsCount: number;
  suppressionsCount: number;
}

export interface Mailing {
  id: number;
  propertyId: number | null;
  ownerId: number | null;
  mailingAddressId: number | null;
  campaignId: number | null;
  mailDate: string | null;
  offerPrice: string | null;
  createdAt: string;
  property?: Property | null;
  owner?: Owner | null;
  mailingAddress?: MailingAddress | null;
  campaign?: Campaign | null;
}

export interface Deal {
  id: number;
  propertyId: number | null;
  ownerId: number | null;
  hitType: 'call' | 'email' | 'website' | 'text' | 'mail' | 'other';
  hitDate: string;
  isLead: boolean;
  isConversion: boolean;
  createdAt: string;
  property?: Property | null;
  owner?: Owner | null;
}

export interface SuppressionRecord {
  id: number;
  ownerId: number | null;
  propertyId: number | null;
  reason: 'do_not_mail' | 'bad_address' | 'deceased' | 'sold' | 'other';
  createdAt: string;
  owner?: Owner | null;
  property?: Property | null;
}

export interface PropertyOwnerJunction {
  propertyId: number;
  ownerId: number;
  property?: Property;
  owner?: Owner;
}

export interface PropertyDetail extends Property {
  propertyOwners: Array<{
    owner: Owner & { mailingAddresses: MailingAddress[] };
  }>;
  mailings: Array<Mailing & { campaign: Campaign | null }>;
  deals: Deal[];
}

export interface OwnerDetail extends Owner {
  propertyOwners: Array<{ property: Property }>;
  mailingAddresses: MailingAddress[];
  mailings: Array<Mailing & { campaign: Campaign | null; property: Property | null }>;
  deals: Array<Deal & { property: Property | null }>;
  suppressions: Array<SuppressionRecord & { property: Property | null }>;
}

export interface CampaignDetail extends Campaign {
  mailings: Array<Mailing & { property: Property | null; owner: Owner | null; mailingAddress: MailingAddress | null }>;
  stats: {
    mailingsCount: number;
    totalOfferPrice: number;
  };
}

export interface DashboardStats {
  overview: {
    totalProperties: number;
    totalOwners: number;
    totalMailings: number;
    totalCampaigns: number;
    totalDeals: number;
    totalLeads: number;
    totalConversions: number;
    totalSuppressed: number;
    responseRate: string;
    leadRate: string;
    conversionRate: string;
  };
  recentActivity: {
    mailings: Array<Mailing & { property: Property | null; owner: Owner | null; campaign: Campaign | null }>;
    deals: Array<Deal & { property: Property | null; owner: Owner | null }>;
  };
}

export interface MailingStateStat {
  state: string;
  count: number;
  offers: number;
}

export interface CountyStat {
  county: string;
  state: string;
  count: number;
  offers: number;
}

export interface DealStats {
  totalDeals: number;
  totalLeads: number;
  totalConversions: number;
  totalMailings: number;
  responseRate: string;
  leadRate: string;
  conversionRate: string;
  byType: Array<{ hitType: string; count: number }>;
}

export interface MailVolumeByMonth {
  month: string;
  count: number;
}
