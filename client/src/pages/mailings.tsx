import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import {
  useMailings,
  useMailingStatsByState,
  useMailingStatsByCounty,
  useCampaigns,
  Mailing,
} from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import { Send, BarChart3, MapPin, Loader2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type ViewMode = 'list' | 'by-state' | 'by-county';

export function Mailings() {
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedState, setSelectedState] = useState('');

  const { data: mailingsData, isLoading: mailingsLoading } = useMailings({
    page,
    limit: 100,
  });

  const { data: stateStatsData, isLoading: stateStatsLoading } = useMailingStatsByState();
  const { data: countyStatsData, isLoading: countyStatsLoading } = useMailingStatsByCounty(
    selectedState || undefined
  );
  const { data: campaignsData } = useCampaigns({ limit: 100 });

  const mailings = mailingsData?.data || [];
  const stateStats = stateStatsData?.data || [];
  const countyStats = countyStatsData?.data || [];
  const campaigns = campaignsData?.data || [];

  const campaignOptions = campaigns.map((c) => ({
    label: c.name,
    value: c.name,
  }));

  const columns: ColumnDef<Mailing>[] = [
    {
      id: 'id',
      header: 'ID',
      accessorKey: 'id',
      filterType: 'number',
      headerClassName: 'w-16',
    },
    {
      id: 'owner',
      header: 'Owner',
      accessorFn: (row) => row.owner?.ownerName || '',
      filterType: 'text',
      cell: (row) =>
        row.owner ? (
          <Link href={`/owners/${row.owner.id}`}>
            <span className="font-medium text-blue-600 hover:underline">
              {row.owner.ownerName}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'property',
      header: 'Property (APN)',
      accessorFn: (row) => row.property?.apn || '',
      filterType: 'text',
      cell: (row) =>
        row.property ? (
          <Link href={`/properties/${row.property.id}`}>
            <span className="font-medium text-blue-600 hover:underline">
              {row.property.apn}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'state',
      header: 'State',
      accessorFn: (row) => row.mailingAddress?.state || row.property?.state || '',
      filterType: 'text',
      cell: (row) => {
        const state = row.mailingAddress?.state || row.property?.state;
        return state ? <Badge variant="secondary">{state}</Badge> : '-';
      },
    },
    {
      id: 'campaign',
      header: 'Campaign',
      accessorFn: (row) => row.campaign?.name || '',
      filterType: 'select',
      filterOptions: campaignOptions,
      cell: (row) =>
        row.campaign ? (
          <Link href={`/campaigns/${row.campaign.id}`}>
            <span className="text-blue-600 hover:underline">
              {row.campaign.name}
            </span>
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'mailDate',
      header: 'Mail Date',
      accessorKey: 'mailDate',
      filterType: 'date',
      cell: (row) => formatDate(row.mailDate),
    },
    {
      id: 'offerPrice',
      header: 'Offer Price',
      accessorKey: 'offerPrice',
      filterType: 'number',
      align: 'right',
      cell: (row) => (row.offerPrice ? formatCurrency(Number(row.offerPrice)) : '-'),
      comparator: (a, b) => (Number(a.offerPrice) || 0) - (Number(b.offerPrice) || 0),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Mailings</h2>
          <p className="text-gray-600 mt-1">Manage, sort, filter, and analyze all mail records</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('by-state')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'by-state' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              By State
            </button>
            <button
              onClick={() => setViewMode('by-county')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'by-county' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              By County
            </button>
          </div>
        </div>
      </div>

      {/* List View */}
      {viewMode === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-blue-600" />
              All Mailings
            </CardTitle>
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
                emptyText="No mailings found"
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
                        contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
