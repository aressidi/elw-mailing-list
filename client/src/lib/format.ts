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

export function formatAcreage(acres: number | string | undefined | null): string {
  if (acres === undefined || acres === null) return '-';
  const a = typeof acres === 'string' ? parseFloat(acres) : acres;
  if (isNaN(a)) return '-';
  return `${a.toFixed(2)} ac`;
}

export function truncate(str: string | undefined | null, maxLen = 50): string {
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}
