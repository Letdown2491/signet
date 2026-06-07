#!/bin/sh
set -e

# Snapshot the database before migrating so a bad migration can be rolled back.
DB_FILE="${DATABASE_URL#file:}"
[ -z "$DB_FILE" ] && DB_FILE="/app/config/signet.db"
if [ -f "$DB_FILE" ]; then
  STAMP=$(date +%Y-%m-%dT%H-%M-%S)
  for ext in "" "-wal" "-shm"; do
    [ -f "${DB_FILE}${ext}" ] && cp "${DB_FILE}${ext}" "${DB_FILE}${ext}.backup-${STAMP}" || true
  done
  echo "Backed up database to ${DB_FILE}.backup-${STAMP}"
  # Keep only the newest 5 backups of the main DB file.
  ls -1t "${DB_FILE}".backup-* 2>/dev/null | tail -n +6 | while read -r old; do rm -f "$old"; done
fi

echo "Running database migrations..."
# Use the locally-installed prisma binary so the runtime image doesn't need pnpm.
./node_modules/.bin/prisma migrate deploy

echo "Starting Signet..."
exec node ./dist/index.js "$@"
