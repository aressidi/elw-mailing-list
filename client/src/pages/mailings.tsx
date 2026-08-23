import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import {
  useMailings,
  useMailingStatsByState,
  useMailingStatsByCounty,
  useCampaigns,
} from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import { Send, Filter, BarChart3, MapPin, Loader2 } from 'lucide-react';
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
  const [filters, setFilters] = useState({
    state: '',
    county: '',
    campaignId: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const { data: mailingsData, isLoading: mailingsLoading } = useMailings({
    page,
    limit: 20,
    state: filters.state || undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    campaignId: filters.campaignId ? parseInt(filters.campaignId) : undefined,
  });

  const { data: stateStatsData, isLoading: stateStatsLoading } = useMailingStatsByState();
  const { data: countyStatsData, isLoading: countyStatsLoading } = useMailingStatsByCounty(
    filters.state || undefined
  );
  const { data: campaignsData } = useCampaigns({ limit: 100 });

  const mailings = mailingsData?.data || [];
  const stateStats = stateStatsData?.data || [];
  const countyStats = countyStatsData?.data || [];
  const pagination = mailingsData?.pagination;
  const campaigns = campaignsData?.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Mailings</h2>
          <p className="text-gray-600 mt-1">View and analyze all mailings</p>
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

      {/* Filters (shown in list mode) */}
      {viewMode === 'list' && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex gap-4">
              <div className="flex-1" />
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`btn-secondary flex items-center gap-2 ${showFilters ? 'bg-gray-100' : ''}`}
              >
                <Filter className="w-4 h-4" />
                Filters
              </button>
            </div>

            {showFilters && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-200">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
                  <select
                    value={filters.campaignId}
                    onChange={(e) => {
                      setFilters({ ...filters, campaignId: e.target.value });
                      setPage(1);
                    }}
                    className="input-field"
                  >
                    <option value="">All Campaigns</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    placeholder="e.g. MI"
                    value={filters.state}
                    onChange={(e) => {
                      setFilters({ ...filters, state: e.target.value });
                      setPage(1);
                    }}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => {
                      setFilters({ ...filters, startDate: e.target.value });
                      setPage(1);
                    }}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => {
                      setFilters({ ...filters, endDate: e.target.value });
                      setPage(1);
                    }}
                    className="input-field"
                  />
                </div>
                <div className="sm:col-span-3 flex justify-end">
                  <button
                    onClick={() => {
                      setFilters({ state: '', county: '', campaignId: '', startDate: '', endDate: '' });
                      setPage(1);
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-gray-500" />
              All Mailings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mailingsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
              </div>
            ) : !mailings.length ? (
              <div className="text-center py-12 text-gray-500">
                <Send className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>No mailings found</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>ID</TableHeader>
                      <TableHeader>Owner</TableHeader>
                      <TableHeader>Property</TableHeader>
                      <TableHeader>Campaign</TableHeader>
                      <TableHeader>Mail Date</TableHeader>
                      <TableHeader className="text-right">Offer Price</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {mailings.map((mailing) => (
                      <TableRow key={mailing.id}>
                        <TableCell>{mailing.id}</TableCell>
                        <TableCell>
                          {mailing.owner ? (
                            <Link href={`/owners/${mailing.owner.id}`}>
                              <span className="text-blue-600 hover:underline">
                                {mailing.owner.ownerName}
                              </span>
                            </Link>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {mailing.property ? (
                            <Link href={`/properties/${mailing.property.id}`}>
                              <span className="text-blue-600 hover:underline">
                                {mailing.property.apn}
                              </span>
                            </Link>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {mailing.campaign ? (
                            <Link href={`/campaigns/${mailing.campaign.id}`}>
                              <span className="text-blue-600 hover:underline">
                                {mailing.campaign.name}
                              </span>
                            </Link>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>{formatDate(mailing.mailDate)}</TableCell>
                        <TableCell className="text-right">
                          {mailing.offerPrice ? formatCurrency(Number(mailing.offerPrice)) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {pagination && pagination.totalPages > 1 && (
                  <div className="p-4 border-t border-gray-200">
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={setPage}
                    />
                  </div>
                )}
              </>
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

                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>State</TableHeader>
                      <TableHeader className="text-right">Count</TableHeader>
                      <TableHeader className="text-right">Total Offers</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {stateStats.map((stat) => (
                      <TableRow key={stat.state}>
                        <TableCell>
                          <Badge variant="secondary">{stat.state}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(stat.count)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(stat.offers)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                value={filters.state}
                onChange={(e) => setFilters({ ...filters, state: e.target.value })}
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
                {filters.state && <p className="text-sm mt-1">Try removing the state filter</p>}
              </div>
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>State</TableHeader>
                    <TableHeader>County</TableHeader>
                    <TableHeader className="text-right">Count</TableHeader>
                    <TableHeader className="text-right">Total Offers</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {countyStats.map((stat) => (
                    <TableRow key={`${stat.state}-${stat.county}`}>
                      <TableCell>
                        <Badge variant="secondary">{stat.state}</Badge>
                      </TableCell>
                      <TableCell>{stat.county}</TableCell>
                      <TableCell className="text-right">{formatNumber(stat.count)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(stat.offers)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
