#!/usr/bin/env bash
# Dump the current rep rosters from the local DB into data/rosters/<state>.json.
# Run after the per-state scrapers on a dev machine, then commit the JSON.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/rosters
for st in nsw vic qld wa tas act nt; do
  docker compose -f infra/docker-compose.yml exec -T db psql -U au -d au -At -c \
    "SELECT rows_raw::text FROM roster_audit WHERE jurisdiction='$st' ORDER BY scraped_at DESC LIMIT 1" \
    > "data/rosters/$st.json"
  echo "$st: $(wc -c < data/rosters/$st.json) bytes"
done
