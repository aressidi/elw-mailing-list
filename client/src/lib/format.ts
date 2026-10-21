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

export function truncate(str: string | undefined | null, maxLen = 50): string {
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}
