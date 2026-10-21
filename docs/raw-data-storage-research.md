# Raw Data Storage Research and Proposal

**Workboard card:** `elw-mailing-list populating raw data fields` (`4136a430-58ac-44ca-b827-659c1592e448`)
**Date:** 2026-09-08
**Scope:** Determine where raw/supplemental mailing-list data is currently stored, inspect the linked-sheet ingestion paths, and propose a durable storage model.

## Executive summary

The application currently has no row-level, source-preserving store for an individual mailing-list record. The canonical schema normalizes the main business entities, while the importers either discard supplemental columns or keep the original attachment row only in an in-memory/JSON `_raw` object.

The best design is **one centralized source-row table for each source record**, linked to the mailing event and, when resolved, to the property, owner, and campaign. Do not copy the same full raw row into `owners`, `properties`, and `mailings`. Promote stable, commonly queried values into normalized columns, but keep the complete source snapshot and provenance in one place.

The existing `owners.raw_data` and `properties.raw_data` columns were added on the `features/data-model-alignment` branch, not on the checked-out `main` branch. They are therefore not yet a complete implementation of this proposal, and the current TypeScript master importer still does not populate them.

## Evidence reviewed

- `/Users/agentorange/Projects/elw-mailing-list/shared/schema.ts`
- `/Users/agentorange/Projects/elw-mailing-list/migrations/0000_organic_yellowjacket.sql`
- `/Users/agentorange/Projects/elw-mailing-list/scripts/import-master-data.ts`
- `/Users/agentorange/Projects/elw-mailing-list/scripts/import-master-data-fixed.ts`
- `/Users/agentorange/Projects/elw-mailing-list/scripts/reassign-campaigns.ts`
- `/Users/agentorange/Projects/elw-mailing-list/scripts/campaign-normalize.ts`
- `/Users/agentorange/.openclaw/workspace-orange/skills/elw-rocketmail-importer/scripts/import_rocketmail.py`
- `/Users/agentorange/.openclaw/workspace-orange/skills/elw-rocketmail-importer/SKILL.md`
- `/Users/agentorange/.openclaw/workspace-orange/elw_data_model_mapping.csv`
- Prior comparison: `docs/data-model-alignment.md` on branch `features/data-model-alignment` / commit `06701d6`
- Local Rocketmail attachment sample: `1a025136639f1bab_ANGjdJ_8_m1052076.csv`

The live linked Google Sheet could not be read in this session: the configured `alex@eastonlandworks.com` account has Gmail-only scopes, and the other authenticated account does not have access to the spreadsheet. Findings about live tab row counts/headers are therefore based on the importer implementation, prior run output recorded in the importer skill, and local source samples. A live-sheet read is still required before implementing a backfill.

## 1. Current application data model: all tables

The checked-out `main` schema contains these ten tables:

| Table | Current role | Raw/supplemental-data relevance |
|---|---|---|
| `data_sources` | Names a provenance source such as a master-sheet or Rocketmail import. | Useful source-level catalog, but has no document/tab/row payload. |
| `properties` | Canonical parcel record keyed by APN. | Stores normalized parcel fields; currently no `raw_data` on `main`. |
| `owners` | Canonical person/entity record. | Stores normalized identity; currently no phone/email/raw data on `main`. |
| `property_owners` | Many-to-many property/owner relationship. | Correct place for the relationship, not a raw payload. |
| `mailing_addresses` | One or more mailing addresses for an owner. | Correct place for a normalized address, not a full source row. |
| `campaigns` | Canonical mailing/list grouping with a link. | The link identifies a source sheet at a high level, but not a source row or tab snapshot. |
| `mailings` | One mailing event connecting campaign, property, owner, and address; includes mail date and offer price. | Best business anchor for a row that represents a mailed record. It lacks source row data/provenance. |
| `deals` | Contacts/leads/conversions tied to property and owner. | Not a source-row store. |
| `mailing_suppression` | Do-not-mail/bad-address decisions. | Stores derived business decisions, not the original source values. |
| `source_metadata` | Property-level external IDs, links, and estimated values. | Closest existing provenance table, but too narrow: property-only, not row/campaign/owner scoped and no JSON payload. |

The mapping CSV also describes several tables that are **not** in the application (`campaign_properties`, `contacts`, `mailing_campaigns`, `mailing_campaign_contacts`, `import_jobs`). The prior data-model work correctly concluded that the app's normalized model is the source of truth; this proposal does not reintroduce those duplicate tables.

## 2. What the current importers do

### Master Google Sheet importer

Both `scripts/import-master-data.ts` and `scripts/import-master-data-fixed.ts` read the consolidated master tab using a positional `A:AJ` range. The parser currently recognizes these fields:

- APN, county, state, acres
- sheet name and sheet link
- owner first/last name, owner email, owner phone
- mailing address lines/city/state/ZIP
- situs address/city, legal description
- data source, offer price, to-mail
- mailing dates 1–3
- mail exclusion/reason, bad address
- hit type/date/source
- prospect/prospect date/source
- do-not-mail

The fixed importer uses the parsed values to populate normalized properties, owners, addresses, campaigns, mailings, suppressions, deals, and property-level source links. However:

- `ownerEmail` and `ownerPhone` are parsed but not written by the TypeScript importers.
- Several parsed values are dropped after the row is processed (`situsAddress`, `situsCity`, `toMail`, later mailing dates, exclusion reason, hit source, prospect source/date, and similar fields).
- There is no source row number, source tab, header map, or raw row snapshot stored.
- `source_metadata` receives only `propertyId`, `dataSourceId`, and `sourceLink`.
- The old `import-master-data.ts` contains an invalid `onConflictDoUpdate` assumption for `owners.ownerName`; `import-master-data-fixed.ts` is the safer implementation path.

The `features/data-model-alignment` branch adds `owners.phone`, `owners.email`, `owners.raw_data`, and `properties.raw_data`, but the checked-out `main` branch does not contain those changes. Even on that branch, wiring the TypeScript importer and deciding source precedence remains unfinished.

### Rocketmail attachment + linked-sheet enrichment

The Rocketmail importer has a more complete enrichment path:

1. It parses the mailed CSV attachment and keeps the original attachment row in `record["_raw"]`.
2. It discovers the originating Google Sheet by APN triangulation.
3. It inspects all sufficiently large data-like tabs rather than requiring a tab named `raw`. It skips obvious dashboard/config/summary tabs, then scores candidate tabs by row count, required-column matches, and data density.
4. It matches rows by APN and fills only fields left empty in the mailed CSV. Empty sheet cells do not overwrite values.
5. It currently stops at the first matching row/tab and stores only `_enriched_from_tab` as provenance. It does not preserve a separate, structured snapshot of the matched linked-sheet row(s).
6. The optional importer path can write the entire attachment `_raw` object to `owners.raw_data` and `properties.raw_data` when those columns exist, but this is duplicated across entities and does not preserve linked-sheet row provenance separately.

The skill's recorded example shows sheets with multiple data tabs, including a tab named `NY Raw (zamplo pricing)`. This supports the requirement that tab selection must be content-based, not hard-coded to the name `raw`.

### Local attachment sample

The available local CSV has 37 columns, including postal-processing fields, owner/name fields, mailing address fields, list name, county, situs state/city, APN, legal description, acres, offer price, and mailing address fields. It contains no phone/email columns in the attachment sample. This is a concrete reason to preserve the linked-sheet enrichment separately: the linked sheet can contain fields absent from the mailed CSV.

## 3. Are raw fields currently used?

**On `main`: no.** There are no `raw_data` columns in the checked-out schema and no application routes that query them.

**On the data-model-alignment branch: partially prepared, not operational.** The branch adds JSONB columns to `owners` and `properties`, and the Python Rocketmail importer detects and writes them when available. The TypeScript master import scripts still need to populate them.

**Current in-memory use:**

- Rocketmail: `record["_raw"]` preserves the original mailed CSV row during an import run.
- Linked-sheet enrichment: matched cells are merged into the top-level record; the source tab name is kept in `_enriched_from_tab`, but the complete linked-sheet row and per-field source are not retained.
- Master importer: parsed row values are used for selected normalized fields, while the remainder is discarded.

## 4. Recommended storage model

### Recommendation: centralized `mailing_source_rows` table

Add a single append-oriented table representing one source row/snapshot. It should be the source-of-record for raw payloads and provenance, regardless of whether the row came from a mailed CSV or a linked Google Sheet tab.

Proposed fields:

| Field | Purpose |
|---|---|
| `id` | Surrogate primary key. |
| `data_source_id` | Links to `data_sources`; identifies the import/source family. |
| `campaign_id` | Links the row to its mailing/list campaign when known. |
| `mailing_id` | Links to the resulting mailing event when the row has been resolved. Nullable for pre-match or rejected rows. |
| `property_id` | Resolved property, nullable. |
| `owner_id` | Resolved owner, nullable. |
| `source_kind` | Example values: `mailed_csv`, `linked_sheet`. A check constraint or enum can enforce known values later. |
| `source_document_id` | Google Sheet ID, attachment ID, or other stable document identifier. |
| `source_tab_name` | Actual tab name, never assumed to be `raw`. |
| `source_row_number` | Original 1-based row number when available. |
| `source_link` | Canonical document/tab link, including a stable gid when available. |
| `headers` | JSONB array/object preserving the header ordering used to interpret the row. |
| `row_data` | JSONB object containing the complete raw row as received. |
| `row_hash` | Deterministic hash for idempotency and duplicate detection. |
| `matched_by` / `match_confidence` | APN, APN+owner, address, etc.; useful for review of enrichment quality. |
| `imported_at` | Ingestion timestamp. |

A uniqueness rule should be source-specific, for example `(source_document_id, source_tab_name, source_row_number, row_hash)` when row numbers are reliable. Do not use APN alone: one APN can legitimately occur in multiple campaigns, tabs, or corrected source snapshots.

### Why the raw row belongs centrally

1. **Correct scope:** a source row commonly contains property, owner, address, offer, campaign, and mailing-status fields at once. It is not owned by only one entity.
2. **No conflicting copies:** putting the same JSON in owner, property, and mailing rows creates three snapshots that can diverge and makes updates/merges ambiguous.
3. **Lineage:** a centralized row can say exactly which document, tab, row, and import produced a value.
4. **Multiple occurrences are first-class:** the same owner/property can appear on multiple mailing lists; each occurrence needs its own raw record.
5. **Replayability:** future schema changes can reprocess raw rows without re-reading Gmail or Google Sheets.
6. **Auditability:** source corrections and enrichment decisions can be compared over time rather than overwriting historical evidence.

### Keep normalized columns for stable, queried fields

Raw storage should not replace the normalized model. Continue promoting fields that the application filters, joins, or displays frequently:

- `properties`: APN, state, county, ZIP, acres, legal description.
- `owners`: owner name/type, and phone/email if the product needs them.
- `mailing_addresses`: normalized address values.
- `campaigns`: canonical campaign name and source link.
- `mailings`: mailing date, offer price, and relationships.
- `deals`/`mailing_suppression`: derived business outcomes and decisions.

The central raw row should retain the original values even when a normalized value is promoted or later changed.

### What to do with `owners.raw_data` and `properties.raw_data`

Two acceptable options exist:

- **Preferred:** do not add entity-level full-row JSONB at all; use `mailing_source_rows` for the complete source payload and add only normalized `phone`/`email` columns where needed.
- **Transitional:** keep the already-designed `owners.raw_data`/`properties.raw_data` JSONB columns as a denormalized convenience cache, but treat them as non-authoritative. Populate them with a small, clearly documented entity-specific projection (not the full mailing row), and always retain the authoritative full row centrally.

Do not store the same full linked-sheet row in both owners and properties. If the transitional columns remain, they should be populated only when a clear UI/query requirement justifies the duplication.

## 5. Source precedence and enrichment rules

1. The mailed CSV is the source of truth for values it supplies.
2. A linked sheet may fill only a missing value; it must not overwrite a non-empty mailed-CSV value.
3. Empty/whitespace-only enrichment cells are ignored.
4. Store each source row independently, including the linked-sheet row that supplied an enrichment value.
5. Record field-level provenance when a value is promoted, either as `field_sources` JSONB on the source-row relationship or by querying the source rows ordered by precedence.
6. Preserve all matched tabs/rows for an APN when they provide distinct information. Do not stop after the first matching tab if the goal is complete enrichment.
7. Use APN as the primary match key, with normalized APN plus owner/address as tie-breakers. Record the match method and confidence.
8. Select tabs by content (row/column count, APN-header detection, APN match rate, and data density), not by a literal tab name such as `raw`.

## 6. Proposed ingestion flow

1. Ingest the mailed attachment row into `mailing_source_rows` as `mailed_csv` before enrichment.
2. Resolve/create the canonical property, owner, address, campaign, and mailing records.
3. Discover all candidate linked-sheet tabs using metadata and content scoring.
4. For every matching linked-sheet row, insert a `linked_sheet` source-row record with document ID, actual tab name, row number, headers, payload, and match details.
5. Promote only missing/approved fields to normalized tables according to the source-precedence rules.
6. Link all raw rows to the resulting `mailing_id` where possible; keep unresolved rows for review rather than dropping them.
7. Make imports idempotent using source identity + row hash, and report ambiguous APN collisions.

## 7. Implementation sequence

1. Decide whether the transitional entity `raw_data` columns are wanted. The recommendation is to centralize the full payload and keep only normalized owner/property fields in entity tables.
2. Add a migration and Drizzle model for `mailing_source_rows`.
3. Refactor the active importer path (`import-master-data-fixed.ts` and the Rocketmail importer) to write raw rows and source provenance.
4. Replace positional, hard-coded assumptions with header-aware parsing where possible. The linked-sheet selector must remain content-based and tab-name agnostic.
5. Add dry-run/reporting for: rows ingested, rows matched, ambiguous APNs, linked tabs used, fields promoted, and fields rejected due to source precedence.
6. Backfill from available mailed CSVs and linked sheets only after confirming Google API access and choosing an idempotency key.
7. Retire or clearly mark `scripts/import-master-data.ts` as obsolete so the importer with the known owner conflict bug is not accidentally run.

## Open questions / remaining validation

- Obtain read access to the actual linked Google Sheet and inventory every tab's headers, row counts, and duplicate/APN collision rate.
- Confirm whether a source row should be retained for every import run (historical snapshots) or only when the row hash changes.
- Decide whether the UI needs raw-row inspection, field-level provenance, or only an audit/export API.
- Confirm whether `owners.phone` and `owners.email` should be promoted to canonical columns now that the data-model branch prepared them.
- Choose the final uniqueness key after observing whether source row numbers are stable across sheet edits.

## Conclusion

Raw mailing-list data should be stored once, centrally, at source-row granularity, with links to the normalized records it produced. `owners`, `properties`, `mailing_addresses`, and `mailings` should contain clean, queryable business data; they should not each carry a copy of the same source row. This preserves multiple campaigns and linked-sheet tabs without losing provenance, while keeping the current normalized schema useful for application queries.
