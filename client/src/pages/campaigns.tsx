import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useCampaigns, Campaign } from '../hooks/use-api.ts';
import { formatDate } from '../lib/format.ts';
import { Megaphone, ExternalLink, Loader2 } from 'lucide-react';

export function Campaigns() {
  const [page, setPage] = useState(1);
  const [, navigate] = useLocation();

  const { data, isLoading } = useCampaigns({ page, limit: 100 });
  const campaigns = data?.data || [];
  const pagination = data?.pagination;

  const handleRowClick = (campaign: Campaign) => {
    navigate(`/campaigns/${campaign.id}`);
  };

  const columns: ColumnDef<Campaign>[] = [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      filterType: 'number',
      headerClassName: 'w-16',
    },
    {
      id: 'name',
      header: 'Campaign Name',
      accessorKey: 'name',
      filterType: 'text',
      cell: (row) => (
        <span className="font-medium text-blue-600 hover:underline">
          {row.name}
        </span>
      ),
    },
    {
      id: 'link',
      header: 'Link',
      accessorKey: 'link',
      filterType: 'text',
      cell: (row) =>
        row.link ? (
          <a
            href={row.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            External Link
          </a>
        ) : (
          '-'
        ),
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
          <h2 className="text-2xl font-bold text-gray-900">Campaigns</h2>
          <p className="text-gray-600 mt-1">Manage, sort, and filter all mailing campaigns</p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${pagination.total} total campaigns`}
        </div>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-blue-600" />
            All Campaigns
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <DataTable
              data={campaigns}
              columns={columns}
              storageKey="campaigns_view"
              onRowClick={handleRowClick}
              emptyIcon={<Megaphone className="w-12 h-12" />}
              emptyText="No campaigns found"
              emptySubtext="Try adjusting your column filters or search"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
