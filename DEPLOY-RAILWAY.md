# Deploy Famolya on Railway (trial)

This project already contains everything Railway needs: `Dockerfile`, `railway.json`
and `scripts/start-prod.sh`. On every start the container applies the database
migrations, creates your admin account (only if it does not exist) and starts the server.

> Railway's dashboard changes from time to time, so button names may differ a little.
> The concepts stay the same: **service + volume + variables + domain**.

## 0. Prepare two values

1. A long random `SESSION_SECRET`. Generate one (needs Node) with:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
2. Your real admin login: an email and a strong password (8+ characters, letters and numbers).
   Do **not** reuse the demo passwords.

## 1. Put the code on Railway

Pick ONE way.

### A) From GitHub (recommended)

1. Unzip `og-system.zip`, create a **private** GitHub repository and push the folder:
   ```bash
   cd og-system
   git init && git add . && git commit -m "Famolya"
   git branch -M main
   git remote add origin https://github.com/<you>/og-system.git
   git push -u origin main
   ```
   (`.gitignore` already keeps `.env`, databases and uploads out of the repo.)
2. In Railway: **New Project → Deploy from GitHub repo →** choose the repo.

### B) From your computer with the Railway CLI

```bash
npm i -g @railway/cli
railway login
cd og-system
railway init          # create a new project
railway up            # uploads and builds the folder
```

## 2. Add a Volume (this is what keeps your data)

Without a volume every redeploy would wipe the database and uploaded files.

1. Open the service → **Settings → Volumes** (or right-click the service on the canvas → **Attach Volume**).
2. Mount path: `/data`  (exactly this).

The image is already configured to keep the database in `/data/og-system.db`,
uploads in `/data/uploads` and backups in `/data/backups`.

## 3. Set the variables

Service → **Variables** → add:

| Variable | Value |
|---|---|
| `SESSION_SECRET` | the random value from step 0 |
| `SEED_ADMIN_EMAIL` | your admin email |
| `SEED_ADMIN_PASSWORD` | your strong admin password |
| `SEED_ADMIN_NAME` | your name (optional) |
| `APP_CURRENCY` | e.g. `USD` or `AED` (optional) |

Do **not** set `PORT`, `DATABASE_URL` or `UPLOAD_DIR`; Railway provides the port and the image sets the rest.

## 4. Get a public URL

Service → **Settings → Networking → Generate Domain**. You get something like
`https://og-system-production.up.railway.app`.

Then add one more variable so the API accepts requests from that address:

| Variable | Value |
|---|---|
| `CLIENT_ORIGIN` | the full https URL you just got (no trailing slash) |

The service redeploys. When the deployment is green, open the URL and sign in with the admin
email and password from step 3.

## 5. First steps in the live app

1. **Users / Clients / Campaigns**: create your first client, campaign and users (see the README, section 2).
2. Production starts **empty on purpose**: the demo data is not loaded.
   If you want the demo data for a look around, open a shell on the service and run `npm run seed`
   (then delete the demo users before real use).
3. Send each client their login and ask them to change the password in **Settings**.

## 6. Backups

- On the service shell run `npm run db:backup` (writes a consistent copy into `/data/backups`).
- Uploaded files are in `/data/uploads`.
- Both live on the volume, so also **download a copy** now and then. With the Railway CLI you can
  open a shell in the running service (`railway ssh`, see `railway --help`) and copy files out.
- A trial is for evaluating. Before you rely on it for client data, decide where the long-term
  home is (a paid Railway plan, a VPS, or your own server) and move a backup there.

## 7. Updating the app later

- GitHub route: `git push` and Railway redeploys automatically.
- CLI route: run `railway up` again.
- Data stays on the volume; new migrations are applied on start.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy fails with "SESSION_SECRET is missing or shorter than 32 characters" | Set `SESSION_SECRET` (step 3). |
| Healthcheck fails | Open the deploy logs. Common causes: no volume at `/data`, or a migration error. |
| Login works but you get logged out or "forbidden" on actions | `CLIENT_ORIGIN` must be exactly your https URL. |
| "Admin ... could not be created" in the logs | `SEED_ADMIN_PASSWORD` is too weak; use 8+ characters with letters and numbers. |
| Forgot the admin password | Shell: `npm run seed:admin -- --reset-password` (uses the `SEED_ADMIN_*` variables). |
| Data disappeared after a redeploy | The volume is missing or not mounted at `/data`. |

## About the free trial

Railway's trial gives a limited amount of credit for a limited time. When it runs out the service
stops unless you upgrade, so watch the usage page. The app is light (one Node process, SQLite),
so it uses very little, but check Railway's current pricing page for the exact terms.
