import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import {
  useDashboardStats,
  useMailingStatsByState,
  useMailingStatsByCounty,
  useMailVolumeByMonth,
  MailingStateStat,
  CountyStat,
} from '../hooks/use-api.ts';
import {
  Building,
  Users,
  Send,
  TrendingUp,
  DollarSign,
  Ban,
  Megaphone,
  Loader2,
  MapPin,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { formatNumber, formatCurrency, formatPercent } from '../lib/format.ts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16', '#f97316'];

export function Dashboard() {
  const [coverageState, setCoverageState] = useState('');

  const { data: statsData, isLoading: statsLoading } = useDashboardStats();
  const { data: stateStatsData, isLoading: stateLoading } = useMailingStatsByState();
  const { data: countyStatsData, isLoading: countyLoading } = useMailingStatsByCounty(
    coverageState || undefined
  );
  const { data: mailVolumeData, isLoading: mailVolumeLoading } = useMailVolumeByMonth();

  const stats = statsData?.data;
  const stateStats = stateStatsData?.data || [];
  const countyStats = countyStatsData?.data || [];
  const mailVolume = mailVolumeData?.data || [];

  const stateColumns: ColumnDef<MailingStateStat>[] = [
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
  ];

  const countyColumns: ColumnDef<CountyStat>[] = [
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
  ];

  const overviewCards = stats?.overview
    ? [
        { label: 'Properties', value: stats.overview.totalProperties, icon: Building, color: 'text-blue-600', bgColor: 'bg-blue-50' },
        { label: 'Owners', value: stats.overview.totalOwners, icon: Users, color: 'text-green-600', bgColor: 'bg-green-50' },
        { label: 'Mailings', value: stats.overview.totalMailings, icon: Send, color: 'text-purple-600', bgColor: 'bg-purple-50' },
        { label: 'Campaigns', value: stats.overview.totalCampaigns, icon: Megaphone, color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
        { label: 'Deals', value: stats.overview.totalDeals, icon: TrendingUp, color: 'text-orange-600', bgColor: 'bg-orange-50' },
        { label: 'Leads', value: stats.overview.totalLeads, icon: DollarSign, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
        { label: 'Conversions', value: stats.overview.totalConversions, icon: TrendingUp, color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
        { label: 'Suppressed', value: stats.overview.totalSuppressed, icon: Ban, color: 'text-red-600', bgColor: 'bg-red-50' },
      ]
    : [];

  const responseStats = stats?.overview
    ? [
        { label: 'Response Rate', value: formatPercent(stats.overview.responseRate), trend: 'From all mailings' },
        { label: 'Lead Rate', value: formatPercent(stats.overview.leadRate), trend: 'Of responses' },
        { label: 'Conversion Rate', value: formatPercent(stats.overview.conversionRate), trend: 'Of responses' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-600 mt-1">Overview of your mailing list operations</p>
      </div>

      {statsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {overviewCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                      <Icon className={`w-5 h-5 ${stat.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-600 truncate">{stat.label}</p>
                      <p className="text-xl font-bold text-gray-900">{formatNumber(stat.value)}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Response Rates */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {responseStats.map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <p className="text-sm text-gray-600">{stat.label}</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
                  <p className="text-xs text-gray-500 mt-1">{stat.trend}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Properties by State */}
            <Card>
              <CardHeader>
                <CardTitle>Mailings by State</CardTitle>
              </CardHeader>
              <CardContent>
                {stateLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : stateStats.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No mailing data available</p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stateStats.slice(0, 10)}>
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
                )}
              </CardContent>
            </Card>

            {/* State Distribution Pie */}
            <Card>
              <CardHeader>
                <CardTitle>Distribution by State</CardTitle>
              </CardHeader>
              <CardContent>
                {stateLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : stateStats.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No data available</p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stateStats.slice(0, 8)}
                          dataKey="count"
                          nameKey="state"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={2}
                        >
                          {stateStats.slice(0, 8).map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => formatNumber(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 justify-center mt-2">
                      {stateStats.slice(0, 8).map((s, i) => (
                        <div key={s.state} className="flex items-center gap-1 text-xs">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          {s.state}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Mail Volume by Month */}
            <Card>
              <CardHeader>
                <CardTitle>Mail Volume by Month</CardTitle>
              </CardHeader>
              <CardContent>
                {mailVolumeLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : mailVolume.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <p>No mailing data available</p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mailVolume}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip
                          formatter={(value: number) => [formatNumber(value), 'Mailings']}
                          contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Mailing Coverage: By State / By County */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Mailing Coverage</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-gray-500" />
                    By State
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  {stateLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                  ) : stateStats.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p>No data available</p>
                    </div>
                  ) : (
                    <DataTable
                      data={stateStats}
                      columns={stateColumns}
                      storageKey="dashboard_coverage_by_state"
                      emptyIcon={<MapPin className="w-12 h-12" />}
                      emptyText="No state data found"
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-gray-500" />
                    By County
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Filter by State</label>
                    <input
                      type="text"
                      placeholder="e.g. MI"
                      value={coverageState}
                      onChange={(e) => setCoverageState(e.target.value)}
                      className="input-field max-w-xs"
                    />
                  </div>

                  {countyLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                  ) : countyStats.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                      <p>No data available</p>
                      {coverageState && <p className="text-sm mt-1">Try removing the state filter</p>}
                    </div>
                  ) : (
                    <DataTable
                      data={countyStats}
                      columns={countyColumns}
                      storageKey="dashboard_coverage_by_county"
                      emptyIcon={<MapPin className="w-12 h-12" />}
                      emptyText="No county data found"
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Mailings */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Mailings</CardTitle>
              </CardHeader>
              <CardContent>
                {!stats?.recentActivity?.mailings?.length ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No recent mailings</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.recentActivity.mailings.map((mailing) => (
                      <div
                        key={mailing.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {mailing.owner?.ownerName || 'Unknown Owner'}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {mailing.property?.county}, {mailing.property?.state} • {mailing.campaign?.name}
                          </p>
                        </div>
                        <div className="text-right ml-4">
                          <p className="font-medium text-gray-900">
                            {mailing.offerPrice ? formatCurrency(Number(mailing.offerPrice)) : '-'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {mailing.mailDate ? new Date(mailing.mailDate).toLocaleDateString() : '-'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Deals */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Deals / Responses</CardTitle>
              </CardHeader>
              <CardContent>
                {!stats?.recentActivity?.deals?.length ? (
                  <div className="text-center py-8 text-gray-500">
                    <p>No recent deals</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.recentActivity.deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">
                            {deal.owner?.ownerName || 'Unknown Owner'}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {deal.property?.county}, {deal.property?.state} • {deal.hitType}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          {deal.isLead && <Badge variant="warning">Lead</Badge>}
                          {deal.isConversion && <Badge variant="success">Won</Badge>}
                          {!deal.isLead && !deal.isConversion && <Badge variant="secondary">Touch</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
