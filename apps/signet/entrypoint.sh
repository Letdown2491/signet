#!/bin/sh
set -e

# Migrations (and the pre-migration snapshot) belong to the long-running daemon
# only. Admin subcommands such as `add` must not run them: `prisma migrate
# deploy` needs SQLite's write lock, which a running daemon holds, so
# `docker compose run signet add ...` would otherwise fail with
# "database is locked" on a live instance.
# The subcommand may be preceded by the global --config/-c option.
SUBCOMMAND="$1"
case "$1" in
  --config|-c) SUBCOMMAND="$3" ;;
esac

if [ "$SUBCOMMAND" = "start" ]; then
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
else
  echo "Skipping database migrations (command: ${SUBCOMMAND:-none})"
fi

echo "Starting Signet..."
exec node ./dist/index.js "$@"
