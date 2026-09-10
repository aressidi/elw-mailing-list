import { useEffect, useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef, ColumnFilters } from '../components/ui/DataTable.tsx';
import { useProperties, Property } from '../hooks/use-api.ts';
import { formatAcreage, formatNumber, truncate } from '../lib/format.ts';
import { MapPin, Loader2 } from 'lucide-react';

// How long to wait after a column filter changes before hitting the server,
// so rapid Apply/Reset clicks don't each trigger their own request.
const FILTER_DEBOUNCE_MS = 350;

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
].map((s) => ({ value: s, label: s }));

export function Properties() {
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const [serverFilters, setServerFilters] = useState<{ apn?: string; state?: string; county?: string }>({});

  // Debounce column filter changes before sending them to the server, since
  // apn/county/state filtering must search the whole table, not just
  // whichever page happens to be loaded client-side.
  useEffect(() => {
    const timer = setTimeout(() => {
      setServerFilters({
        apn: columnFilters.apn?.value?.trim() || undefined,
        state: columnFilters.state?.selectedOption || undefined,
        county: columnFilters.county?.value?.trim() || undefined,
      });
    }, FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [columnFilters.apn?.value, columnFilters.state?.selectedOption, columnFilters.county?.value]);

  const hasServerFilter = !!(serverFilters.apn || serverFilters.state || serverFilters.county);

  // We load a generous limit so client-side table sorting & column filtering is fast & comprehensive.
  // When an apn/state/county filter is active, it's applied server-side across the whole table (not just this page).
  const { data, isLoading, isFetching } = useProperties({
    page: hasServerFilter ? 1 : page,
    limit: 100,
    ...serverFilters,
  });

  const properties = data?.data || [];
  const pagination = data?.pagination;

  const handleRowClick = (property: Property) => {
    navigate(`/properties/${property.id}`);
  };

  const columns: ColumnDef<Property>[] = [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      filterType: 'number',
      headerClassName: 'w-16',
    },
    {
      id: 'apn',
      header: 'APN',
      accessorKey: 'apn',
      filterType: 'text',
      cell: (row) => (
        <span className="font-medium text-blue-600 hover:underline font-mono">
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
      cell: (row) => (row.state ? <Badge variant="secondary">{row.state}</Badge> : '-'),
    },
    {
      id: 'county',
      header: 'County',
      accessorKey: 'county',
      filterType: 'text',
      cell: (row) => row.county || '-',
    },
    {
      id: 'zip',
      header: 'ZIP',
      accessorKey: 'zip',
      filterType: 'text',
      cell: (row) => row.zip || '-',
    },
    {
      id: 'acres',
      header: 'Acres',
      accessorKey: 'acres',
      filterType: 'number',
      align: 'right',
      cell: (row) => formatAcreage(row.acres),
      comparator: (a, b) => (Number(a.acres) || 0) - (Number(b.acres) || 0),
    },
    {
      id: 'legalDescription',
      header: 'Legal Description',
      accessorKey: 'legalDescription',
      filterType: 'text',
      cell: (row) => (
        <span className="text-gray-600 text-xs block max-w-xs truncate" title={row.legalDescription || undefined}>
          {truncate(row.legalDescription, 45)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Properties</h2>
          <p className="text-gray-600 mt-1">Manage, sort, filter, and view all parcel records</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${formatNumber(pagination.total)} total properties`}
        </div>
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
                <div className="absolute -top-2 right-0 flex items-center gap-1.5 text-xs text-blue-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating...
                </div>
              )}
              <DataTable
                data={properties}
                columns={columns}
                storageKey="properties_view_v2"
                onFilterChange={setColumnFilters}
                onRowClick={handleRowClick}
                emptyIcon={<MapPin className="w-12 h-12" />}
                emptyText="No properties found"
                emptySubtext="Try adjusting your column filters or sorting"
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
