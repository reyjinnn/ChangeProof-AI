#!/bin/sh
# Disposable-stack schema init (runs once, on first container start).
# Applies the reviewed migrations in NUMERIC order — alphabetical globbing
# would run V10 before V2. Keep this list identical to
# infra/selfhost/profiles/local-linux.json -> migrationFiles.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -c 'CREATE DATABASE "changeproof"'
for f in \
  V1__identity_tenancy.sql \
  V2__identity_services.sql \
  V3__jobs.sql \
  V4__usage.sql \
  V5__email_identity.sql \
  V6__lifecycle.sql \
  V7__engagement.sql \
  V8__teamwork.sql \
  V9__distribution.sql \
  V10__enterprise.sql \
  V11__service_operations.sql \
  V12__workspace.sql \
  V13__github_identity.sql \
; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname changeproof -f "/migrations/$f"
done
