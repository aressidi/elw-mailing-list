// Acreage bands for targeting analytics.
//
// A parcel's size is one of the strongest predictors of whether a mail piece
// converts, so mailings and their outcomes are bucketed by properties.acres.
// Bands are half-open intervals [min, max): a parcel of exactly 5 acres lands
// in "5-20", not "1-5". The boundaries live here so the server's SQL CASE
// (acreBandCaseSql) and the client's labels can never drift apart - change a
// boundary once and both sides follow.

export interface AcreBand {
  key: string; // stable identifier, also the value stored in API rows
  label: string; // display label for charts/tables
  min: number; // inclusive lower bound, in acres
  max: number | null; // exclusive upper bound; null = unbounded (top band)
}

// The band assigned when a parcel has no usable acreage.
export const UNKNOWN_ACRE_BAND = 'unknown';

// Ordered smallest-to-largest. The last band must be the unbounded one.
export const ACRE_BANDS: AcreBand[] = [
  { key: '0-1', label: '0–1 ac', min: 0, max: 1 },
  { key: '1-5', label: '1–5 ac', min: 1, max: 5 },
  { key: '5-20', label: '5–20 ac', min: 5, max: 20 },
  { key: '20-50', label: '20–50 ac', min: 20, max: 50 },
  { key: '50-100', label: '50–100 ac', min: 50, max: 100 },
  { key: '100+', label: '100+ ac', min: 100, max: null },
];

// Every band key in display order, with "unknown" last. Callers use this to
// render a full, stable axis even for bands with zero mailings.
export const ACRE_BAND_KEYS: string[] = [...ACRE_BANDS.map((b) => b.key), UNKNOWN_ACRE_BAND];

// Bucket a parcel's acreage into a band key. A null, blank, non-finite or
// negative value (no usable size) is "unknown".
export function acreBand(acres: number | string | null | undefined): string {
  const n = typeof acres === 'string' ? Number(acres) : acres;
  if (n == null || !Number.isFinite(n) || n < 0) return UNKNOWN_ACRE_BAND;
  for (const band of ACRE_BANDS) {
    if (n >= band.min && (band.max == null || n < band.max)) return band.key;
  }
  return UNKNOWN_ACRE_BAND;
}

// Display label for a band key (falls back to the key itself).
export function acreBandLabel(key: string): string {
  if (key === UNKNOWN_ACRE_BAND) return 'Unknown';
  return ACRE_BANDS.find((b) => b.key === key)?.label ?? key;
}

// Builds the SQL CASE expression that buckets `acresExpr` into the same band
// keys as acreBand(), straight from ACRE_BANDS so SQL and JS stay in step.
// `acresExpr` MUST be trusted SQL (a column reference such as "p.acres"),
// never user input - it is interpolated verbatim, as are the band bounds,
// which are numeric constants from the array above.
export function acreBandCaseSql(acresExpr: string): string {
  const whens = ACRE_BANDS.filter((b) => b.max != null)
    .map((b) => `WHEN ${acresExpr} < ${b.max} THEN '${b.key}'`)
    .join('\n    ');
  const topBand = ACRE_BANDS[ACRE_BANDS.length - 1];
  return `CASE
    WHEN ${acresExpr} IS NULL OR ${acresExpr} < 0 THEN '${UNKNOWN_ACRE_BAND}'
    ${whens}
    ELSE '${topBand.key}'
  END`;
}
