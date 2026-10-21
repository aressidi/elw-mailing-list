import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ChevronDown,
  ChevronRight,
  Calendar,
  Send,
  Loader2,
  MapPin,
  Inbox,
} from 'lucide-react';
import { Card } from './ui/Card.tsx';
import { Badge } from './ui/Badge.tsx';
import { useMailingsByMonthDetail, MonthDetail, MonthDetailCampaign } from '../hooks/use-api.ts';
import { formatNumber, formatDateUTC } from '../lib/format.ts';

// Horizontal volume bars for a {key: count} breakdown, sorted high → low and
// scaled to the largest value so a month's dominant state/county reads at a
// glance. Used for both the per-state and per-county drill-downs.
function VolumeBars({
  data,
  barClass,
  labelClass = 'text-gray-700',
}: {
  data: Record<string, number>;
  barClass: string;
  labelClass?: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2 text-sm">
          <span className={`w-24 sm:w-28 shrink-0 truncate ${labelClass}`} title={key}>
            {key}
          </span>
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${barClass}`}
              style={{ width: `${Math.max((value / max) * 100, 4)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right tabular-nums font-medium text-gray-900">
            {formatNumber(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: MonthDetailCampaign }) {
  const [open, setOpen] = useState(false);
  const stateCount = campaign.states.length;
  const countyCount = campaign.counties.length;

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 sm:px-6 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors"
      >
        <span className="mt-0.5 text-gray-400 shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {/* WHEN — the hero */}
        <div className="shrink-0 w-28 sm:w-32">
          <div className="flex items-center gap-1.5 text-gray-900 font-semibold">
            <Calendar className="w-4 h-4 text-blue-600 shrink-0" />
            {formatDateUTC(campaign.firstMailDate)}
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5" title={campaign.name}>
            {campaign.name}
          </p>
        </div>

        {/* WHERE — states + counties */}
        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
          {campaign.states.slice(0, 4).map((s) => (
            <Badge key={s} variant="info">{s}</Badge>
          ))}
          {stateCount > 4 && <Badge variant="secondary">+{stateCount - 4}</Badge>}
          {countyCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <MapPin className="w-3.5 h-3.5" />
              {campaign.counties.slice(0, 3).join(', ')}
              {countyCount > 3 && ` +${countyCount - 3}`}
            </span>
          )}
        </div>

        {/* HOW MUCH */}
        <div className="shrink-0 text-right">
          <div className="text-base font-bold text-gray-900 tabular-nums">
            {formatNumber(campaign.volume)}
          </div>
          <div className="text-xs text-gray-400">mailings</div>
        </div>
      </button>

      {open && (
        <div className="px-4 sm:px-6 pb-4 pt-1 bg-gray-50/60">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Volume by State
              </h4>
              <VolumeBars data={campaign.volumeByState} barClass="bg-blue-500" />
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Volume by County
              </h4>
              <VolumeBars data={campaign.volumeByCounty} barClass="bg-emerald-500" />
            </div>
          </div>
          <div className="mt-3 text-right">
            <Link
              href={`/campaigns/${campaign.campaignId}`}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              View campaign detail →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthCard({ month, defaultOpen }: { month: MonthDetail; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 sm:px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        <span className="text-gray-400 shrink-0">
          {open ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900">{month.monthLabel}</h3>
          <p className="text-sm text-gray-500">
            {formatNumber(month.campaignCount)} {month.campaignCount === 1 ? 'campaign' : 'campaigns'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5">
          <Send className="w-4 h-4 text-blue-600" />
          <span className="text-lg font-bold text-blue-700 tabular-nums">
            {formatNumber(month.totalVolume)}
          </span>
          <span className="text-xs text-blue-600/70 hidden sm:inline">mailed</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-200">
          {month.campaigns.map((c) => (
            <CampaignRow key={c.campaignId} campaign={c} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function MailingsByMonth() {
  const { data, isLoading, isError } = useMailingsByMonthDetail();
  const months = useMemo(() => data?.data ?? [], [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p>Failed to load mailings by month.</p>
      </div>
    );
  }

  if (months.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <Inbox className="w-12 h-12 mx-auto text-gray-300 mb-3" />
        <p>No mailings found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {months.map((m, i) => (
        <MonthCard key={m.month} month={m} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
