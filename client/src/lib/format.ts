import { acreBandForValue } from '@shared/acre-bands';

export function formatNumber(num: number | string | undefined | null): string {
  if (num === undefined || num === null) return '-';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '-';
  return n.toLocaleString();
}

export function formatCurrency(num: number | string | undefined | null): string {
  if (num === undefined || num === null) return '-';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatPercent(num: number | string | undefined | null): string {
  if (num === undefined || num === null) return '0%';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Formats a date as an ISO calendar date (YYYY-MM-DD), using UTC so the
// stored canonical mail date doesn't shift across the viewer's timezone.
export function formatDateISO(date: string | Date | undefined | null): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

export function formatAcreage(acres: number | string | undefined | null): string {
  if (acres === undefined || acres === null) return '-';
  const a = typeof acres === 'string' ? parseFloat(acres) : acres;
  if (isNaN(a)) return '-';
  return `${a.toFixed(2)} ac`;
}

// Formats an acreage span as a human-friendly range, e.g. "1-20 acres".
// Collapses to a single value when min === max ("5 acres") and drops
// unnecessary decimals. Returns "-" when no acreage is known.
export function formatAcreRange(
  min: number | string | undefined | null,
  max: number | string | undefined | null,
): string {
  const lo = min === undefined || min === null ? NaN : typeof min === 'string' ? parseFloat(min) : min;
  const hi = max === undefined || max === null ? NaN : typeof max === 'string' ? parseFloat(max) : max;
  const loValid = !isNaN(lo);
  const hiValid = !isNaN(hi);
  if (!loValid && !hiValid) return '-';
  const fmt = (n: number) => Number(n.toFixed(2)).toLocaleString();
  const low = loValid ? lo : hi;
  const high = hiValid ? hi : lo;
  if (low === high) return `${fmt(low)} acres`;
  return `${fmt(low)}-${fmt(high)} acres`;
}

// The acre-band label (e.g. "5–20 ac") a parcel falls into, or null when the
// acreage is unknown. Delegates to the shared band definitions so the badge,
// the filter dropdown, and the server filter all agree.
export function formatAcreBand(acres: number | string | undefined | null): string | null {
  return acreBandForValue(acres)?.label ?? null;
}

export function truncate(str: string | undefined | null, maxLen = 50): string {
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}


// ─── Date range presets ──────────────────────────────────────
export type DateRangePreset =
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'this_year'
  | 'all';

export const DATE_RANGE_PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];

export interface DateRange {
  startDate?: string;
  endDate?: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function dateRangeForPreset(preset: DateRangePreset, now = new Date()): DateRange {
  const end = endOfDay(now);
  switch (preset) {
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastEnd = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { startDate: start.toISOString(), endDate: lastEnd.toISOString() };
    }
    case 'last_3_months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      return { startDate: startOfDay(start).toISOString(), endDate: end.toISOString() };
    }
    case 'last_6_months': {
      const start = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return { startDate: startOfDay(start).toISOString(), endDate: end.toISOString() };
    }
    case 'this_year': {
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: start.toISOString(), endDate: end.toISOString() };
    }
    case 'all':
    default:
      return {};
  }
}

export function toDateInputValue(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatMonthsAgo(months: number | undefined | null): string {
  if (months === undefined || months === null) return 'Never';
  if (months <= 0) return 'This month';
  return `${months} mo ago`;
}

export function formatDateUTC(date: string | Date | undefined | null): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

