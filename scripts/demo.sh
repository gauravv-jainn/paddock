#!/usr/bin/env bash
# `pnpm demo` — from nothing to a running app with data in it.
#
#   1. start PostgreSQL
#   2. wait for it to accept connections
#   3. migrate
#   4. seed invented demo data
#   5. launch the dev server
#
# No pipes around anything whose exit status matters — see scripts/verify.sh
# for why that rule exists in this repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is not set — copy .env.example to .env.local}"

echo "==> Starting PostgreSQL"
docker compose up -d postgres

echo "==> Waiting for PostgreSQL to accept connections"
for attempt in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U paperhorse -q; then
    echo "    ready after ${attempt}s"
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "    PostgreSQL did not become ready in 60s" >&2
    exit 1
  fi
  sleep 1
done

echo "==> Applying migrations"
pnpm db:migrate

echo "==> Seeding demo data (every horse, track and result is INVENTED)"
pnpm tsx scripts/seed-demo.ts

echo
echo "==> Starting the dev server on http://localhost:3000"
echo "    Run 'pnpm worker' in a second terminal to settle races as they finish."
echo
exec pnpm dev
