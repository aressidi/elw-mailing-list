// Shared normalization helpers for campaign names/links coming from the
// Consolidated Master Google Sheet. Column F ("Sheet Name") and column G
// ("Sheet Link") contain a per-row auto-incremented counter/suffix (e.g.
// " 12/30/800", " - 020976", " 2099", ", 2122") and a per-row `#gid=...`
// link fragment. Verbatim matching on these columns previously produced
// ~1 campaign per mailing/owner instead of the true ~15-20 campaigns.

export const UNASSIGNED_CAMPAIGN_NAME = 'Unassigned / No Sheet';

/**
 * Strips the per-row auto-incremented suffix off a raw sheet-name value so
 * that every row belonging to the same real-world campaign collapses to one
 * canonical name.
 */
export function normalizeCampaignName(rawName: string | null | undefined): string {
  let name = (rawName ?? '').toString().trim();
  if (!name) return UNASSIGNED_CAMPAIGN_NAME;

  name = name.replace(/\s+/g, ' ').trim();

  // "MM/DD/NNN"-style incrementing counter, e.g. " 12/30/800"
  name = name.replace(/\s+\d{1,2}\/\d{1,2}\/\d+\s*$/, '');

  // Trailing incrementing numeric suffix, e.g. " - 020976", " 2099", ", 2122"
  name = name.replace(/[\s,-]+\d{3,7}\s*$/, '');

  // Drop any separator characters left dangling at the end after stripping
  name = name.replace(/[\s,\-–—]+$/, '').trim();

  return name || UNASSIGNED_CAMPAIGN_NAME;
}

/**
 * Canonicalizes a Google Sheets link. The doc id and the `?gid=` query
 * param are stable per source tab, but the `#gid=` hash fragment increments
 * per row in the source data. Rebuild the link from the query-string gid so
 * every row of the same campaign produces an identical link.
 */
export function cleanSheetLink(rawLink: string | null | undefined): string | null {
  if (!rawLink) return null;
  const trimmed = rawLink.toString().trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/edit)(?:\?gid=(\d+))?/);
  if (match) {
    const [, base, gid] = match;
    return gid ? `${base}?gid=${gid}#gid=${gid}` : base;
  }
  return trimmed;
}
