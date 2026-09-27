import { describe, expect, it } from 'vitest';
import {
  formatNumber, formatCurrency, formatPercent, formatDate, formatAcreage, truncate,
} from '../../client/src/lib/format.ts';
import { cn } from '../../client/src/lib/utils.ts';

describe('formatNumber', () => {
  it('adds thousands separators to numbers and numeric strings', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber('2500')).toBe('2,500');
    expect(formatNumber(0)).toBe('0');
  });

  it('shows a dash for missing or non-numeric values', () => {
    expect(formatNumber(null)).toBe('-');
    expect(formatNumber(undefined)).toBe('-');
    expect(formatNumber('abc')).toBe('-');
  });
});

describe('formatCurrency', () => {
  it('formats whole US dollars', () => {
    expect(formatCurrency(12500)).toBe('$12,500');
    expect(formatCurrency('4200.00')).toBe('$4,200');
    expect(formatCurrency(0)).toBe('$0');
  });

  it('rounds cents to the nearest dollar', () => {
    expect(formatCurrency(99.5)).toBe('$100');
    expect(formatCurrency('1234.49')).toBe('$1,234');
  });

  it('shows a dash for missing or non-numeric values (never "$0")', () => {
    expect(formatCurrency(null)).toBe('-');
    expect(formatCurrency(undefined)).toBe('-');
    expect(formatCurrency('n/a')).toBe('-');
  });
});

describe('formatPercent', () => {
  it('shows one decimal place', () => {
    expect(formatPercent('16.67')).toBe('16.7%');
    expect(formatPercent(50)).toBe('50.0%');
  });

  it('shows 0% for missing values', () => {
    expect(formatPercent(null)).toBe('0%');
    expect(formatPercent(undefined)).toBe('0%');
    expect(formatPercent('bad')).toBe('0%');
  });
});

describe('formatDate', () => {
  it('formats as a short US date', () => {
    expect(formatDate(new Date(2026, 8, 5))).toBe('Sep 5, 2026');
    expect(formatDate('2026-03-15T12:00:00')).toBe('Mar 15, 2026');
  });

  it('shows a dash for missing or unparseable dates', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate('')).toBe('-');
    expect(formatDate('not a date')).toBe('-');
  });
});

describe('formatAcreage', () => {
  it('shows two decimals and an "ac" unit', () => {
    expect(formatAcreage('5.0000')).toBe('5.00 ac');
    expect(formatAcreage(0.256)).toBe('0.26 ac');
  });

  it('shows a dash for missing values', () => {
    expect(formatAcreage(null)).toBe('-');
    expect(formatAcreage('x')).toBe('-');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly10!', 10)).toBe('exactly10!');
  });

  it('cuts long strings and appends an ellipsis', () => {
    expect(truncate('abcdefghijk', 5)).toBe('abcde...');
  });

  it('shows a dash for empty values', () => {
    expect(truncate('')).toBe('-');
    expect(truncate(null)).toBe('-');
  });
});

describe('cn', () => {
  it('joins class names and lets later Tailwind classes win conflicts', () => {
    expect(cn('p-2', false && 'hidden', 'text-sm')).toBe('p-2 text-sm');
    expect(cn('p-2', 'p-6')).toBe('p-6');
  });
});
