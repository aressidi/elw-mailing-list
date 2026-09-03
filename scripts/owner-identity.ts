// Owner identity resolution rule (authoritative, set 2026-09-03):
//
//   Reuse an existing owner row ONLY when ALL THREE match:
//     1. owner_name exact match (case-insensitive is fine, but NO
//        suffix-stripping that erases a Jr/Sr/II/III/IV identity
//        distinction -- those are different people).
//     2. mailing address zip matches.
//     3. full mailing address (address_line1/line2/city/state/zip)
//        matches 100%.
//
// If the name matches but the zip doesn't -> new owner. If name+zip match
// but the rest of the address doesn't -> new owner. Only when name+zip+full
// address all match does a row reuse the existing owner.
//
// Root cause this replaces: the importer previously matched existing owners
// by `lower(owner_name).trim()` alone, so the same name recurring across
// unrelated campaigns (different people, different addresses) collapsed
// into one owner row -- e.g. "Robert Lee" ended up as a single owner for
// three unrelated properties (Henry GA / Milam TX / Windham CT) each with
// their own mailing address and campaign. A deep-dive found zero owners in
// the real data ever legitimately mailed 2+ properties to the same mailing
// address, so a repeated name at a different address is almost always a
// different person.
//
// NOTE: this is deliberately NOT the same normalization used by
// scripts/owner-normalize.ts / scripts/merge-duplicate-owners.ts, which
// strips generational suffixes to catch spelling variants of the SAME
// person at the SAME address. That tool's "same normalized name" merge
// signal (used with no address corroboration) can re-merge owners that this
// rule intentionally split apart by address -- do not run it against a
// database that just had an identity-rule reconcile applied without also
// checking its plan output for cross-address collisions.

export interface OwnerIdentityAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

/**
 * Normalizes an owner_name for exact-match identity comparison: lower-case,
 * collapse internal whitespace, trim stray leading/trailing punctuation.
 * Does NOT strip generational suffixes (Jr/Sr/II/III/IV) -- those are part
 * of the person's identity under this rule.
 */
export function normalizeIdentityName(name: string | null | undefined): string {
  let n = (name ?? '').toString().trim().toLowerCase();
  if (!n) return '';
  n = n.replace(/\s+/g, ' ');
  n = n.replace(/^[.,\s]+|[.,\s]+$/g, '');
  return n;
}

/** Normalizes one address component for exact-match comparison. */
export function normalizeAddressPart(part: string | null | undefined): string {
  return (part ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds the composite identity key (name + zip + full address) used to
 * decide owner reuse. Two rows produce the same key only when the name and
 * every address component match exactly (after light case/whitespace
 * normalization) -- i.e. all three rule conditions are satisfied at once.
 */
export function ownerIdentityKey(ownerName: string, addr: OwnerIdentityAddress): string {
  const name = normalizeIdentityName(ownerName);
  const zip = normalizeAddressPart(addr.zip);
  const line1 = normalizeAddressPart(addr.line1);
  const line2 = normalizeAddressPart(addr.line2);
  const city = normalizeAddressPart(addr.city);
  const state = normalizeAddressPart(addr.state);
  return [name, zip, line1, line2, city, state].join('|');
}
