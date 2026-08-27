import { useState } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Table, TableHead, TableBody, TableRow, TableHeader, TableCell } from '../components/ui/Table.tsx';
import { Pagination } from '../components/ui/Pagination.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import {
  useAggregatedMailings,
  useMailingStatsByState,
  useMailingStatsByCounty,
  AggregatedMailing,
} from '../hooks/use-api.ts';
import { formatDate, formatCurrency, formatNumber } from '../lib/format.ts';
import {
  Send,
  Filter,
  BarChart3,
  MapPin,
  Loader2,
  ExternalLink,
  Users,
  Building,
  DollarSign,
  TrendingUp,
  FileSpreadsheet,
  Calendar,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
  const [filters, setFilters] = useState({
    search: '',
    state: '',
    county: '',
    startDate: '',
    endDate: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<string>('mailDate');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: mailingsData, isLoading: mailingsLoading } = useAggregatedMailings({
    page,
    limit: 20,
    search: filters.search || undefined,
    state: filters.state || undefined,
    county: filters.county || undefined,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    sortBy,
    sortOrder,
  });

  const { data: stateStatsData, isLoading: stateStatsLoading } = useMailingStatsByState();
  const { data: countyStatsData, isLoading: countyStatsLoading } = useMailingStatsByCounty(
    filters.state || undefined
  );

  const mailings: AggregatedMailing[] = mailingsData?.data || [];
  const stateStats = stateStatsData?.data || [];
  const countyStats = countyStatsData?.data || [];
  const pagination = mailingsData?.pagination;

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const renderSortIcon = (column: string) => {
    if (sortBy !== column) {
      return <ArrowUpDown className="w-3.5 h-3.5 ml-1 text-gray-400 inline opacity-0 group-hover:opacity-100 transition-opacity" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 ml-1 text-blue-600 inline" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 ml-1 text-blue-600 inline" />
    );
  };

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
        <>
          {/* Search & Filter Header */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search campaigns, states, or counties..."
                    value={filters.search}
                    onChange={(e) => {
                      setFilters({ ...filters, search: e.target.value });
                      setPage(1);
                    }}
                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-4 py-2 text-sm font-medium rounded-lg border flex items-center gap-2 transition-colors ${
                    showFilters || filters.state || filters.county || filters.startDate || filters.endDate
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {(filters.state || filters.county || filters.startDate || filters.endDate) && (
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                  )}
                </button>
              </div>

              {showFilters && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                      State (Code)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. MI, AR"
                      value={filters.state}
                      onChange={(e) => {
                        setFilters({ ...filters, state: e.target.value });
                        setPage(1);
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                      County
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Cleveland"
                      value={filters.county}
                      onChange={(e) => {
                        setFilters({ ...filters, county: e.target.value });
                        setPage(1);
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                      From Mail Date
                    </label>
                    <input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => {
                        setFilters({ ...filters, startDate: e.target.value });
                        setPage(1);
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                      To Mail Date
                    </label>
                    <input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => {
                        setFilters({ ...filters, endDate: e.target.value });
                        setPage(1);
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-4 flex justify-end">
                    <button
                      onClick={() => {
                        setFilters({ search: '', state: '', county: '', startDate: '', endDate: '' });
                        setPage(1);
                      }}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Reset all filters
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Aggregated Mailings Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-blue-600" />
                Distinct Mailers & Campaigns
              </CardTitle>
              {pagination && (
                <div className="text-xs text-gray-500 font-medium">
                  Showing {mailings.length} of {pagination.total} distinct campaigns
                </div>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {mailingsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              ) : !mailings.length ? (
                <div className="text-center py-16 text-gray-500 space-y-2">
                  <Send className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                  <p className="text-base font-semibold text-gray-700">No campaigns found</p>
                  <p className="text-xs text-gray-500">Try adjusting your search terms or filters</p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeader>
                          <button
                            onClick={() => handleSort('campaignName')}
                            className="group flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Campaign / Mailer
                            {renderSortIcon('campaignName')}
                          </button>
                        </TableHeader>
                        <TableHeader>
                          <button
                            onClick={() => handleSort('mailDate')}
                            className="group flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Mail Date
                            {renderSortIcon('mailDate')}
                          </button>
                        </TableHeader>
                        <TableHeader className="text-right">
                          <button
                            onClick={() => handleSort('totalOwners')}
                            className="group inline-flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Owners Mailed
                            {renderSortIcon('totalOwners')}
                          </button>
                        </TableHeader>
                        <TableHeader>States & Counties</TableHeader>
                        <TableHeader className="text-center">
                          <button
                            onClick={() => handleSort('leadsCount')}
                            className="group inline-flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Leads
                            {renderSortIcon('leadsCount')}
                          </button>
                        </TableHeader>
                        <TableHeader className="text-center">
                          <button
                            onClick={() => handleSort('dealsCount')}
                            className="group inline-flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Deals
                            {renderSortIcon('dealsCount')}
                          </button>
                        </TableHeader>
                        <TableHeader className="text-center">
                          <button
                            onClick={() => handleSort('suppressionsCount')}
                            className="group inline-flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Suppressions
                            {renderSortIcon('suppressionsCount')}
                          </button>
                        </TableHeader>
                        <TableHeader className="text-right">
                          <button
                            onClick={() => handleSort('totalOfferAmount')}
                            className="group inline-flex items-center text-xs font-semibold uppercase tracking-wider"
                          >
                            Total Offers
                            {renderSortIcon('totalOfferAmount')}
                          </button>
                        </TableHeader>
                        <TableHeader className="text-center">Sheet Link</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {mailings.map((row) => {
                        const topCounties = row.counties.slice(0, 3);
                        const remainingCounties = row.counties.length - 3;

                        return (
                          <TableRow key={row.id}>
                            {/* Campaign Name */}
                            <TableCell className="align-top py-4">
                              <div className="space-y-1">
                                <Link href={`/campaigns/${row.campaignId}`}>
                                  <span className="font-semibold text-blue-600 hover:underline hover:text-blue-800 cursor-pointer block">
                                    {row.name}
                                  </span>
                                </Link>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <span>ID #{row.campaignId}</span>
                                  <span>•</span>
                                  <span>{formatNumber(row.totalMailings)} total records</span>
                                </div>
                              </div>
                            </TableCell>

                            {/* Mail Date */}
                            <TableCell className="align-top whitespace-nowrap py-4">
                              <div className="flex items-center gap-1.5 text-sm text-gray-900 font-medium">
                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                {formatDate(row.mailDate)}
                              </div>
                              {row.latestMailDate && row.latestMailDate !== row.mailDate && (
                                <div className="text-xs text-gray-500 mt-0.5">
                                  thru {formatDate(row.latestMailDate)}
                                </div>
                              )}
                            </TableCell>

                            {/* Total Owners Mailed */}
                            <TableCell className="align-top text-right py-4">
                              <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
                                <Users className="w-3.5 h-3.5 text-gray-400" />
                                {formatNumber(row.totalOwners)}
                              </div>
                              <div className="text-xs text-gray-500">
                                {formatNumber(row.totalProperties)} props
                              </div>
                            </TableCell>

                            {/* States & Counties Metadata */}
                            <TableCell className="align-top py-4 max-w-xs">
                              <div className="space-y-1.5">
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
                                        <span className="text-gray-400 font-medium ml-1">
                                          +{remainingCounties} more
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </div>
                              </div>
                            </TableCell>

                            {/* Leads Count */}
                            <TableCell className="align-top text-center py-4">
                              {row.leadsCount > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800">
                                  {row.leadsCount}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">0</span>
                              )}
                            </TableCell>

                            {/* Deals Closed Count */}
                            <TableCell className="align-top text-center py-4">
                              {row.dealsCount > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                  {row.dealsCount}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">0</span>
                              )}
                            </TableCell>

                            {/* Suppressions Count */}
                            <TableCell className="align-top text-center py-4">
                              {row.suppressionsCount > 0 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                                  {row.suppressionsCount}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">0</span>
                              )}
                            </TableCell>

                            {/* Total Offers */}
                            <TableCell className="align-top text-right py-4 font-mono font-medium text-gray-900">
                              {row.totalOfferAmount > 0 ? formatCurrency(row.totalOfferAmount) : '-'}
                            </TableCell>

                            {/* Google Sheet Link */}
                            <TableCell className="align-top text-center py-4">
                              {row.googleSheetLink ? (
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
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
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
        </>
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
