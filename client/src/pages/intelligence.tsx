import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { DataTable, ColumnDef } from '../components/ui/DataTable.tsx';
import { useCountyRanking, CountyRanking, CountyRankingMeta } from '../hooks/use-api.ts';
import {
  formatNumber,
  formatPercent,
  formatCurrency,
  formatDateISO,
  formatMonthsAgo,
  formatAcreRange,
} from '../lib/format.ts';
import {
  Brain,
  Loader2,
  Mail,
  Calendar,
  Target,
  Ban,
  Ruler,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

// Conversion-rate color tier, graded against the eligible-county median so the
// scale adapts to this dataset instead of hard-coded cutoffs. Zero responders
// read red, everything else green (>= median) or neutral (below).
function convClasses(row: CountyRanking, median: number): string {
  if (row.conversionRate <= 0) return 'bg-red-100 text-red-700';
  if (row.conversionRate >= median && median > 0) return 'bg-emerald-100 text-emerald-800';
  return 'bg-gray-100 text-gray-700';
}

// One-line rationale for a flagged county, so the investor sees *why*.
function remailReason(r: CountyRanking): string {
  const parts = ['above-median conversion'];
  if (r.monthsSinceLastMail !== null) parts.push(`rested ${r.monthsSinceLastMail} mo`);
  return parts.join(' · ');
}

function avoidReason(r: CountyRanking, meta: CountyRankingMeta): string {
  if (r.responses === 0) return `${formatNumber(r.mailed)} mailed · 0 responses`;
  if (r.badAddressRate >= meta.badAddressShareThreshold)
    return `${formatPercent(r.badAddressRate)} bad-address rate`;
  return 'saturated';
}

export function Intelligence() {
  const { data, isLoading } = useCountyRanking();
  const rows = data?.data ?? [];
  const meta = data?.meta;

  const median = meta?.medianConversionRate ?? 0;
  const remailCandidates = rows.filter((r) => r.remailCandidate);
  const avoidList = rows.filter((r) => r.avoid);

  const columns: ColumnDef<CountyRanking>[] = [
    {
      id: 'county',
      header: 'County',
      accessorFn: (row) => `${row.county}, ${row.state}`,
      filterType: 'text',
      cell: (row) => (
        <div className="flex items-center gap-2 min-w-[10rem]">
          <span className="font-medium text-gray-900">{row.county}</span>
          <Badge variant="secondary" className="font-mono text-[10px] font-semibold">
            {row.state}
          </Badge>
          {row.remailCandidate && (
            <span title="Re-mail candidate">
              <Target className="w-3.5 h-3.5 text-emerald-600" />
            </span>
          )}
          {row.avoid && (
            <span title="Avoid / saturated">
              <Ban className="w-3.5 h-3.5 text-red-500" />
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'mailed',
      header: 'Mailed',
      accessorKey: 'mailed',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <div className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900">
            <Mail className="w-3.5 h-3.5 text-gray-400" />
            {formatNumber(row.mailed)}
          </div>
          <div className="text-[11px] text-gray-400">{formatNumber(row.deliveredProxy)} deliverable</div>
        </div>
      ),
    },
    {
      id: 'lastMailed',
      header: 'Last Mailed',
      accessorFn: (row) => row.monthsSinceLastMail ?? -1,
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <div className="inline-flex items-center gap-1 text-sm text-gray-700">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatMonthsAgo(row.monthsSinceLastMail)}
          </div>
          <div className="text-[11px] text-gray-400">{formatDateISO(row.lastMailedDate)}</div>
        </div>
      ),
    },
    {
      id: 'responseRate',
      header: 'Response %',
      accessorKey: 'responseRate',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <span className="text-sm font-medium text-gray-900">{formatPercent(row.responseRate)}</span>
          <div className="text-[11px] text-gray-400">{formatNumber(row.responses)} hits</div>
        </div>
      ),
    },
    {
      id: 'leadRate',
      header: 'Lead %',
      accessorKey: 'leadRate',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <span className="text-sm text-gray-700">{formatPercent(row.leadRate)}</span>
          <div className="text-[11px] text-gray-400">{formatNumber(row.leads)} leads</div>
        </div>
      ),
    },
    {
      id: 'conversionRate',
      header: 'Conversion %',
      accessorKey: 'conversionRate',
      filterType: 'number',
      align: 'right',
      cell: (row) => (
        <div className="text-right">
          <span
            className={`inline-flex items-center justify-end px-2 py-0.5 rounded-full text-xs font-bold ${convClasses(
              row,
              median
            )}`}
          >
            {formatPercent(row.conversionRate)}
          </span>
          <div className="text-[11px] text-gray-400">{formatNumber(row.conversions)} deals</div>
        </div>
      ),
    },
    {
      id: 'avgAcres',
      header: 'Avg Acres',
      accessorFn: (row) => row.avgAcres ?? -1,
      filterType: 'number',
      align: 'right',
      cell: (row) =>
        row.avgAcres === null ? (
          <span className="text-xs text-gray-400">-</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-gray-700">
            <Ruler className="w-3.5 h-3.5 text-gray-400" />
            {formatAcreRange(row.avgAcres, row.avgAcres)}
          </span>
        ),
    },
    {
      id: 'totalOffersSum',
      header: 'Offers',
      accessorKey: 'totalOffersSum',
      filterType: 'number',
      align: 'right',
      cell: (row) =>
        row.totalOffersSum > 0 ? (
          <span className="inline-flex items-center gap-1 text-sm text-gray-700">
            <DollarSign className="w-3.5 h-3.5 text-gray-400" />
            {formatCurrency(row.totalOffersSum)}
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      id: 'flag',
      header: 'Flag',
      accessorFn: (row) => (row.remailCandidate ? 'remail' : row.avoid ? 'avoid' : 'none'),
      filterType: 'select',
      filterOptions: [
        { label: 'Re-mail candidate', value: 'remail' },
        { label: 'Avoid / saturated', value: 'avoid' },
        { label: 'None', value: 'none' },
      ],
      align: 'center',
      enableSorting: false,
      cell: (row) =>
        row.remailCandidate ? (
          <Badge variant="success">Re-mail</Badge>
        ) : row.avoid ? (
          <Badge variant="error">Avoid</Badge>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="w-6 h-6 text-blue-600" />
            County Intelligence
          </h2>
          <p className="text-gray-600 mt-1">
            Where the next mail dollar should go — counties ranked by conversion, with re-mail and
            saturation flags.
          </p>
        </div>
      </div>

      {/* Summary stat strip */}
      {meta && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Counties analyzed" value={formatNumber(meta.totalCounties)} icon={<TrendingUp className="w-4 h-4" />} tone="neutral" />
          <StatTile label="Re-mail candidates" value={formatNumber(meta.remailCount)} icon={<Target className="w-4 h-4" />} tone="emerald" />
          <StatTile label="Avoid / saturated" value={formatNumber(meta.avoidCount)} icon={<Ban className="w-4 h-4" />} tone="red" />
          <StatTile label="Median conversion" value={formatPercent(meta.medianConversionRate)} icon={<Sparkles className="w-4 h-4" />} tone="neutral" />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* Highlighted decision sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Re-mail Candidates */}
            <Card className="border-emerald-200">
              <CardHeader className="bg-emerald-50/60 rounded-t-xl border-emerald-100">
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <Target className="w-5 h-5 text-emerald-600" />
                  Re-mail Candidates
                  <span className="ml-auto text-sm font-normal text-emerald-700">
                    {remailCandidates.length} counties
                  </span>
                </CardTitle>
                <p className="text-xs text-emerald-700/80 mt-1">
                  Above-median conversion, rested {meta?.remailMinMonths ?? 3}+ months, ≥{' '}
                  {formatNumber(meta?.minMailed ?? 50)} mailed. Mail these next.
                </p>
              </CardHeader>
              <CardContent className="p-4">
                {remailCandidates.length === 0 ? (
                  <EmptyNote
                    icon={<Target className="w-8 h-8" />}
                    text="No re-mail candidates yet"
                    subtext="Needs above-median conversion, 3+ months rested, and enough volume. No county clears the bar on current data."
                  />
                ) : (
                  <div className="space-y-2">
                    {remailCandidates.map((r) => (
                      <HighlightRow
                        key={`${r.state}-${r.county}`}
                        row={r}
                        reason={remailReason(r)}
                        tone="emerald"
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Avoid / Saturated */}
            <Card className="border-red-200">
              <CardHeader className="bg-red-50/60 rounded-t-xl border-red-100">
                <CardTitle className="flex items-center gap-2 text-red-900">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Avoid / Saturated
                  <span className="ml-auto text-sm font-normal text-red-700">
                    {avoidList.length} counties
                  </span>
                </CardTitle>
                <p className="text-xs text-red-700/80 mt-1">
                  Spent ≥ {formatNumber(meta?.minMailed ?? 50)} mailings with no return, or a high
                  bad-address share. Hold off.
                </p>
              </CardHeader>
              <CardContent className="p-4">
                {avoidList.length === 0 ? (
                  <EmptyNote icon={<Ban className="w-8 h-8" />} text="No saturated counties" />
                ) : (
                  <div className="space-y-2">
                    {avoidList.map((r) => (
                      <HighlightRow
                        key={`${r.state}-${r.county}`}
                        row={r}
                        reason={meta ? avoidReason(r, meta) : ''}
                        tone="red"
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Full ranking table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-600" />
                County Performance Ranking
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <DataTable
                data={rows}
                columns={columns}
                storageKey="intelligence_ranking"
                pageSize={25}
                emptyIcon={<Brain className="w-12 h-12" />}
                emptyText="No county data"
                emptySubtext="Mail some properties to populate county intelligence"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'neutral' | 'emerald' | 'red';
}) {
  const toneClasses =
    tone === 'emerald'
      ? 'text-emerald-700 bg-emerald-50'
      : tone === 'red'
      ? 'text-red-600 bg-red-50'
      : 'text-blue-700 bg-blue-50';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${toneClasses}`}>{icon}</div>
        <div>
          <div className="text-xl font-bold text-gray-900 leading-tight">{value}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function HighlightRow({
  row,
  reason,
  tone,
}: {
  row: CountyRanking;
  reason: string;
  tone: 'emerald' | 'red';
}) {
  const rateClass = tone === 'emerald' ? 'text-emerald-700' : 'text-red-600';
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 hover:bg-gray-50 transition-colors">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 truncate">{row.county}</span>
          <Badge variant="secondary" className="font-mono text-[10px] font-semibold">
            {row.state}
          </Badge>
        </div>
        <div className="text-xs text-gray-500 truncate">{reason}</div>
      </div>
      <div className="flex items-center gap-4 shrink-0 text-right">
        <div>
          <div className={`text-sm font-bold ${rateClass}`}>{formatPercent(row.conversionRate)}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">conv</div>
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-700">{formatNumber(row.mailed)}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">mailed</div>
        </div>
      </div>
    </div>
  );
}

function EmptyNote({
  icon,
  text,
  subtext,
}: {
  icon: React.ReactNode;
  text: string;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
      <div className="mb-2 text-gray-300">{icon}</div>
      <p className="text-sm font-medium text-gray-500">{text}</p>
      {subtext && <p className="mt-1 text-xs text-gray-400 max-w-xs">{subtext}</p>}
    </div>
  );
}
