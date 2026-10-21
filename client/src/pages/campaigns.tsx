import { useState } from 'react';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useCampaignsWithStats, CampaignWithStats } from '../hooks/use-api.ts';
import { formatDateISO, formatAcreRange, formatNumber } from '../lib/format.ts';
import {
  Megaphone,
  ExternalLink,
  Loader2,
  Mail,
  Ruler,
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
      id: 'states',
      header: 'States',
      accessorFn: (row) => row.states.join(', '),
      filterType: 'text',
      cell: (row) => (
        <div className="flex flex-wrap gap-1 max-w-[12rem]">
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
      ),
    },
    {
      id: 'counties',
      header: 'Counties',
      accessorFn: (row) => row.counties.join(', '),
      filterType: 'text',
      cell: (row) => {
        const topCounties = row.counties.slice(0, 3);
        const remainingCounties = row.counties.length - 3;
        return (
          <div className="text-xs text-gray-700 max-w-xs truncate" title={row.counties.join(', ')}>
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
        );
      },
    },
    {
      id: 'firstMailDate',
      header: 'Mailing Date',
      accessorKey: 'firstMailDate',
      filterType: 'date',
      cell: (row) => (
        <div>
          <div className="flex items-center gap-1.5 text-sm text-gray-900 font-medium">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatDateISO(row.firstMailDate)}
          </div>
          {row.lastMailDate && row.lastMailDate !== row.firstMailDate && (
            <div className="text-xs text-gray-500 mt-0.5">thru {formatDateISO(row.lastMailDate)}</div>
          )}
        </div>
      ),
    },
    {
      id: 'totalMailings',
      header: 'Volume Mailed',
      accessorKey: 'totalMailings',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
          <Mail className="w-3.5 h-3.5 text-gray-400" />
          {formatNumber(row.totalMailings)}
        </div>
      ),
    },
    {
      id: 'minAcres',
      header: 'Acre Range',
      accessorKey: 'minAcres',
      filterType: 'number',
      align: 'right',
      cell: (row) => {
        const range = formatAcreRange(row.minAcres, row.maxAcres);
        return range === '-' ? (
          <span className="text-xs text-gray-400">-</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-gray-700">
            <Ruler className="w-3.5 h-3.5 text-gray-400" />
            {range}
          </span>
        );
      },
    },
    {
      id: 'hitsCount',
      header: 'Hits',
      accessorKey: 'hitsCount',
      filterType: 'number',
      align: 'center',
      cell: (row) =>
        row.hitsCount > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
            {row.hitsCount}
          </span>
        ) : (
          <span className="text-xs text-gray-400">0</span>
        ),
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
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Campaigns</h2>
          <p className="text-gray-600 mt-1">
            Mailing-level overview: geography, volume, acreage, and response metrics
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
