import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import {
  useAggregatedMailings,
  useMailingStatsByState,
  useMailingStatsByCounty,
  AggregatedMailing,
} from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import {
  Send,
  BarChart3,
  MapPin,
  Loader2,
  ExternalLink,
  Users,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type ViewMode = 'campaigns' | 'by-state' | 'by-county';

export function Mailings() {
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('campaigns');
  const [selectedState, setSelectedState] = useState('');

  // We load a generous limit so client-side table sorting & column filtering is fast & comprehensive
  const { data: mailingsData, isLoading: mailingsLoading } = useAggregatedMailings({
    page,
    limit: 100,
  });

  const { data: stateStatsData, isLoading: stateStatsLoading } = useMailingStatsByState();
  const { data: countyStatsData, isLoading: countyStatsLoading } = useMailingStatsByCounty(
    selectedState || undefined
  );

  const mailings: AggregatedMailing[] = mailingsData?.data || [];
  const stateStats = stateStatsData?.data || [];
  const countyStats = countyStatsData?.data || [];
  const pagination = mailingsData?.pagination;

  const columns: ColumnDef<AggregatedMailing>[] = [
    {
      id: 'campaignName',
      header: 'Campaign / Mailer',
      accessorKey: 'name',
      filterType: 'text',
      cell: (row) => (
        <div className="space-y-1">
          <Link href={`/campaigns/${row.campaignId}`}>
            <span className="font-semibold text-blue-600 hover:underline">{row.name}</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>ID #{row.campaignId}</span>
            <span>•</span>
            <span>{formatNumber(row.totalMailings)} total records</span>
          </div>
        </div>
      ),
    },
    {
      id: 'mailDate',
      header: 'Mail Date',
      accessorKey: 'mailDate',
      filterType: 'date',
      cell: (row) => (
        <div>
          <div className="flex items-center gap-1.5 text-sm text-gray-900 font-medium">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatDate(row.mailDate)}
          </div>
          {row.latestMailDate && row.latestMailDate !== row.mailDate && (
            <div className="text-xs text-gray-500 mt-0.5">thru {formatDate(row.latestMailDate)}</div>
          )}
        </div>
      ),
    },
    {
      id: 'totalOwners',
      header: 'Owners Mailed',
      accessorKey: 'totalOwners',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div>
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            {formatNumber(row.totalOwners)}
          </div>
          <div className="text-xs text-gray-500">{formatNumber(row.totalProperties)} props</div>
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
      id: 'totalOfferAmount',
      header: 'Total Offers',
      accessorKey: 'totalOfferAmount',
      filterType: 'number',
      align: 'right',
      cell: (row) => (row.totalOfferAmount > 0 ? formatCurrency(row.totalOfferAmount) : '-'),
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
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Mailings</h2>
          <p className="text-gray-600 mt-1">
            Aggregated campaign overview: owners mailed, response metrics, and geographic coverage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('campaigns')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'campaigns'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Campaigns / Mailers
            </button>
            <button
              onClick={() => setViewMode('by-state')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'by-state'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              By State
            </button>
            <button
              onClick={() => setViewMode('by-county')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'by-county'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              By County
            </button>
          </div>
        </div>
      </div>

      {/* Campaigns / Distinct Mailers Aggregated View */}
      {viewMode === 'campaigns' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-600" />
              Distinct Mailers & Campaigns
            </CardTitle>
            {pagination && (
              <div className="text-xs text-gray-500 font-medium">
                {formatNumber(pagination.total)} total campaigns
              </div>
            )}
          </CardHeader>
          <CardContent className="p-4">
            {mailingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : (
              <DataTable
                data={mailings}
                columns={columns}
                storageKey="mailings_view"
                emptyIcon={<Send className="w-12 h-12" />}
                emptyText="No campaigns found"
                emptySubtext="Try adjusting your column filters or sorting"
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* By State View */}
      {viewMode === 'by-state' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-gray-500" />
              Mailings by State
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stateStatsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : stateStats.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>No data available</p>
              </div>
            ) : (
              <>
                <div className="h-64 mb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stateStats.slice(0, 15)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="state" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [formatNumber(value), 'Mailings']}
                        contentStyle={{
                          borderRadius: 8,
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <DataTable
                  data={stateStats}
                  columns={[
                    {
                      id: 'state',
                      header: 'State',
                      accessorKey: 'state',
                      filterType: 'text',
                      cell: (row) => <Badge variant="secondary">{row.state}</Badge>,
                    },
                    {
                      id: 'count',
                      header: 'Count',
                      accessorKey: 'count',
                      filterType: 'number',
                      align: 'right',
                      cell: (row) => formatNumber(row.count),
                    },
                    {
                      id: 'offers',
                      header: 'Total Offers',
                      accessorKey: 'offers',
                      filterType: 'number',
                      align: 'right',
                      cell: (row) => formatCurrency(row.offers),
                    },
                  ]}
                  storageKey="mailings_by_state"
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* By County View */}
      {viewMode === 'by-county' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-gray-500" />
              Mailings by County
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Filter by State</label>
              <input
                type="text"
                placeholder="e.g. MI"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
                className="input-field max-w-xs"
              />
            </div>

            {countyStatsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : countyStats.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>No data available</p>
                {selectedState && <p className="text-sm mt-1">Try removing the state filter</p>}
              </div>
            ) : (
              <DataTable
                data={countyStats}
                columns={[
                  {
                    id: 'state',
                    header: 'State',
                    accessorKey: 'state',
                    filterType: 'text',
                    cell: (row) => <Badge variant="secondary">{row.state}</Badge>,
                  },
                  {
                    id: 'county',
                    header: 'County',
                    accessorKey: 'county',
                    filterType: 'text',
                    cell: (row) => row.county,
                  },
                  {
                    id: 'count',
                    header: 'Count',
                    accessorKey: 'count',
                    filterType: 'number',
                    align: 'right',
                    cell: (row) => formatNumber(row.count),
                  },
                  {
                    id: 'offers',
                    header: 'Total Offers',
                    accessorKey: 'offers',
                    filterType: 'number',
                    align: 'right',
                    cell: (row) => formatCurrency(row.offers),
                  },
                ]}
                storageKey="mailings_by_county"
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
