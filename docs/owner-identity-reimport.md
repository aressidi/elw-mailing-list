# Owner identity fix: name + zip + full address

## The rule (authoritative, set 2026-09-03)

Reuse an existing owner row **only** when all three match exactly:

1. `owner_name` (exact match; no generational-suffix stripping -- "Robert Lee"
   and "Robert Lee, Jr." are different people under this rule)
2. mailing zip
3. full mailing address (`address_line1` / `address_line2` / `city` /
   `state` / `zip`), 100%

Any divergence in any of those means a **new** owner row. A repeated name at
a different address is a different person -- e.g. "Robert Lee" mailed on
three unrelated campaigns/properties/addresses is three owners, not one.

This replaces the previous behavior (name-only matching, in one importer with
generational-suffix stripping and an APN-led fallback in the other) that
collapsed unrelated people into a single owner row whenever a name recurred.

See `scripts/owner-identity.ts` for the canonical implementation
(`normalizeIdentityName`, `normalizeAddressPart`, `ownerIdentityKey`).

## What changed

| File | Change |
|---|---|
| `scripts/owner-identity.ts` | New: shared identity-key helper (name+zip+full address) |
| `scripts/import-master-data-fixed.ts` | Owner dedup now uses the identity key instead of name-only matching |
| `~/.openclaw/workspace-orange/skills/elw-rocketmail-importer/scripts/import_rocketmail.py` | Same fix, ported to Python (`normalize_identity_name`, `owner_identity_key`); removed the old generational-suffix stripping and the APN-led "reuse whichever owner already claimed this property" fallback, both of which violated the rule. This file lives outside this repo (no git there) -- noted here for the record. |
| `scripts/prod-owner-identity-reconcile.ts` | New: additive reconcile that splits owners the old logic wrongly merged, and re-points `property_owners` / `mailings` / `deals` / `mailing_suppression` to the correct split owner. Never deletes a row. |
| `scripts/prod-backup-restore.ts` | New: JSON-based backup/restore for the 6 tables the reconcile touches (`owners`, `mailing_addresses`, `property_owners`, `mailings`, `deals`, `mailing_suppression`). Used instead of `pg_dump` because local `pg_dump` is v15 and Neon prod runs Postgres 18, which `pg_dump` refuses to talk to. |
| `.gitignore` | Added `backups/` |

## Local proof (fresh re-import from the master sheet)

DB: `postgresql://localhost:5432/elw_mailing_list` (dropped, recreated,
migrated, then re-imported from scratch).

```
dropdb elw_mailing_list && createdb elw_mailing_list
npm run db:migrate
npx tsx scripts/import-master-data-fixed.ts
```

Sheet: Google Sheet `1SrqwoqPlxmceae5y7DylTvUkVOXjyb58dsjDY3KQ7zA`, tab
"Master" (11,950 rows incl. header, 11,431 unique APNs).

**Before** (prior local DB, built with the old name-only importer):

| metric | value |
|---|---|
| owners | 11,148 |
| properties | 11,435 |
| mailing_addresses | 11,432 |
| mailings | 11,433 |
| property_owners | 11,431 |
| owners mailing 2+ properties to the same address | 547 |
| "Robert Lee" owners | 1 (covering 2 unrelated properties/addresses: Henry Co. GA, Milam Co. TX) |

**After** (fresh re-import with the fixed importer):

| metric | value |
|---|---|
| owners | 11,432 |
| properties | 11,431 |
| mailing_addresses | 11,432 |
| mailings | 11,431 |
| property_owners | 11,431 |
| owners mailing 2+ properties to the same address | 1 (legitimate: same person, same PO Box, 2 properties -- correctly *not* split, since name+zip+address all match) |
| "Robert Lee" owners | 2, one per property/address (Henry Co. GA / Milam Co. TX). A third Robert Lee property (Windham Co. CT) exists in prod via the separate Rocketmail import, not in the current "Master" sheet tab, so it doesn't appear in this local re-import. |

Import summary line from the run: `Owners created: 11432, Owners reused
(name+zip+address matched): 4, Owners created despite name match (address
mismatch): 288`. (The importer's own progress log shows higher cumulative
op-counts for `properties`/`property_owners` -- 11,436 -- because it counts
every row processed, including sheet rows that reprocess the same APN via
`onConflictDoUpdate`/`onConflictDoNothing`; the table above is the actual
row counts verified directly against the database.)

## Prod reconcile (Neon)

DB: `.env.production` `DATABASE_URL` (Neon, Postgres 18).

### 1. Backup

```
npx tsx scripts/prod-backup-restore.ts backup --env-file .env.production \
  --out backups/prod-owner-reconcile-pre-20260903.json
```

Backed up (row counts at backup time): `owners` 12,547, `property_owners`
12,887, `mailings` 12,932, `mailing_addresses` 12,931, `deals` 30,
`mailing_suppression` 23. File kept locally under `backups/` (gitignored,
~11 MB) -- not committed.

The restore path (`... restore --in <file> --apply`) was dry-run tested
end-to-end against a scratch local DB seeded with a copy of prod's
`properties` / `campaigns` / `data_sources` before being trusted; that test
caught and fixed two bugs (wrong table insert order relative to FKs, and a
`property_owners`-has-no-`id`-column bug in the sequence-reset step that was
silently poisoning the transaction so `COMMIT` was a silent no-op). Restored
counts matched the backup exactly after the fix.

### 2. Read-only analysis (before touching anything)

290 owners in prod had 2+ distinct mailing addresses (the over-merge bug).
Of the 627 `property_owners` rows attached to those owners, **all** had a
corresponding `mailings` row (0 missing), so every property-to-address
mapping was fully determinable. Only **one** property system-wide
(`property_id` 21985, "Chad Harrison") was genuinely ambiguous -- mailed to
two different real addresses under the same owner at different times.

### 3. Apply

```
npx tsx scripts/prod-owner-identity-reconcile.ts --env-file .env.production --apply
```

Algorithm (see the script's header comment for full detail): for each
over-merged owner, group its mailing addresses by normalized full address;
the group reaching the most distinct properties (tie-broken by most recent
mail date) stays on the original owner id; every other group gets a new
owner row, and its `mailing_addresses` / `mailings` rows move to the new
owner. `property_owners` (and, for fully-moved properties only, `deals` /
`mailing_suppression`) move too -- except for a property flagged
"ambiguous" (mailed to 2+ real addresses under one owner), which is left on
the original owner and printed for manual review rather than guessed at.

**Before -> After (prod):**

| metric | before | after |
|---|---|---|
| owners | 12,547 | 12,885 (+338, exactly the number of new owner rows the plan predicted) |
| properties | 12,889 | 12,889 (unchanged) |
| mailing_addresses | 12,931 | 12,931 (unchanged -- repointed, not recreated) |
| mailings | 12,932 | 12,932 (unchanged) |
| property_owners | 12,887 | 12,887 (unchanged) |
| deals | 30 | 30 (1 repointed) |
| mailing_suppression | 23 | 23 (unchanged, 0 touched) |
| owners with 2+ distinct addresses | 290 | 0 |
| orphaned rows (any FK) | -- | 0 |
| "Robert Lee" owners | 1 | **3**, one per property/address (Henry Co. GA, Milam Co. TX, Windham Co. CT) |
| owners mailing 2+ properties to the same address | (not checked pre-reconcile) | 8 (legitimate same-person/same-address cases) |

### 4. The one manual-review case

`property_id` 21985 ("Chad Harrison") was mailed to two different real
addresses under the same owner: `11076 Green Chapel Rd NW, Johnstown, OH`
(2026-07-02) and `2485 Lookers Ln, Utica, OH` (2026-09-01, more recent).
The reconcile kept the property linked to the owner matching the
**more recent** address (owner 10289) and split the older address off into
a new owner (12870, no live property link -- history only). This is a
reasonable default but worth a human glance: confirm the Lookers Ln address
is in fact the correct current one for this owner.

## Rollback

If a rollback of the prod reconcile is ever needed:

```
npx tsx scripts/prod-backup-restore.ts restore --env-file .env.production \
  --in backups/prod-owner-reconcile-pre-20260903.json --apply
```

This truncates and restores exactly the 6 tables the reconcile touched, in
FK-safe order, inside a single transaction. It does not touch `properties`,
`campaigns`, or `data_sources`, which the reconcile never modified.

## Caveats

- The Rocketmail importer fix (`import_rocketmail.py`) lives in a separate,
  non-git workspace and isn't covered by this repo's commit history -- see
  the table above.
- The importer's `--dry-run`-equivalent for `import-master-data-fixed.ts`
  doesn't exist (it never did); the reconcile and restore scripts default to
  dry-run and require an explicit `--apply` flag to write.
- `owners.archived_at` / `mergedIntoId` (the separate soft-archive merge
  tool from `scripts/merge-duplicate-owners.ts`) were untouched by this
  work -- prod had 0 archived owners at the time of this reconcile, so there
  was nothing to reconcile against.
