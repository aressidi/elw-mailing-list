import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useCampaignsWithStats, CampaignWithStats } from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import {
  Megaphone,
  ExternalLink,
  Loader2,
  Users,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';

export function Campaigns() {
  const [page, setPage] = useState(1);
  const [, navigate] = useLocation();

  // Generous limit so client-side column filtering & sorting is fast & comprehensive
  const { data, isLoading } = useCampaignsWithStats({ page, limit: 100 });
  const campaigns = data?.data || [];
  const pagination = data?.pagination;

  const handleRowClick = (campaign: CampaignWithStats) => {
    navigate(`/campaigns/${campaign.id}`);
  };

  const columns: ColumnDef<CampaignWithStats>[] = [
    {
      id: 'name',
      header: 'Campaign Name',
      accessorKey: 'name',
      filterType: 'text',
      cell: (row) => (
        <Link href={`/campaigns/${row.id}`}>
          <span
            className="font-medium text-blue-600 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.name}
          </span>
        </Link>
      ),
    },
    {
      id: 'totalMailings',
      header: 'Mailed / Owners',
      accessorKey: 'totalMailings',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div>
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            {formatNumber(row.totalMailings)}
          </div>
          <div className="text-xs text-gray-500">{formatNumber(row.totalOwners)} owners</div>
        </div>
      ),
    },
    {
      id: 'states',
      header: 'States & Counties',
      accessorFn: (row) => row.states.join(', '),
      filterType: 'text',
      cell: (row) => {
        const topCounties = row.counties.slice(0, 3);
        const remainingCounties = row.counties.length - 3;
        return (
          <div className="space-y-1.5 max-w-xs">
            <div className="flex flex-wrap gap-1">
              {row.states.length > 0 ? (
                row.states.map((st) => (
                  <Badge key={st} variant="secondary" className="font-mono text-xs font-semibold">
                    {st}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-gray-400">-</span>
              )}
            </div>
            <div className="text-xs text-gray-600 truncate" title={row.counties.join(', ')}>
              {topCounties.length > 0 ? (
                <>
                  <span>{topCounties.join(', ')}</span>
                  {remainingCounties > 0 && (
                    <span className="text-gray-400 font-medium ml-1">+{remainingCounties} more</span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: 'totalOfferAmount',
      header: 'Offers',
      accessorKey: 'totalOfferAmount',
      filterType: 'number',
      align: 'right',
      cell: (row) => (row.totalOfferAmount > 0 ? formatCurrency(row.totalOfferAmount) : '-'),
    },
    {
      id: 'leadsCount',
      header: 'Leads',
      accessorKey: 'leadsCount',
      filterType: 'number',
      align: 'center',
      cell: (row) =>
        row.leadsCount > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800">
            {row.leadsCount}
          </span>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        ),
    },
    {
      id: 'dealsCount',
      header: 'Deals',
      accessorKey: 'dealsCount',
      filterType: 'number',
      align: 'center',
      cell: (row) =>
        row.dealsCount > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
            {row.dealsCount}
          </span>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        ),
    },
    {
      id: 'suppressionsCount',
      header: 'Suppressions',
      accessorKey: 'suppressionsCount',
      filterType: 'number',
      align: 'center',
      cell: (row) =>
        row.suppressionsCount > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            {row.suppressionsCount}
          </span>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        ),
    },
    {
      id: 'googleSheetLink',
      header: 'Sheet Link',
      accessorKey: 'googleSheetLink',
      enableFiltering: false,
      align: 'center',
      cell: (row) =>
        row.googleSheetLink ? (
          <a
            href={row.googleSheetLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors"
            title={row.googleSheetLink}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Sheet</span>
            <ExternalLink className="w-3 h-3 text-emerald-500" />
          </a>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      id: 'firstMailDate',
      header: 'Mail Date',
      accessorKey: 'firstMailDate',
      filterType: 'date',
      cell: (row) => (
        <div>
          <div className="flex items-center gap-1.5 text-sm text-gray-900 font-medium">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatDate(row.firstMailDate)}
          </div>
          {row.lastMailDate && row.lastMailDate !== row.firstMailDate && (
            <div className="text-xs text-gray-500 mt-0.5">thru {formatDate(row.lastMailDate)}</div>
          )}
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessorKey: 'createdAt',
      filterType: 'date',
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Campaigns</h2>
          <p className="text-gray-600 mt-1">
            High-level campaign overview: mailings, owners, response metrics, and geographic coverage
          </p>
        </div>
        <div className="text-sm text-gray-500">
          {pagination && `${formatNumber(pagination.total)} total campaigns`}
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
