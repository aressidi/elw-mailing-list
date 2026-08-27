import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useProperties, Property } from '../hooks/use-api.ts';
import { formatAcreage, formatNumber, truncate } from '../lib/format.ts';
import { MapPin, Loader2 } from 'lucide-react';

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

  const { data, isLoading } = useProperties({
    page,
    limit: 100,
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
            <DataTable
              data={properties}
              columns={columns}
              storageKey="properties_view"
              onRowClick={handleRowClick}
              emptyIcon={<MapPin className="w-12 h-12" />}
              emptyText="No properties found"
              emptySubtext="Try adjusting your column filters or sorting"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
