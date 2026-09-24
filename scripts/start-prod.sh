#!/bin/sh
# Production start: prepare data folders, apply DB migrations, make sure the admin exists, start the server.
set -e

DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR" "${UPLOAD_DIR:-$DATA_DIR/uploads}"

# ── Session secret safety net ───────────────────────────────────────────
# Some hosts pre-fill variables from .env.example, so SESSION_SECRET can arrive as the placeholder.
# The app refuses to run with a placeholder (or a short value), so generate a random one instead
# and keep it in the data folder. Set your own SESSION_SECRET variable to override this.
NEED_SECRET=""
case "${SESSION_SECRET:-}" in
  ""|*change-me*) NEED_SECRET=1 ;;
  *) [ "${#SESSION_SECRET}" -lt 32 ] && NEED_SECRET=1 ;;
esac
if [ -n "$NEED_SECRET" ]; then
  SECRET_FILE="$DATA_DIR/.session-secret"
  if [ ! -s "$SECRET_FILE" ]; then
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
  fi
  SESSION_SECRET="$(cat "$SECRET_FILE")"
  export SESSION_SECRET
  echo "WARNING: SESSION_SECRET was missing or a placeholder. Using an auto-generated secret stored in $SECRET_FILE. Set your own SESSION_SECRET variable to control it."
fi

echo "> Applying database migrations"
case "${DATABASE_URL:-}" in
  libsql://*|https://*)
    # A remote libSQL host (e.g. Turso). Prisma's CLI/schema-engine for a "sqlite" datasource
    # only supports local file URLs, so use the app's own migration runner instead - same SQL,
    # applied over the libsql client, and safe to run on every start (already-applied migrations
    # are skipped, see server/src/db/applyMigrations.ts).
    npm run db:deploy:remote
    ;;
  *)
    npx prisma migrate deploy
    ;;
esac

# Creates the admin from SEED_ADMIN_* only if it does not exist yet (never touches other users).
# Never create an admin with the public demo passwords from the README / .env.example.
case "${SEED_ADMIN_PASSWORD:-}" in
  *"Admin#12345"*|*"Demo#12345"*)
    echo "WARNING: SEED_ADMIN_PASSWORD is the public example password. Admin NOT created. Set your own strong SEED_ADMIN_PASSWORD (and SEED_ADMIN_EMAIL) and redeploy."
    ;;
  *)
    if [ -n "${SEED_ADMIN_EMAIL:-}" ] && [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
      echo "> Ensuring the admin account exists"
      npm run seed:admin || echo "WARNING: could not create the admin (see message above). The app will still start."
    fi
    ;;
esac

echo "> Starting Famolya on port ${PORT:-4000}"
exec npm start
