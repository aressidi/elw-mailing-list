// Canonical acre-band definitions, shared by the server (to translate an
// `acreBand` filter into an acres range) and the client (to render the band
// badge on each parcel and populate the band filter dropdown). Bands are
// half-open [min, max): a parcel of exactly 5 acres falls in "5-20", not
// "1-5". The final band ("100+") has no upper bound (max = null).

export interface AcreBand {
  value: string;
  label: string;
  min: number;
  max: number | null;
}

export const ACRE_BANDS: AcreBand[] = [
  { value: '0-1', label: '0–1 ac', min: 0, max: 1 },
  { value: '1-5', label: '1–5 ac', min: 1, max: 5 },
  { value: '5-20', label: '5–20 ac', min: 5, max: 20 },
  { value: '20-50', label: '20–50 ac', min: 20, max: 50 },
  { value: '50-100', label: '50–100 ac', min: 50, max: 100 },
  { value: '100+', label: '100+ ac', min: 100, max: null },
];

// The band a given acreage falls into, or null when the acreage is unknown
// or non-numeric.
export function acreBandForValue(acres: number | string | null | undefined): AcreBand | null {
  if (acres === null || acres === undefined) return null;
  const a = typeof acres === 'string' ? parseFloat(acres) : acres;
  if (isNaN(a)) return null;
  for (const band of ACRE_BANDS) {
    if (a >= band.min && (band.max === null || a < band.max)) return band;
  }
  return null;
}

// Look up a band by its `value` (the filter token), or undefined if unknown.
export function acreBandByValue(value: string): AcreBand | undefined {
  return ACRE_BANDS.find((b) => b.value === value);
}
