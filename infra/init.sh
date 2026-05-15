#!/usr/bin/env bash
set -euo pipefail

cd /repo

echo "==> Applying migrations"
pnpm --filter @au/db migrate

echo "==> Seeding reference data (jurisdictions + chambers)"
pnpm --filter @au/db seed

# Skip if already populated — re-runs of this container should be a no-op.
REPS=$(node -e "
import('postgres').then(async ({default:pg}) => {
  const sql = pg(process.env.DATABASE_URL);
  const r = await sql\`SELECT COUNT(*)::int AS n FROM reps\`;
  console.log(r[0].n); await sql.end();
});
" 2>/dev/null || echo 0)

if [ "${REPS:-0}" -eq 0 ]; then
  echo "==> Federal roster scrape"
  pnpm --filter @au/ingest-federal start
else
  echo "==> Skipping federal roster scrape (reps already loaded: $REPS)"
fi

# Download + load AEC boundaries if not yet present.
SHP=/repo/data/boundaries/federal/AUS_ELB_region.shp
if [ ! -f "$SHP" ]; then
  echo "==> Downloading AEC boundary shapefile"
  mkdir -p /repo/data/boundaries/federal
  curl -fsSL -A 'democracy.au-init/0.1' \
    -o /repo/data/boundaries/federal/aec.zip \
    https://www.aec.gov.au/Electorates/files/2025/AUS-March-2025-esri.zip
  unzip -o /repo/data/boundaries/federal/aec.zip -d /repo/data/boundaries/federal/
fi

ELEC=$(node -e "
import('postgres').then(async ({default:pg}) => {
  const sql = pg(process.env.DATABASE_URL);
  const r = await sql\`SELECT COUNT(*)::int AS n FROM electorates\`;
  console.log(r[0].n); await sql.end();
});
" 2>/dev/null || echo 0)

if [ "${ELEC:-0}" -eq 0 ]; then
  echo "==> Loading federal boundaries into PostGIS"
  pnpm --filter @au/ingest-federal boundaries
else
  echo "==> Skipping federal boundary load (electorates already present: $ELEC)"
fi

# ABS state electoral divisions — covers all 8 states/territories in one
# shapefile. Idempotent: re-loading just updates polygons.
SED_SHP=/repo/data/boundaries/sed/SED_2025_AUST_GDA94.shp
if [ ! -f "$SED_SHP" ]; then
  echo "==> Downloading ABS SED shapefile"
  mkdir -p /repo/data/boundaries/sed
  curl -fsSL -A 'democracy.au-init/0.1' \
    -o /repo/data/boundaries/sed/sed.zip \
    'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3/jul2021-jun2026/access-and-downloads/digital-boundary-files/SED_2025_AUST_GDA94.zip'
  unzip -o /repo/data/boundaries/sed/sed.zip -d /repo/data/boundaries/sed/
fi
echo "==> Loading state electoral boundaries (ABS SED 2025)"
pnpm --filter @au/ingest-shared abs-sed "$SED_SHP" || echo "(SED load failed, continuing)"

# State / territory roster scrapes. applyRoster() is idempotent so safe to
# re-run; let it run every boot so we stay in sync with each parliament.
for st in nsw vic qld wa tas act nt sa; do
  echo "==> $st roster"
  pnpm --filter "@au/ingest-state-$st" start || echo "($st scrape failed, continuing)"
done

echo "==> Init complete"
