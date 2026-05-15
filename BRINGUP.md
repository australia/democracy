# Bring-up

Prereqs: Node 22, pnpm 10, Docker (with disk headroom — the PostGIS image is ~1 GB).

## 1. Install

```sh
pnpm install
cp .env.example .env  # edit as needed; defaults work for dev
```

## 2. Database (PostGIS)

```sh
pnpm db:up               # start docker compose
pnpm db:generate         # generate the initial Drizzle migration from src/schema.ts
pnpm db:migrate          # apply migrations (PostGIS extension installed automatically)
pnpm db:seed             # populate jurisdictions + chambers reference data
```

Useful: `pnpm db:psql` opens a psql shell, `pnpm db:studio` opens Drizzle Studio.

## 3. Ingest the federal roster

```sh
pnpm ingest:federal dry   # fetch + parse, print JSON, no DB writes
pnpm ingest:federal       # fetch + parse + upsert into reps
```

The scraper hits `aph.gov.au` directly, paginating through the
Parliamentarian search results and then visiting each profile page. It's
polite — 750 ms between list pages, 500 ms between profile fetches. Expect
~5 min for the full federal roster (~150 MPs + 76 Senators).

## 4. Run the web app

```sh
pnpm dev                 # http://localhost:3000
```

Right now the homepage is a placeholder. Compose flow and address lookup
arrive in Phase 1.6/1.7.

## Layout

```
apps/web                # Next.js 15 (App Router)
apps/worker             # background workers (pg-boss) — empty stub
packages/db             # Drizzle schema + migration runner + seed
packages/ingest/shared  # shared types + polite HTTP client
packages/ingest/federal # federal scraper (aph.gov.au)
infra/                  # docker compose + initdb (PostGIS + pgcrypto)
data/boundaries         # AEC shapefiles land here (gitignored)
legislators-locator/    # 2014 prototype, quarantined, not imported anywhere
```

## What's done

- Monorepo (pnpm workspaces)
- Postgres + PostGIS via docker compose
- Full Drizzle schema (10 tables) with PostGIS geography column for electorate polygons
- Reference seed (9 jurisdictions, their chambers, members-per-voter counts)
- Federal scraper (list → profile → upsert), with audit table for every scrape

## What's next (Phase 1.5+)

- AEC GIS shapefile ETL → `electorates` table
- Address → electorate lookup API (`/api/lookup`)
- Compose flow + magic-link auth
- Delivery worker (SES sandbox in dev)
- Anti-abuse: constituency gate, SimHash mass-mailing detection, rate limits
