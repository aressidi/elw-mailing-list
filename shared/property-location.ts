// An APN identifies a parcel only within its county: different counties
// (and states) reuse the same APN strings, e.g. "001-09955-000" is one parcel
// in Washington County AR and another in Johnson County AR. Properties are
// therefore unique on apn + state + county, not on apn alone.
//
// County is free text in every source ("Benton", "Benton County", "BENTON"),
// so it is compared through normalizeCounty. The unique index
// properties_apn_location_idx (shared/schema.ts) uses the same normalization
// in SQL - keep the two in step.

export interface PropertyLocation {
  state: string | null | undefined;
  county: string | null | undefined;
}

export function normalizeCounty(county: string | null | undefined): string {
  return (county ?? '').toUpperCase().replace(/\s+COUNTY$/, '').replace(/[^A-Z]/g, '');
}

// Words kept lower-case inside a county name ("Fond du Lac", "Isle of Wight").
const COUNTY_SMALL_WORDS = new Set(['of', 'the', 'and', 'du', 'qui']);

// Names whose inner capital cannot be derived from an all-caps source.
const COUNTY_INNER_CAPS: Record<string, string> = {
  dekalb: 'DeKalb', desoto: 'DeSoto', dewitt: 'DeWitt', dupage: 'DuPage',
  lagrange: 'LaGrange', lamoure: 'LaMoure', laporte: 'LaPorte', lasalle: 'LaSalle',
};

function titleCaseCountyPart(part: string): string {
  const lower = part.toLowerCase();
  if (COUNTY_INNER_CAPS[lower]) return COUNTY_INNER_CAPS[lower];
  return lower
    .replace(/^\p{L}/u, (ch) => ch.toUpperCase())
    // McDonald, McKean - but not a bare "Mc".
    .replace(/^Mc(\p{L})(?=\p{L})/u, (_, ch: string) => `Mc${ch.toUpperCase()}`)
    // O'Brien - but not the possessive in "Prince George's".
    .replace(/^(\p{L}')(\p{L})(?=\p{L})/u, (_, prefix: string, ch: string) => prefix + ch.toUpperCase());
}

// The value stored in properties.county and shown in reports: Title Case with
// the trailing "County" word removed, so "Benton", "Benton County" and
// "BENTON COUNTY" are all stored as "Benton". Idempotent. Returns null for a
// blank value.
//
// This is the display-level counterpart of normalizeCounty above (the
// comparison key behind properties_apn_location_idx) and strips the suffix by
// the same rule - "County" only as a trailing word after whitespace - so
// canonicalizing a stored value leaves its normalizeCounty key, and therefore
// the unique index, unchanged. Two inputs normalizeCounty does not treat as a
// suffix are cleaned up here and DO change the key: trailing whitespace
// ("Benton County ") and a repeated suffix ("Benton County County").
// scripts/backfill-normalize-county.ts reports those instead of assuming.
export function canonicalCounty(county: string | null | undefined): string | null {
  let name = (county ?? '').trim().replace(/\s+/g, ' ');
  // Looped so the result is a fixed point: stripping once would leave
  // "Benton County County" one more step away from "Benton".
  while (/\sCOUNTY$/i.test(name)) name = name.replace(/\sCOUNTY$/i, '');
  if (!name) return null;
  return name
    .split(' ')
    .map((word, i) => (i > 0 && COUNTY_SMALL_WORDS.has(word.toLowerCase())
      ? word.toLowerCase()
      : word.split('-').map(titleCaseCountyPart).join('-')))
    .join(' ');
}

// True when two rows that share an APN are in different places, i.e. are
// different parcels. A blank state or county is compatible with anything. A
// prefix match counts as the same county because sources write e.g.
// "Bentonville" for Benton - the unique index cannot see that, so callers
// should match with this before inserting.
export function isDifferentLocation(a: PropertyLocation, b: PropertyLocation): boolean {
  if (a.state && b.state && a.state.toUpperCase() !== b.state.toUpperCase()) return true;
  const ca = normalizeCounty(a.county);
  const cb = normalizeCounty(b.county);
  if (!ca || !cb) return false;
  return !(ca.startsWith(cb) || cb.startsWith(ca));
}

// Picks the property a row with this APN + location belongs to, out of every
// property that has the APN. `ambiguous` is set when the row gives no usable
// location and the APN exists in more than one place.
export function matchPropertyByLocation<T extends PropertyLocation>(candidates: T[], location: PropertyLocation): { match: T | null; ambiguous: boolean } {
  const compatible = candidates.filter((c) => !isDifferentLocation(c, location));
  if (compatible.length === 0) return { match: null, ambiguous: false };
  const exact = compatible.find((c) => (c.state ?? '').toUpperCase() === (location.state ?? '').toUpperCase() && normalizeCounty(c.county) === normalizeCounty(location.county));
  return { match: exact ?? compatible[0], ambiguous: !exact && compatible.length > 1 };
}
