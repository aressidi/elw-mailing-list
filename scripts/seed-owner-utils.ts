// Shared helpers for recognizing and cleaning up seed/test-data "owners" that
// occasionally appear as placeholder rows in the Consolidated Master Google
// Sheet (used to validate the mail-merge pipeline before a county's real
// data lands, e.g. rows attributed to 'Alex Ressi' or 'Rocket Print'). These
// must never be treated as real property owners during import.

import { and, eq } from 'drizzle-orm';
import { deals, mailings, mailingSuppression, propertyOwners } from '../shared/schema';

const SEED_OWNER_PATTERNS: RegExp[] = [
  /^alex\s+ressi$/i,
  /^rocket\s+print(\s+(and\s+)?mail)?$/i,
];

export function isSeedOwner(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name.toString().trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  return SEED_OWNER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Purges every link between a seed owner and one specific property
 * (property_owners, mailings, mailing_suppression, deals) without touching
 * the seed owner row itself or its links to any other property. Used during
 * import when a real-owner row for an APN is discovered after a seed-owner
 * row already claimed that property — the seed row's "mailing" never really
 * happened, so it's removed rather than re-pointed, and the real row's own
 * processing creates the correct records in its place.
 */
export async function deleteSeedOwnerLinksForProperty(
  db: any,
  propertyId: number,
  seedOwnerId: number,
): Promise<{ mailingsRemoved: number; suppressionsRemoved: number; dealsRemoved: number }> {
  const removedMailings = await db.delete(mailings)
    .where(and(eq(mailings.propertyId, propertyId), eq(mailings.ownerId, seedOwnerId)))
    .returning({ id: mailings.id });
  const removedSuppressions = await db.delete(mailingSuppression)
    .where(and(eq(mailingSuppression.propertyId, propertyId), eq(mailingSuppression.ownerId, seedOwnerId)))
    .returning({ id: mailingSuppression.id });
  const removedDeals = await db.delete(deals)
    .where(and(eq(deals.propertyId, propertyId), eq(deals.ownerId, seedOwnerId)))
    .returning({ id: deals.id });
  await db.delete(propertyOwners)
    .where(and(eq(propertyOwners.propertyId, propertyId), eq(propertyOwners.ownerId, seedOwnerId)));

  return {
    mailingsRemoved: removedMailings.length,
    suppressionsRemoved: removedSuppressions.length,
    dealsRemoved: removedDeals.length,
  };
}
