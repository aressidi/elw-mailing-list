# Code Review & Follow-Ups

Reviewed 2026-08-27 against commit `d822f8c`. Findings are ordered by severity.
Nothing below has been fixed yet — this is the open list.

---

## P0 — Rotate the leaked database credential

`.env.production` contains a live Neon password, committed in `d822f8c`
("Add Neon DATABASE_URL for production") and `b46e716`:

```
DATABASE_URL=postgresql://neondb_owner:npg_WwFo…@ep-empty-glade-awphsj20.c-12.us-east-1.aws.neon.tech/neondb
```

It is in git history, so deleting the file does not remove it.

- [ ] Rotate the `neondb_owner` password in the Neon console
- [ ] Move the value into Render's env vars (never a committed file)
- [ ] Add `.env.production` to `.gitignore` — currently only `.env` and `.env.*.local` are covered,
      so `.env.production` and `client/.env.production` are both tracked
- [ ] Optionally scrub history (`git filter-repo`) — only worth it if the repo is or will be public

---

## P1 — Deployment is broken end-to-end

Local dev works because `tsx` and Vite do not typecheck. Every build path fails.
Verified by running each command.

- [ ] **`npm run build:server` exits 2.** `server/tsconfig.json` sets `rootDir: "."` but
      includes `../shared/**/*`, so `shared/types.ts` falls outside the root:

      error TS6059: File 'shared/types.ts' is not under 'rootDir' '/server'

      This is Render's build command, so the backend cannot deploy.
      Fix: set `rootDir: ".."` and update the start path accordingly.

- [ ] **`npm start` crashes** even on the partially-emitted output. Nothing lands in
      `server/dist/shared/`, so `import '../shared/schema.js'` resolves to the nonexistent
      `server/shared/schema.js`:

      Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../server/shared/schema.js'
        imported from .../server/dist/db.js

      Falls out of the `rootDir` fix above; `start` becomes `node server/dist/server/index.js`.

- [ ] **`npm run build` and `npm run typecheck` exit 2.** TypeScript 7 removed `baseUrl`,
      still present in `tsconfig.json:16` and `client/tsconfig.json:18`. Client additionally
      needs a leading `./` on path mappings (`"@/*": ["./src/*"]`) — non-relative paths are
      no longer allowed.

- [ ] **Vercel output directory is wrong.** `vite.config.ts` sets `root: 'client'`, so the
      bundle lands in `client/dist`, but `vercel.json` declares `"outputDirectory": "dist"`.

---

## P2 — Correctness bugs

- [ ] **Pagination is silently wrong when filtering by state.**
      `server/routes.ts:317` (owners) and `server/routes.ts:536` (mailings) apply the `state`
      filter *after* `LIMIT/OFFSET`, then overwrite `total` with the filtered page length.
      Requesting page 1 of TX owners returns whichever of the first 20 rows happen to be TX
      and reports that count as the grand total. Needs a join into the `where` clause.

- [ ] **Hyphenated counties are truncated.** `server/routes.ts:624` builds the key as
      `` `${state}-${county}` `` then splits it back on `'-'`, so "Miami-Dade" is reported
      as "Miami". Use a delimiter that cannot appear in the data, or keep the parts separate.

- [ ] **All search is case-sensitive.** `like()` maps to SQL `LIKE`; Postgres is case-sensitive.
      "smith" will not match "Smith" in `/properties/search`, `/owners/search`, or the
      county / apn / name filters. Should be `ilike` throughout.

- [ ] **Stats endpoints load whole tables into Node.** `/mailings/by-state` (`routes.ts:561`)
      and `/mailings/by-county` (`routes.ts:596`) `findMany()` with no limit and aggregate in
      JS. Fine at 93 rows, an OOM at scale. Each is one SQL `GROUP BY`.

- [ ] **`POST /suppression` check-then-insert is not atomic** (`routes.ts:790`). Concurrent
      requests hit the `mailing_suppression_unique_idx` and return 500 instead of the intended
      409. `onConflictDoNothing()` collapses it to one statement.

- [ ] **No authentication on any endpoint.** The whole API is open, including owner names and
      mailing addresses. Worth deciding on before this is reachable from the internet.

- [ ] **`/properties/search` does not search addresses.** Documented as "by APN or address"
      (`routes.ts:202`) but queries apn / county / zip. `properties` has no address column at all.

- [ ] **Boolean query params fail open to `false`.** `routes.ts:645` treats any value other
      than the literal `'true'` as false, so `?isLead=1` silently filters the wrong way.

---

## P3 — Cleanup

- [ ] **Committed build artifacts.** `shared/schema.js` and `shared/schema.d.ts` are tracked,
      and the server imports `../shared/schema.js`. They will drift from `schema.ts` silently.
      Generate them or delete them; do not commit them.
- [ ] **Dead schema.** `shared/types.ts` describes an old flat `mailing_list_records` table that
      no longer exists in the Drizzle schema.
- [ ] **Dead dump.** `backup_mailing_list_records.sql` is an empty dump of that same dropped table.
- [ ] **Duplicate unique constraint on `properties.apn`.** `shared/schema.ts:27` has both
      `.unique()` and a `uniqueIndex`, so the DB carries `properties_apn_unique` *and*
      `properties_apn_idx` (confirmed on the live table).
- [ ] **`scripts/fix-suppression.ts` hardcodes a DB URL** and a Google Sheet ID, bypassing
      `DATABASE_URL`.
- [ ] **Vite config warning:** `__dirname` in `vite.config.ts:10` is unsupported by the native
      config loader that will become Vite's default. Use `import.meta.dirname`.
- [ ] **Client bundle is 696 kB** (199 kB gzipped) in a single chunk. Code-split if it matters.

---

## Local development setup

Verified working on 2026-08-27 (Node 25.9.0, Postgres 16 via Homebrew).

```bash
npm install
createdb elw_mailing_list
# .env is gitignored; see .env.example. DATABASE_URL used locally:
#   postgres://alexanderressi@localhost:5432/elw_mailing_list
npx drizzle-kit migrate      # creates all 10 tables
npx tsx scripts/seed-dev.ts  # sample data; deterministic, truncates first
npm run dev                  # API :3000, client :5173
```

`scripts/seed-dev.ts` generates 120 properties, 90 owners, 93 mailings, 15 deals and
9 suppressions across 4 campaigns. Safe to re-run.

### Known local gotcha

Vite binds **IPv6-only** (`[::1]:5173`). `curl http://127.0.0.1:5173` fails while
`curl 'http://[::1]:5173'` succeeds, and some browsers/extensions that resolve `localhost`
to IPv4 first will show a connection error. Work around with `npx vite --host 127.0.0.1`,
or set `server.host` in `vite.config.ts`.

The React UI was **not** visually confirmed during this review for that reason — the API was
verified directly (all 10 endpoints 200, correct joined data through the Vite proxy), but the
rendered frontend still needs a human look.
