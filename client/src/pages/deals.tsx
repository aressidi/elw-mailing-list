import { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef, SortState } from '../components/ui/DataTable.tsx';
import { useDeals, useDealStats, Deal, DealOutcome } from '../hooks/use-api.ts';
import {
  formatDate,
  formatPercent,
  dateRangeForPreset,
  toDateInputValue,
  DATE_RANGE_PRESETS,
  DateRangePreset,
  DateRange,
} from '../lib/format.ts';
import {
  TrendingUp,
  Phone,
  Mail,
  Globe,
  MessageSquare,
  Send,
  HelpCircle,
  Loader2,
  Check,
  Minus,
  CalendarRange,
} from 'lucide-react';

const HIT_TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'website', label: 'Website' },
  { value: 'text', label: 'Text' },
  { value: 'mail', label: 'Mail' },
  { value: 'other', label: 'Other' },
];

const OUTCOME_OPTIONS: Array<{ value: DealOutcome; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'touch', label: 'Touch' },
];

const HIT_TYPE_ICONS: Record<string, any> = {
  call: Phone,
  email: Mail,
  website: Globe,
  text: MessageSquare,
  mail: Send,
  other: HelpCircle,
};

const PAGE_SIZE = 25;

// Maps a sortable table column id onto the server-side sort field.
const SORT_FIELD_BY_COLUMN: Record<string, string> = {
  hitType: 'hitType',
  hitDate: 'hitDate',
  lead: 'isLead',
  conversion: 'isConversion',
};

type ActivePreset = DateRangePreset | 'custom';

export function Deals() {
  const [activePreset, setActivePreset] = useState<ActivePreset>('all');
  const [range, setRange] = useState<DateRange>({});
  const [hitType, setHitType] = useState('');
  const [outcome, setOutcome] = useState<DealOutcome | ''>('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ sortBy: string; sortOrder: 'asc' | 'desc' }>({
    sortBy: 'hitDate',
    sortOrder: 'desc',
  });

  const { data: dealsData, isLoading, isFetching } = useDeals({
    page,
    limit: PAGE_SIZE,
    hitType: hitType || undefined,
    outcome: outcome || undefined,
    startDate: range.startDate,
    endDate: range.endDate,
    sortBy: sort.sortBy,
    sortOrder: sort.sortOrder,
  });
  const { data: statsData } = useDealStats({ startDate: range.startDate, endDate: range.endDate });

  const deals = dealsData?.data || [];
  const stats = statsData?.data;
  const pagination = dealsData?.pagination;

  const hasActiveFilters = activePreset !== 'all' || !!hitType || !!outcome;

  const selectPreset = (preset: DateRangePreset) => {
    setActivePreset(preset);
    setRange(dateRangeForPreset(preset));
    setPage(1);
  };

  const setCustomRange = (key: 'startDate' | 'endDate', value: string) => {
    setActivePreset('custom');
    setRange((prev) => {
      const next = { ...prev };
      if (!value) {
        delete next[key];
      } else if (key === 'startDate') {
        next.startDate = new Date(`${value}T00:00:00`).toISOString();
      } else {
        next.endDate = new Date(`${value}T23:59:59.999`).toISOString();
      }
      return next;
    });
    setPage(1);
  };

  const resetFilters = () => {
    setActivePreset('all');
    setRange({});
    setHitType('');
    setOutcome('');
    setPage(1);
    setSort({ sortBy: 'hitDate', sortOrder: 'desc' });
  };

  const handleSortChange = (next: SortState | null) => {
    if (!next) {
      setSort({ sortBy: 'hitDate', sortOrder: 'desc' });
    } else {
      setSort({
        sortBy: SORT_FIELD_BY_COLUMN[next.columnId] || 'hitDate',
        sortOrder: next.direction,
      });
    }
    setPage(1);
  };

  const columns: ColumnDef<Deal>[] = useMemo(
    () => [
      {
        id: 'owner',
        header: 'Owner',
        enableFiltering: false,
        enableSorting: false,
        cell: (row) =>
          row.owner ? (
            <Link href={`/owners/${row.owner.id}`}>
              <span className="font-medium text-blue-600 hover:underline">
                {row.owner.ownerName}
              </span>
            </Link>
          ) : (
            <span className="text-gray-400">Unknown</span>
          ),
      },
      {
        id: 'property',
        header: 'Property',
        enableFiltering: false,
        enableSorting: false,
        cell: (row) => {
          if (!row.property) return <span className="text-gray-400">—</span>;
          const { county, state, apn } = row.property;
          const label = [county, state].filter(Boolean).join(', ') || apn || `#${row.property.id}`;
          return (
            <Link href={`/properties/${row.property.id}`}>
              <span className="inline-flex flex-col leading-tight">
                <span className="font-medium text-blue-600 hover:underline">{label}</span>
                {apn && <span className="text-[11px] text-gray-400">APN {apn}</span>}
              </span>
            </Link>
          );
        },
      },
      {
        id: 'hitType',
        header: 'Hit Type',
        enableFiltering: false,
        cell: (row) => {
          const Icon = HIT_TYPE_ICONS[row.hitType] || HelpCircle;
          return (
            <span className="inline-flex items-center gap-1.5 capitalize text-gray-700">
              <Icon className="w-3.5 h-3.5 text-gray-500" />
              {row.hitType}
            </span>
          );
        },
      },
      {
        id: 'hitDate',
        header: 'Hit Date',
        enableFiltering: false,
        cell: (row) => <span className="whitespace-nowrap text-gray-700">{formatDate(row.hitDate)}</span>,
      },
      {
        id: 'lead',
        header: 'Lead?',
        enableFiltering: false,
        align: 'center',
        cell: (row) =>
          row.isLead ? (
            <span className="inline-flex items-center justify-center text-amber-600" title="Lead">
              <Check className="w-4 h-4" />
            </span>
          ) : (
            <Minus className="w-4 h-4 text-gray-300 inline-block" />
          ),
      },
      {
        id: 'conversion',
        header: 'Conversion?',
        enableFiltering: false,
        align: 'center',
        cell: (row) =>
          row.isConversion ? (
            <Badge variant="success">Converted</Badge>
          ) : (
            <Minus className="w-4 h-4 text-gray-300 inline-block" />
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Leads & Deals</h2>
          <p className="text-gray-600 mt-1">Track campaign responses, inbound leads, and conversions</p>
        </div>
        {pagination && (
          <div className="text-sm text-gray-500">
            {pagination.total.toLocaleString()} matching records
          </div>
        )}
      </div>

      {/* Summary KPI Cards (reflect the selected timeframe) */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Total Responses</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalDeals.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.responseRate)} response rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Leads</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{stats.totalLeads.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.leadRate)} lead rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Conversions</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.totalConversions.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">{formatPercent(stats.conversionRate)} win rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-500 uppercase font-semibold">Mailings Sent</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalMailings.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total touchpoints</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            All Leads & Deals
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Filter toolbar */}
          <div className="space-y-3">
            {/* Month quick-filter chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1.5">
                <CalendarRange className="w-3.5 h-3.5" />
                Hit date
              </span>
              {DATE_RANGE_PRESETS.map((preset) => {
                const active = activePreset === preset.value;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => selectPreset(preset.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-700'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Secondary filters: hit type, outcome, custom date range */}
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Hit Type</label>
                <select
                  value={hitType}
                  onChange={(e) => {
                    setHitType(e.target.value);
                    setPage(1);
                  }}
                  className="text-sm px-2.5 py-1.5 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[9rem]"
                >
                  <option value="">All types</option>
                  {HIT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">Outcome</label>
                <select
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value as DealOutcome | '');
                    setPage(1);
                  }}
                  className="text-sm px-2.5 py-1.5 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[9rem]"
                >
                  <option value="">All outcomes</option>
                  {OUTCOME_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">From</label>
                <input
                  type="date"
                  value={toDateInputValue(range.startDate)}
                  onChange={(e) => setCustomRange('startDate', e.target.value)}
                  className="text-sm px-2.5 py-1.5 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase mb-1">To</label>
                <input
                  type="date"
                  value={toDateInputValue(range.endDate)}
                  onChange={(e) => setCustomRange('endDate', e.target.value)}
                  className="text-sm px-2.5 py-1.5 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-sm text-gray-500 hover:text-red-600 font-medium px-2 py-1.5 transition-colors"
                >
                  Clear filters
                </button>
              )}

              {isFetching && !isLoading && (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 ml-auto">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating…
                </span>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <DataTable
              data={deals}
              columns={columns}
              serverSide
              onSortChange={handleSortChange}
              pagination={{
                page,
                totalPages: pagination?.totalPages || 1,
                total: pagination?.total || 0,
                onPageChange: setPage,
              }}
              pageSize={PAGE_SIZE}
              emptyIcon={<TrendingUp className="w-12 h-12" />}
              emptyText="No leads or deals found"
              emptySubtext="Try a wider date range or clear your filters"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
