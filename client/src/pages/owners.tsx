import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useOwners, Owner } from '../hooks/use-api.ts';
import { formatDate } from '../lib/format.ts';
import { Users, Loader2 } from 'lucide-react';

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

  // We load a generous limit so client-side table sorting & column filtering is fast & comprehensive
  const { data, isLoading } = useOwners({
    page,
    limit: 100,
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
            <DataTable
              data={owners}
              columns={columns}
              storageKey="owners_view"
              onRowClick={handleRowClick}
              emptyIcon={<Users className="w-12 h-12" />}
              emptyText="No owners found"
              emptySubtext="Try adjusting your column filters or search"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
