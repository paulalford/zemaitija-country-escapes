#!/bin/sh
set -eu
: "${APP_DB_USER:?}" "${APP_DB_PASSWORD:?}" "${MIGRATION_DB_USER:?}" "${MIGRATION_DB_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" \
  -v migration_user="$MIGRATION_DB_USER" -v migration_password="$MIGRATION_DB_PASSWORD" \
  -v database_name="$POSTGRES_DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'migration_user', :'migration_password') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'migration_user') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT CREATE ON SCHEMA public TO %I', :'migration_user') \gexec
SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I', :'migration_user', :'app_user') \gexec
SQL
