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
