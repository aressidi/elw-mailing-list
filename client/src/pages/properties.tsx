import { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef, ColumnFilters, SortState } from '../components/ui/DataTable.tsx';
import { useProperties, Property } from '../hooks/use-api.ts';
import { formatAcreage, formatAcreBand, formatAcreRange, formatNumber, formatCurrency, formatDate } from '../lib/format.ts';
import { ACRE_BANDS } from '@shared/acre-bands';
import { MapPin, Loader2, Layers, Map as MapIcon, Building2, Users } from 'lucide-react';

// How long to wait after a column filter changes before hitting the server,
// so rapid typing in a text filter doesn't fire a request per keystroke.
const FILTER_DEBOUNCE_MS = 350;

// Server page size. Pagination is fully server-side (see DataTable serverSide).
const PAGE_SIZE = 25;

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
].map((s) => ({ value: s, label: s }));

const ACRE_BAND_OPTIONS = ACRE_BANDS.map((b) => ({ value: b.value, label: b.label }));

// Columns the server can order by (getPropertyOrderBy). Others are display-only
// derived fields, so we disable their sort affordance rather than silently drop it.
const SERVER_SORTABLE = new Set(['apn', 'state', 'county', 'acres']);

interface ServerFilters {
  apn?: string;
  state?: string;
  county?: string;
  owner?: string;
  acreBand?: string;
}

export function Properties() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [serverFilters, setServerFilters] = useState<ServerFilters>({});
  const [sort, setSort] = useState<SortState | null>(null);

  // Debounce column-filter changes into the server query. Every filter is
  // applied server-side across the whole table, so a change also resets to
  // page 1 (the active page may no longer exist under the new filter).
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerFilters({
        apn: columnFilters.apn?.value?.trim() || undefined,
        state: columnFilters.state?.selectedOption || undefined,
        county: columnFilters.county?.value?.trim() || undefined,
        owner: columnFilters.owners?.value?.trim() || undefined,
        acreBand: columnFilters.acres?.selectedOption || undefined,
      });
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    columnFilters.apn?.value,
    columnFilters.state?.selectedOption,
    columnFilters.county?.value,
    columnFilters.owners?.value,
    columnFilters.acres?.selectedOption,
  ]);

  const { data, isLoading, isFetching } = useProperties({
    page,
    limit: PAGE_SIZE,
    sortBy: sort?.columnId,
    sortOrder: sort?.direction,
    ...serverFilters,
  });

  const properties = data?.data || [];
  const pagination = data?.pagination;
  const summary = data?.summary;

  const handleSortChange = (next: SortState | null) => {
    // Ignore sort requests on columns the server can't order by.
    if (next && !SERVER_SORTABLE.has(next.columnId)) return;
    setSort(next);
    setPage(1);
  };

  const columns: ColumnDef<Property>[] = [
    {
      id: 'apn',
      header: 'APN',
      accessorKey: 'apn',
      filterType: 'text',
      cell: (row) => (
        <span className="font-semibold text-blue-600 hover:underline font-mono">
          {row.apn}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      filterType: 'select',
      filterOptions: US_STATES,
      cell: (row) => (row.state ? <Badge variant="secondary">{row.state}</Badge> : <span className="text-gray-400">—</span>),
    },
    {
      id: 'county',
      header: 'County',
      accessorKey: 'county',
      filterType: 'text',
      cell: (row) => row.county || <span className="text-gray-400">—</span>,
    },
    {
      id: 'acres',
      header: 'Acres',
      accessorKey: 'acres',
      filterType: 'select',
      filterOptions: ACRE_BAND_OPTIONS,
      align: 'right',
      cell: (row) => {
        const band = formatAcreBand(row.acres);
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="tabular-nums text-gray-900">{formatAcreage(row.acres)}</span>
            {band && <Badge variant="info" className="shrink-0">{band}</Badge>}
          </div>
        );
      },
    },
    {
      id: 'owners',
      header: 'Owner(s)',
      filterType: 'text',
      enableSorting: false,
      // Click an owner -> owner detail; row click (below) -> property detail.
      cell: (row) => {
        const owners = row.owners || [];
        const total = row.ownerCount ?? owners.length;
        if (total === 0) {
          return <span className="text-gray-400 text-sm">No owner linked</span>;
        }
        const extra = total - owners.length;
        return (
          <div className="flex flex-col gap-0.5">
            {owners.map((o) => (
              <Link key={o.id} href={`/owners/${o.id}`} onClick={(e) => e.stopPropagation()}>
                <span className="text-blue-600 hover:underline text-sm truncate max-w-[14rem] inline-block leading-tight">
                  {o.ownerName}
                </span>
              </Link>
            ))}
            {extra > 0 && (
              <Link href={`/properties/${row.id}`} onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-gray-500 hover:underline">+{extra} more co-owner{extra > 1 ? 's' : ''}</span>
              </Link>
            )}
          </div>
        );
      },
    },
    {
      id: 'lastMailed',
      header: 'Last Mailed',
      enableSorting: false,
      enableFiltering: false,
      cell: (row) =>
        row.lastOfferDate ? (
          <span className="text-sm text-gray-700 tabular-nums">{formatDate(row.lastOfferDate)}</span>
        ) : (
          <span className="text-gray-400 text-sm">Never</span>
        ),
    },
    {
      id: 'lastOffer',
      header: 'Last Offer',
      enableSorting: false,
      enableFiltering: false,
      align: 'right',
      cell: (row) =>
        row.lastOfferPrice != null ? (
          <span className="tabular-nums font-medium text-gray-900">{formatCurrency(row.lastOfferPrice)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      id: 'suppression',
      header: 'Suppression',
      enableSorting: false,
      enableFiltering: false,
      align: 'center',
      cell: (row) => {
        if (!row.suppressed) {
          return <Badge variant="success">Mailable</Badge>;
        }
        const reasons = row.suppressionReasons || [];
        const label = reasons.includes('bad_address')
          ? reasons.length > 1 ? 'Suppressed' : 'Bad address'
          : 'Do not mail';
        return (
          <Badge variant="error" className="capitalize">
            {label}
          </Badge>
        );
      },
    },
  ];

  const summaryTiles = [
    {
      label: 'Properties',
      value: summary ? formatNumber(summary.total) : '—',
      icon: Building2,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Acreage range',
      value: summary ? formatAcreRange(summary.minAcres, summary.maxAcres) : '—',
      icon: Layers,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'States',
      value: summary ? formatNumber(summary.stateCount) : '—',
      icon: MapIcon,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Counties',
      value: summary ? formatNumber(summary.countyCount) : '—',
      icon: Users,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  const hasFilters = Object.values(serverFilters).some(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Properties</h2>
          <p className="text-gray-600 mt-1">Scan parcels, owners, and mailing history to find your next deal</p>
        </div>
      </div>

      {/* Summary header — reflects the current filter set, not just this page */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`p-2 rounded-lg ${tile.bg}`}>
                  <Icon className={`w-5 h-5 ${tile.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-600 truncate">
                    {tile.label}
                    {tile.label === 'Properties' && hasFilters && (
                      <span className="text-blue-600 font-medium"> (filtered)</span>
                    )}
                  </p>
                  <p className="text-xl font-bold text-gray-900 truncate">{tile.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Properties Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            All Properties
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="relative">
              {isFetching && (
                <div className="absolute -top-2 right-0 flex items-center gap-1.5 text-xs text-blue-600 z-10">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating...
                </div>
              )}
              <DataTable
                data={properties}
                columns={columns}
                storageKey="properties_view_v3"
                serverSide
                onFilterChange={setColumnFilters}
                onSortChange={handleSortChange}
                pagination={{
                  page: pagination?.page || 1,
                  totalPages: pagination?.totalPages || 1,
                  total: pagination?.total || 0,
                  onPageChange: setPage,
                }}
                pageSize={PAGE_SIZE}
                onRowClick={(property) => navigate(`/properties/${property.id}`)}
                emptyIcon={<MapPin className="w-12 h-12" />}
                emptyText="No properties found"
                emptySubtext="Try adjusting your column filters"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
