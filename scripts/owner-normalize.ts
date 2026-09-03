// Shared normalization helpers for owner identity resolution.
//
// Root cause of the "Robert Lee" duplicate (owner ids split across variant
// spellings like "Robert Lee, Jr." / "ROBERT LEE"): the importer and search
// tools compared owner_name with plain `lower()` equality, so any suffix,
// punctuation, or casing difference minted a parallel owner row.
//
// This same logic is duplicated (not imported) in the Python skill scripts
// under elw-rocketmail-importer, elw-property-search, and elw-property-intake,
// since those live outside this repo and can't share a module. Keep the
// rules in sync if you change them here.

const GENERATIONAL_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

/**
 * Normalizes an owner_name (or full name) for duplicate detection:
 * lower-case, strip punctuation/separators, drop a trailing generational
 * suffix (Jr, Sr, II, III, IV), collapse internal whitespace.
 */
export function normalizeOwnerName(rawName: string | null | undefined): string {
  let name = (rawName ?? '').toString().trim().toLowerCase();
  if (!name) return '';

  // Punctuation/separators (commas, periods, ampersands-as-connector noise)
  // collapse to spaces so "Lee, Robert" and "Lee Robert" compare the same
  // way as far as tokens go, and "Robert Lee, Jr." loses its comma before
  // the suffix check below.
  name = name.replace(/[.,]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();

  // Strip a single trailing generational suffix token (repeat in case of
  // stray double punctuation leaving two suffix-shaped tokens).
  const suffixPattern = new RegExp(`\\s+(${GENERATIONAL_SUFFIXES.join('|')})$`);
  let stripped = name.replace(suffixPattern, '');
  while (stripped !== name) {
    name = stripped;
    stripped = name.replace(suffixPattern, '');
  }

  return name.trim();
}

/**
 * Normalizes an APN for cross-format matching: strip whitespace and the
 * common separator characters (-.:/) and uppercase. Matches the normalization
 * already used by find_in_neon.py / search_property.py / add_property_merged.py.
 */
export function normalizeApn(rawApn: string | null | undefined): string {
  const apn = (rawApn ?? '').toString().trim().toUpperCase();
  return apn.replace(/[\s\-.:/]/g, '');
}
