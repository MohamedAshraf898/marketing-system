# Deploy OG System on SnapDeploy (with persistent data)

SnapDeploy's containers have **no persistent disk on any plan** - anything written to local disk
(the SQLite database file, uploaded files) is lost on every restart, sleep/wake cycle, or
redeploy. This guide keeps SnapDeploy as the host but moves the two things that need to survive
onto free, persistent services outside the container:

| What | Where it normally lives | Where it lives instead |
|---|---|---|
| Database | `/data/og-system.db` (local file) | [Turso](https://turso.tech) - a hosted, free SQLite-compatible database |
| Uploaded files | `/data/uploads` (local disk) | [Cloudflare R2](https://developers.cloudflare.com/r2/) - free S3-compatible object storage |

Nothing else changes. Both are already wired into the app - you only need to create the two
free accounts and set the resulting variables when you deploy.

## 0. Prepare your values

1. A long random `SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
2. Your real admin login: an email and a strong password (8+ characters, letters and numbers).
   Do **not** reuse the demo passwords (`Admin#12345` / `Demo#12345`) - the app refuses to
   create an admin with those in production.

## 1. Create a free Turso database (the persistent database)

1. Install the CLI and sign up (no credit card): see [docs.turso.tech/quickstart](https://docs.turso.tech/quickstart).
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth signup
   ```
2. Create the database:
   ```bash
   turso db create og-system
   ```
3. Get the connection URL (starts with `libsql://`):
   ```bash
   turso db show og-system --url
   ```
4. Create an auth token:
   ```bash
   turso db tokens create og-system
   ```
   Keep both values - you'll paste them into SnapDeploy as `DATABASE_URL` and
   `DATABASE_AUTH_TOKEN`.

The free tier (as of writing: 500 databases, 5 GB total storage, 500M rows read/month, 10M rows
written/month) is far more than an agency's internal tool needs. No schema changes were needed
on the app's side - it already speaks the libSQL protocol Turso uses.

## 2. Create a free Cloudflare R2 bucket (persistent file storage)

1. Cloudflare dashboard -> **R2 Object Storage** -> **Create bucket**. Name it e.g.
   `og-system-uploads`. (Free tier: 10 GB storage, 1M write / 10M read operations per month, no
   credit card required for the free allowance.)
2. **Manage API tokens** -> **Create API token** -> permission **Object Read & Write**, scoped to
   that bucket. Copy the **Access Key ID** and **Secret Access Key** - the secret is only shown
   once.
3. Your endpoint is `https://<account_id>.r2.cloudflarestorage.com` (the account ID is shown on
   the R2 overview page, and also in the token creation screen).

You'll set these as `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
`STORAGE_DRIVER=s3` below.

## 3. Put the code on SnapDeploy

Unzip the project, push it to a **private** GitHub repository (`.gitignore` already keeps `.env`,
databases and uploads out of it):
```bash
cd og-system
git init && git add . && git commit -m "OG System"
git branch -M main
git remote add origin https://github.com/<you>/og-system.git
git push -u origin main
```

In SnapDeploy: **Containers -> Deploy from GitHub**, pick the repo/branch. SnapDeploy will scan
the source, find the Dockerfile, and detect the environment variables it references - you'll be
asked to fill them in before the first deploy.

## 4. Fill in the environment variables

Paste these into SnapDeploy's "Environment Variables Detected" screen (add any not auto-detected
yourself, e.g. under an "Add variable" option):

| Variable | Value |
|---|---|
| `TRUST_PROXY` | `1` |
| `COOKIE_SECURE` | `true` |
| `CLIENT_ORIGIN` | *(see note below - you don't know this yet on the first deploy)* |
| `APP_CURRENCY` | e.g. `USD` or `AED` |
| `SESSION_SECRET` | the random value from step 0 |
| `SEED_ADMIN_EMAIL` | your admin email |
| `SEED_ADMIN_PASSWORD` | your strong admin password |
| `SEED_ADMIN_NAME` | your name (optional) |
| `DATABASE_URL` | the `libsql://...` URL from step 1 |
| `DATABASE_AUTH_TOKEN` | the token from step 1 |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` | your bucket name from step 2 |
| `S3_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_ACCESS_KEY_ID` | from step 2 |
| `S3_SECRET_ACCESS_KEY` | from step 2 |
| `S3_FORCE_PATH_STYLE` | `true` |

Do **not** set `PORT`, `UPLOAD_DIR` or `BACKUP_DIR` - the image already sets sensible defaults,
and `UPLOAD_DIR`/`BACKUP_DIR` are irrelevant once `STORAGE_DRIVER=s3` is set.

**About `CLIENT_ORIGIN`:** this must be the exact `https://` URL of your deployed container
(no trailing slash), or logins will fail with a CORS/origin error. You only get that URL *after*
the first deploy, so:
1. Deploy once with `CLIENT_ORIGIN` set to a placeholder (anything, e.g. `https://placeholder.example`).
2. Once SnapDeploy shows the container's public URL (Containers -> your container -> the domain
   it assigned, or a custom domain you attach under **Domains**), edit `CLIENT_ORIGIN` to that
   exact URL and redeploy.

Click **Deploy**.

## 5. First start

On every start, the container:
1. Applies database migrations against your Turso database (safe to repeat - already-applied
   migrations are skipped).
2. Creates your admin account from `SEED_ADMIN_*` if it doesn't exist yet.
3. Starts the app.

Watch the deploy logs for `Migrations applied (remote database).` and
`OG System API listening on ...`. Then open the container's URL and sign in with your admin
email and password.

## 6. Verify persistence

This is the whole point, so check it once: create a test client or upload a file, then in
SnapDeploy restart (or redeploy) the container. Reload the app - the client and file should
still be there, since they now live in Turso and R2, not on the container's disk.

## 7. First steps in the live app

1. Production starts **empty on purpose** - no demo data. Create your first client, campaign and
   team users (see the README, section on "who can do what").
2. Send each client their login and ask them to change their password in **Settings**.

## 8. Backups

- **Database**: Turso keeps its own history; use `turso db shell og-system .dump` or the Turso
  dashboard/CLI's export and branching features for point-in-time copies. Running
  `npm run db:backup` inside the container will tell you this and stop, rather than fail
  confusingly - it's built for a local SQLite file, which you no longer have.
- **Files**: back up the R2 bucket with `rclone` (R2 is S3-compatible) or Cloudflare's own
  bucket tools.

## 9. Updating the app later

- Push to GitHub; SnapDeploy redeploys automatically (or trigger a redeploy manually).
- Data stays in Turso/R2 regardless of redeploys or restarts; new migrations apply on start.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "SESSION_SECRET is missing or shorter than 32 characters" | Set `SESSION_SECRET` (step 0/4). |
| Login works but you get logged out or "forbidden" on actions | `CLIENT_ORIGIN` must be exactly your container's https URL (step 4 note) - fix and redeploy. |
| "Admin ... could not be created" in the logs | `SEED_ADMIN_PASSWORD` is too weak, or is one of the public demo passwords; use 8+ characters with letters and numbers. |
| Forgot the admin password | Open a shell on the container (if SnapDeploy offers one) and run `npm run seed:admin -- --reset-password`. |
| Migration step errors on a remote database | Double check `DATABASE_URL` (must start with `libsql://`) and `DATABASE_AUTH_TOKEN` are exactly what `turso db show`/`turso db tokens create` printed. |
| File uploads fail with a storage error | Double check `STORAGE_DRIVER=s3` and all five `S3_*` variables; the R2 API token must have Object Read & Write on that specific bucket. |
| Data still disappears after a restart | Something is still pointing at local disk - re-check `DATABASE_URL` is the `libsql://` one (not `file:...`) and `STORAGE_DRIVER=s3` is actually set (not left as `local`/unset). |

## About the free tiers

Turso's and Cloudflare R2's free tiers (as described above) are, at the time of writing, more
than enough for an internal agency tool with a handful of clients and team members. Both
providers can change their pricing and limits at any time - check their current pricing pages
before relying on this for anything business-critical, and keep an eye on usage as your data
grows.
