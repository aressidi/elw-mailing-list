import { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef, ColumnFilters } from '../components/ui/DataTable.tsx';
import { useOwners, Owner, OwnerLocationSummary } from '../hooks/use-api.ts';
import { formatDate, formatCurrency } from '../lib/format.ts';
import { Users, Loader2 } from 'lucide-react';

// How long to wait after a column filter changes before hitting the server,
// so rapid Apply/Reset clicks don't each trigger their own request.
const FILTER_DEBOUNCE_MS = 350;

// How many distinct county locations to list inline before collapsing the rest
// into a "+N more" (the full set is still available via the cell tooltip).
const LOCATION_PREVIEW_LIMIT = 3;

// Distinct, order-preserving state codes an owner holds property in.
function distinctStates(locations: OwnerLocationSummary[] | undefined): string[] {
  const seen: string[] = [];
  for (const loc of locations || []) {
    if (loc.state && !seen.includes(loc.state)) seen.push(loc.state);
  }
  return seen;
}

// "County, ST" (or just the county/state when the other is missing).
function formatLocation(loc: OwnerLocationSummary): string {
  if (loc.county && loc.state) return `${loc.county}, ${loc.state}`;
  return loc.county || loc.state || '-';
}

const OWNER_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'company', label: 'Company' },
  { value: 'trust', label: 'Trust' },
  { value: 'llc', label: 'LLC' },
  { value: 'other', label: 'Other' },
];

export function Owners() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [serverFilters, setServerFilters] = useState<{
    ownerName?: string;
    firstName?: string;
    lastName?: string;
    propertyState?: string;
    propertyCounty?: string;
  }>({});

  // Debounce column filter changes before sending them to the server. These
  // filters must search the whole table (name across owners, state/county
  // across each owner's properties), not just whichever page is loaded
  // client-side, so they're applied server-side as ilike matches.
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerFilters({
        ownerName: columnFilters.ownerName?.value?.trim() || undefined,
        firstName: columnFilters.firstName?.value?.trim() || undefined,
        lastName: columnFilters.lastName?.value?.trim() || undefined,
        propertyState: columnFilters.state?.value?.trim() || undefined,
        propertyCounty: columnFilters.county?.value?.trim() || undefined,
      });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    columnFilters.ownerName?.value,
    columnFilters.firstName?.value,
    columnFilters.lastName?.value,
    columnFilters.state?.value,
    columnFilters.county?.value,
  ]);

  const hasServerFilter = !!(
    serverFilters.ownerName ||
    serverFilters.firstName ||
    serverFilters.lastName ||
    serverFilters.propertyState ||
    serverFilters.propertyCounty
  );

  // We load a generous limit so client-side table sorting & column filtering is fast & comprehensive.
  // When a server-side filter is active, it's applied across the whole table (not just this page).
  const { data, isLoading, isFetching } = useOwners({
    page: hasServerFilter ? 1 : page,
    limit: 100,
    ...serverFilters,
  });

  const owners = data?.data || [];
  const pagination = data?.pagination;

  const handleRowClick = (owner: Owner) => {
    navigate(`/owners/${owner.id}`);
  };

  const columns: ColumnDef<Owner>[] = [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      filterType: 'number',
      headerClassName: 'w-16',
    },
    {
      id: 'ownerName',
      header: 'Owner Name',
      accessorKey: 'ownerName',
      filterType: 'text',
      cell: (row) => (
        <span className="font-medium text-blue-600 hover:underline">
          {row.ownerName}
        </span>
      ),
    },
    {
      id: 'ownerType',
      header: 'Type',
      accessorKey: 'ownerType',
      filterType: 'select',
      filterOptions: OWNER_TYPES,
      cell: (row) => (
        <Badge variant="secondary" className="capitalize">
          {row.ownerType}
        </Badge>
      ),
    },
    {
      id: 'firstName',
      header: 'First Name',
      accessorKey: 'firstName',
      filterType: 'text',
      cell: (row) => row.firstName || '-',
    },
    {
      id: 'lastName',
      header: 'Last Name',
      accessorKey: 'lastName',
      filterType: 'text',
      cell: (row) => row.lastName || '-',
    },
    {
      id: 'properties',
      header: 'Properties',
      accessorFn: (row) => row.propertyCount ?? row.properties?.length ?? 0,
      enableFiltering: false,
      cell: (row) => {
        const properties = row.properties || [];
        const total = row.propertyCount ?? properties.length;
        if (total === 0) {
          return <span className="text-gray-400 text-sm">No properties</span>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1">
            {properties.map((p) => (
              <Link key={p.id} href={`/properties/${p.id}`} onClick={(e) => e.stopPropagation()}>
                <span className="font-mono text-xs text-blue-600 hover:underline bg-blue-50 px-1.5 py-0.5 rounded">
                  {p.apn}
                </span>
              </Link>
            ))}
            {total > properties.length && (
              <span className="text-xs text-gray-500">+{total - properties.length} more</span>
            )}
          </div>
        );
      },
      comparator: (a, b) => (a.propertyCount ?? 0) - (b.propertyCount ?? 0),
    },
    {
      id: 'state',
      header: 'State',
      // Server-side ilike filter (propertyState); sorting disabled since an
      // owner can span several states and rows only hold the current page.
      filterType: 'text',
      enableSorting: false,
      cell: (row) => {
        const states = distinctStates(row.locations);
        if (states.length === 0) {
          return <span className="text-gray-400 text-sm">-</span>;
        }
        return (
          <div className="flex flex-wrap items-center gap-1">
            {states.map((s) => (
              <Badge key={s} variant="secondary" className="font-mono">
                {s}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      id: 'county',
      header: 'County',
      // Server-side ilike filter (propertyCounty). Shows each distinct
      // (state, county) the owner holds property in, so multi-property owners
      // read as a compact "Halifax, NC · Benton, AR" summary.
      filterType: 'text',
      enableSorting: false,
      cell: (row) => {
        const locations = (row.locations || []).filter((l) => l.county);
        if (locations.length === 0) {
          return <span className="text-gray-400 text-sm">-</span>;
        }
        const shown = locations.slice(0, LOCATION_PREVIEW_LIMIT);
        const extra = locations.length - shown.length;
        return (
          <div
            className="flex flex-col gap-0.5"
            title={locations.map(formatLocation).join('; ')}
          >
            {shown.map((l) => (
              <span key={`${l.state ?? ''}-${l.county}`} className="text-sm text-gray-700 whitespace-nowrap">
                {formatLocation(l)}
                {l.count > 1 && <span className="text-gray-400"> ×{l.count}</span>}
              </span>
            ))}
            {extra > 0 && <span className="text-xs text-gray-500">+{extra} more</span>}
          </div>
        );
      },
    },
    {
      id: 'lastOfferPrice',
      header: 'Last Offer',
      accessorKey: 'lastOfferPrice',
      filterType: 'number',
      align: 'right',
      cell: (row) => (row.lastOfferPrice != null ? formatCurrency(row.lastOfferPrice) : '-'),
      comparator: (a, b) => (Number(a.lastOfferPrice) || 0) - (Number(b.lastOfferPrice) || 0),
    },
    {
      id: 'createdAt',
      header: 'Created Date',
      accessorKey: 'createdAt',
      filterType: 'date',
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Owners</h2>
          <p className="text-gray-600 mt-1">Manage, sort, filter, and view all property owners</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${pagination.total} total owners`}
        </div>
      </div>

      {/* Owners Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            All Owners
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
                <div className="absolute -top-2 right-0 flex items-center gap-1.5 text-xs text-blue-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating...
                </div>
              )}
              <DataTable
                data={owners}
                columns={columns}
                storageKey="owners_view_v2"
                onFilterChange={setColumnFilters}
                onRowClick={handleRowClick}
                emptyIcon={<Users className="w-12 h-12" />}
                emptyText="No owners found"
                emptySubtext="Try adjusting your column filters or search"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
