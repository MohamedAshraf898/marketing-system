# OG System

A complete **Agency Management & Client Operations Platform** for a digital marketing agency: CRM, projects, tasks, a content calendar with visual creative proofing, client onboarding, contracts, invoices, time tracking, team workload, reporting/analytics and a client portal — all in one self-hosted app. Your team runs the whole client lifecycle (lead → onboarding → projects/campaigns → content → approval → reporting → invoicing); your clients log in to a private portal to review work, **approve or request changes**, send requests, and see their own performance numbers, files, contracts and invoices.

- **Free and self-hosted.** No paid SaaS, no external database, no third-party auth, no Stripe/payments. SQLite + local file storage.
- **English and Arabic** (full right-to-left layout). Each user picks their language; it is saved on their account.
- **Three roles — Admin, Team, Client** — plus **granular permissions** for Team members (see §5), enforced on the server for every request, never just in the UI.

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide icons |
| Backend | Node 20+, Express, TypeScript (run with `tsx`, no build step), Zod validation |
| Database | SQLite through Prisma (libSQL driver adapter) |
| Auth | Email + password (bcrypt), random session token in an HTTP-only cookie |
| Files | Local disk behind a storage interface (S3-ready) |

---

## 1. Quick start

You need **Node.js 20 or newer**. Then:

```bash
npm install
npx prisma migrate dev     # creates prisma/dev.db and applies the schema
npm run seed               # demo data + demo logins (development only)
npm run dev                # API on :4000, web app on :5173
```

Open **http://localhost:5173**.

Before the first run, create your `.env`:

```bash
cp .env.example .env
# put a long random value in SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Shortcut that does all of the above (creates `.env` with a random secret, applies migrations, seeds):

```bash
npm install
npm run setup
npm run dev
```

### Demo logins (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@og-system.local` | `Admin#12345` (from `SEED_ADMIN_PASSWORD` in `.env`) |
| Team | `sara@demo.local` | `Demo#12345` - assigned to *Lumen Coffee Roasters* |
| Team | `omar@demo.local` | `Demo#12345` - assigned to *Al-Ufuq* + one Lumen campaign (Arabic user) |
| Client | `lumen@demo.local` | `Demo#12345` - Lumen Coffee Roasters |
| Client | `ufuq@demo.local` | `Demo#12345` - Al-Ufuq (Arabic user) |

All seeded companies, campaigns, files and report rows are clearly labelled **DEMO**. The seed refuses to run when `NODE_ENV=production`. Change or delete these accounts (and the passwords in `.env`) before real use. Never keep demo passwords on a server that is reachable from the internet.

Re-seed from scratch at any time: `npm run seed -- --reset`.

---

## 2. Everyday tasks

### Create the first admin (production or fresh install, no demo data)

```bash
# 1. set SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_PASSWORD in .env
npx prisma migrate deploy
npm run seed:admin
```

Forgot the admin password? Put a new one in `.env` and run `npm run seed:admin -- --reset-password` (signs that admin out everywhere).

### Add a client (Admin)

1. **Clients → New client.** Fill in company, contact person, email (logo optional).
2. **Users → New user**, role **Client**, pick the company. Give that person the email + a strong password. They can change it under *Settings*.
   A client user only ever sees their own company's data.

### Add a team member (Admin)

**Users → New user**, role **Team**, then tick either whole **clients** (sees everything for that client) or **individual campaigns** (sees only those campaigns). A team member with no assignment sees nothing.

### Create a campaign (Admin)

**Campaigns → New campaign**: client, platform, objective, dates, budget. Team members can move a campaign through its statuses (Planning → Pending approval → Running → Paused → Completed) from the campaign page.

### Add performance numbers

Staff use **Reports → Add report** (or the *Reports* tab of a campaign) to enter **one row per campaign per day**: spend, reach, impressions, clicks, conversions, conversion value. CTR, CPC, CPM and ROAS are **calculated by the server** so they can never disagree with the raw numbers. The campaign's "spent" total is kept in sync automatically. Nothing on the reports pages is generated or invented - if there are no rows, you see an empty state. The `ReportSource` hooks in `server/src/integrations/` are where Meta / Google / TikTok imports would plug in later.

---

## 3. The approval workflow

```
DRAFT ──submit──▶ PENDING_APPROVAL ──client approves──────────▶ APPROVED ──▶ PUBLISHED
                        │
                        └─client requests changes──▶ CHANGES_REQUESTED
                                                            │
                                    team: "Create new version" (v+1, back to DRAFT)
```

1. **Team creates a deliverable** (design, video, reel, story, copy, banner) as a **draft**. Add a preview link, a description and/or upload files. Drafts are invisible to the client.
2. **Team clicks "Send for approval".** The version becomes visible to the client and is locked (no edits, no file changes). The client gets a notification.
3. **The client reviews** the preview, files and comments, then either
   - **Approve** (comment optional), or
   - **Request changes** (a comment is **required**).
   Only client users can decide - admins and team members cannot approve on the client's behalf.
4. After *Changes requested*, the team clicks **Create new version** → v2 (a new draft). They upload the new files and send it again. This repeats (v1 changes → v2 changes → v3 approved).
5. **The approval history is append-only.** Every submission and every decision is a new row in the `Approval` table with version, person, comment and timestamp. Nothing is ever updated or deleted, and the full timeline is shown on the review page.
6. After approval the team can mark the deliverable **Published**.

Comments (client and team) are available on every deliverable and request.

---

## 4. Agency management (CRM, projects, content, contracts, time…)

Everything below sits on top of the same authorization model as the approval workflow: every new endpoint is scoped to the caller's clients/campaigns and checked against granular permissions (§5), and nothing internal is ever sent to a CLIENT session, however it's fetched.

- **CRM.** Each client has full company info (industry, website, address, lead source, account manager, client type, tags), a lifecycle **status** (`LEAD → PROSPECT → ONBOARDING → ACTIVE → PAUSED → COMPLETED → ARCHIVED`), contract dates, monthly retainer and **internal notes** — all staff-only fields, never sent to the client's own session. The **Client details** page has tabs for Overview, Contacts, Projects, Campaigns, Tasks, Deliverables, Requests, Reports, Files, Invoices, Contracts, Onboarding, Internal notes and Activity (a client user sees the same page with the internal-only tabs removed by the server, not just hidden by the UI).
- **Contacts.** A company can have several contacts (job title, email, phone, WhatsApp, one marked primary). Each contact can be flagged **visible to client** or kept internal.
- **Projects & milestones.** Client work is grouped into projects (Website redesign, SEO, Social media management, …) with status, priority, a project manager, milestones, a budget (staff-only) and a computed progress percentage. A project can be internal-only (`visibleToClient=false`).
- **Tasks.** Full internal task management — assignee, priority, status (`TODO → IN_PROGRESS → REVIEW/BLOCKED → DONE`), due dates, checklists (sub-tasks), comments and file attachments. **My Tasks** has List, Kanban and Calendar views. Tasks are agency-internal: a CLIENT session can never see a task, in any endpoint.
- **Content calendar.** Plan social/marketing content per client/campaign (platform, type, caption, publish date, assignee) with Calendar, Kanban and List views. **"Send for client approval"** creates a normal `Deliverable` behind the scenes and reuses the existing append-only approval workflow (§3) — there is no second approval system. The content item's status stays in sync with the deliverable's decision automatically.
- **Creative proofing.** On the deliverable review page, clients (and staff) can click anywhere on an image to drop a numbered pin comment ("change this headline") or add a timestamped comment on a video ("00:14 — please change this scene"). Pins never touch the approval record itself — they're a separate, purely additive comment thread.
- **Client onboarding.** When a client becomes `ONBOARDING`/`ACTIVE`, a checklist is created automatically (company info, logo, brand guidelines, ad account access, kickoff meeting, …). The **Onboarding dashboard** shows every client's progress bar (0–100%), next pending step and overdue items.
- **Contracts & invoices.** Internal agency invoicing and contract tracking — **no Stripe, no online payments**. Contract/invoice numbers are generated by the server (`CT-2026-0001`, `INV-2026-0001`); an invoice's `total` is always computed server-side (`amount + tax`), never trusted from the client. A background job flags contracts `EXPIRING`/`EXPIRED` and invoices `OVERDUE`, and notifies staff.
- **Time tracking & workload.** Team members can start/stop a timer against a task, project or client (one running timer per person; duration is always computed server-side). **My Time** and a **Client Time Report** (with CSV export) show the totals. **Team workload** is a capacity indicator (estimated hours vs. a 40 h/week capacity) — explicitly *not* a performance rating.
- **Global search & unified calendar.** `Ctrl/Cmd+K` searches clients, projects, tasks, campaigns, deliverables, content, requests, invoices, contracts and files — each type is only searched if the caller may see that type at all, and results never cross a client boundary. The calendar overlays task/project/milestone due dates, content publish dates, campaign start/end and contract/invoice dates, with a type filter.
- **Advanced reporting.** Campaign and client performance tables, a period-comparison view (this vs. last month/quarter, or a custom range) that never invents a number it can't compute (missing data shows "—", not 0), and CSV export (BOM + formula-injection safe) plus a print-optimized page for PDF export via the browser's own "Print → Save as PDF".
- **Branding.** Admins can set the agency name, logo, favicon and brand colour from *Settings*; it appears on the login page and sidebar for everyone.
- **Notification center.** Unread count, mark-as-read/mark-all-read, and history, covering every event above (task assigned/due, contract expiring, invoice overdue, content sent for approval, report available, …) in addition to the original approval/request/comment notifications.

---

## 5. Who can do what

| | Admin | Team | Client |
|---|:-:|:-:|:-:|
| Users, clients, campaigns (create / edit / delete) | ✅ | - | - |
| See clients & campaigns | all | assigned only | own company |
| Create deliverables, upload files, submit for approval | ✅ | ✅ (in scope) | - |
| Approve / request changes | - | - | ✅ (own company) |
| Requests: create | ✅ | ✅ | ✅ (with attachment) |
| Requests: change status / assignee / priority | ✅ | ✅ | cancel own only |
| Reports: view | all | in scope | own company |
| Reports: add / delete | ✅ | ✅ (in scope) | - |
| Files: view / download | all | in scope | own company, "visible to client" only |
| Tasks, internal notes, onboarding checklist, time tracking, workload | ✅ | with permission | never — internal only |
| Contracts, invoices | ✅ | with permission (`contracts.*`, `invoices.*`) | own company, shared items only |
| Audit log | ✅ | - | - |

Enforcement lives in the API, not in the screens. Hiding a button is only convenience.

**Granular Team permissions.** Beyond the three roles, each Team member additionally has a set of permissions from `shared/src/permissions.ts` (grouped: clients, projects, tasks, campaigns, content, deliverables, reports, finance, files, time, system). New Team members get a sensible default set (day-to-day client/project/task/content/reports work); an Admin can grant/revoke individual permissions from **Users → Permissions**. Money (`invoices.*`, `contracts.*`), people-cost data (`time.view_all`, `workload.view`) and deletions are opt-in. `audit_logs.view` is Admin-only and can never be granted to a Team member. A CLIENT session never carries any permission, however it's requested — the server ignores anything stored for a client account.

---

## 6. Security model

- **Authorization on every endpoint:** session → user → role → *scope* (which clients/campaigns this user may touch). Records are always looked up together with the scope (`findFirst({ id, ...scope })`), so someone else's record simply "does not exist" (404) - no ID guessing (IDOR), no information leak.
- **Never trusting the browser:** `clientId`, `userId` and `authorType` of every new record are derived on the server from the session and the parent record. Extra fields in a request are rejected (`strict` schemas).
- **Sessions:** 48 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only an HMAC of the token is stored in the database, so a leaked database cannot be replayed as sessions. Users are re-checked on every request, so deactivating a user or archiving a client takes effect immediately. Password change/reset signs out other devices.
- **Login:** bcrypt (cost 12), constant-time-ish failure path, rate limiting, generic error messages. CSRF is covered by SameSite cookies + an `Origin` check on every write.
- **Uploads:** size limit, extension allowlist, MIME type, **magic-byte check**, dangerous double extensions blocked, filenames replaced by random keys, files stored **outside any public folder**, and served only through `/api/files/:id/download` after the same authorization check (with `nosniff`; only images/PDF may render inline). No executables, scripts or SVG.
- **Headers:** Helmet with a strict Content-Security-Policy. Errors return a stable `code` and a friendly message - never a stack trace.
- **Internal data stays internal:** internal notes, tasks, the onboarding checklist, time entries, workload, and every "internal" field on a client/contact/contract/invoice/content item (retainer, budget, notes, …) are excluded from CLIENT responses by an explicit server-side whitelist (`services/clientDto.ts` and per-resource DTOs), not by hiding fields in the UI.
- **Audit log:** logins, creations, status changes, submissions, approvals, uploads, deletions, permission changes and more (admin-only page). It doubles as each client's client-safe **activity timeline** (only rows explicitly marked client-visible are shown, and never to a different client).
- **Tests:** `npm test` runs 316 tests across authentication, client isolation, team assignment scoping, IDOR attempts, upload rules, the append-only approval workflow (versioning, role restrictions, race safety), internal-notes/task/contract/invoice permission boundaries, and the rest of the agency-management features above.

---

## 7. Languages (English / Arabic)

- Switch language from the top bar or *Settings*. The choice is saved on the user's account, and applies at the next login.
- Arabic switches the whole layout to right-to-left (logical CSS properties everywhere; charts keep their internal left-to-right axes). Numbers use Western digits (0-9) so that they match charts and phone numbers; switch to Arabic-Indic digits by changing one line in `client/src/i18n/index.tsx`.
- Dictionaries: `client/src/i18n/en.ts` and `ar.ts`. They are typed so the build fails if a key is missing in Arabic. API errors, validation messages, notifications and every status label are translated from stable codes.
- To add a language: add a dictionary file, register it in `i18n/index.tsx`, and add the code to `LOCALES` in `shared/src/enums.ts`.

---

## 8. Project structure

```
og-system/
├─ client/            React app (Vite)
│  └─ src/
│     ├─ api/         fetch client, react-query hooks, types
│     ├─ auth/        session context
│     ├─ i18n/        en.ts, ar.ts, formatters, error translation
│     ├─ components/  ui/ (design kit), layout/ (shell, search, notifications, branding), panels/ (embeddable lists), forms/, shared/, content/, finance/, tasks/, insights/
│     └─ pages/       dashboard, clients, onboarding, projects, tasks, campaigns, content, deliverables,
│                     approvals, requests, reports, search, calendar, contracts, invoices, time, workload,
│                     files, audit, users, settings, notifications
├─ server/            Express API
│  └─ src/
│     ├─ auth/        password hashing, sessions, middleware, /auth + /me
│     ├─ authz/       scope.ts (who may see what per resource) + permissions.ts (granular Team permissions)
│     ├─ routes/      one file per resource (clients, contacts, onboarding, internal-notes, activity, projects,
│     │               tasks, content, contracts, invoices, time, workload, search, calendar, analytics,
│     │               branding, permissions, users, deliverables, requests, reports, files, notifications, …)
│     ├─ services/    approval/content-approval sync, proofing, reports & analytics maths, maintenance
│     │               (contract/invoice/task reminders), notifications, audit, dashboard, branding
│     ├─ storage/     StorageProvider + LocalStorage (+ S3 placeholder), upload validation
│     ├─ integrations/ interfaces for Meta/Google/TikTok Ads, GA, WhatsApp, Email, Slack (not implemented)
│     ├─ seed/        demo data (seed.ts + one seeder per feature area) and admin seed
│     └─ test/        vitest suites (316 tests)
├─ prisma/            schema.prisma + migrations/
├─ shared/            enums and permission catalog shared by API and web
├─ uploads/           uploaded files (git-ignored, never served statically)
├─ backups/           SQLite backups (git-ignored)
└─ scripts/           setup.mjs, backup-db.mjs
```

API overview (all under `/api`, JSON): `POST /auth/login`, `POST /auth/logout`, `GET|PATCH /me`, `GET /dashboard`, `/clients` (+ `/:id/contacts`, `/:id/onboarding`, `/:id/internal-notes`), `/contacts`, `/onboarding`, `/internal-notes`, `/activity`, `/users`, `/team-members`, `/permissions`, `/projects` (+ `/:id/milestones`), `/tasks` (+ `/:id/checklist`, `/:id/comments`), `/time` (+ `/timer/start|stop`, `/entries`, `/my`, `/report/client/:id`), `/workload`, `/campaigns`, `/content` (+ `/:id/send-for-approval`), `/deliverables` (+ `/:id/submit|new-version|publish|approve|request-changes|approvals|comments|proofing`), `/approvals`, `/requests` (+ `/:id/comments`), `/files` (+ `/:id/download`), `/contracts`, `/invoices`, `/reports`, `/analytics` (+ `/compare`, `/export.csv`), `/search`, `/calendar`, `/notifications`, `/audit-logs`, `/branding`.

---

## 9. Backups

The whole system is **one SQLite file plus the `uploads/` folder**.

```bash
npm run db:backup          # consistent snapshot -> backups/og-system-<timestamp>.db (safe while the app runs)
cp -r uploads backups/uploads-$(date +%F)     # files (or rsync it somewhere else)
```

Restore: stop the app, copy a snapshot over `prisma/dev.db` (or whatever `DATABASE_URL` points to), restore `uploads/`, start the app. Automate with cron, e.g. daily at 03:00:
`0 3 * * * cd /srv/og-system && npm run db:backup && rsync -a backups/ user@backup-host:og-backups/`.

---

## 10. Deploying later

> **Want it online quickly?** See [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md) for a step-by-step guide (Dockerfile, volume and variables are already included).

One Node process serves both the API and the built web app, so a small VPS (1 GB RAM) is enough.

```bash
git clone <your repo> && cd og-system
npm ci
cp .env.example .env        # then edit - see below
npx prisma migrate deploy   # apply migrations (never `migrate dev` in production)
npm run seed:admin          # create the first admin from .env
npm run build               # builds client/dist
npm start                   # NODE_ENV=production, serves API + web on $PORT
```

Production `.env` checklist:

- `SESSION_SECRET` - new 48-byte random value (never reuse the development one)
- `COOKIE_SECURE=true` and serve over **HTTPS** (Caddy or Nginx in front of `localhost:4000`, both give free Let's Encrypt certificates)
- `CLIENT_ORIGIN=https://your-domain.com`
- `DATABASE_URL="file:/var/lib/og-system/app.db"` and `UPLOAD_DIR=/var/lib/og-system/uploads` (absolute paths outside the code folder, on a disk you back up)
- Remove the `SEED_DEMO_PASSWORD`, and do **not** run `npm run seed` (it refuses in production anyway)

Keep it running with **pm2** (`pm2 start npm --name og-system -- start`) or a **systemd** service. Minimal Caddy example:

```
your-domain.com {
  reverse_proxy localhost:4000
}
```

Updating: `git pull && npm ci && npx prisma migrate deploy && npm run build`, then restart. **Updating from a pre-agency-management install:** this release adds many new tables (projects, tasks, content calendar, contracts, invoices, time entries, onboarding, …) via one new migration — `npx prisma migrate deploy` applies it automatically and does **not** touch any existing client, campaign, deliverable, approval, request, report or file data. New Team members default to a standard permission set (§5); grant the money/finance and delete permissions to whoever needs them from **Users → Permissions**.

**Moving to object storage (S3, R2, MinIO, …):** implement the four methods of `server/src/storage/S3Storage.ts` and switch one line in `storage/index.ts`. The database stores opaque keys only, so nothing else changes.
**Moving to PostgreSQL:** change `provider` in `prisma/schema.prisma`, use the Prisma Postgres setup, run a fresh migration. (Enums are native there.)

---

## 11. Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (:4000) + web app (:5173) with hot reload |
| `npm run build` / `npm start` | production build / production server |
| `npm run setup` | first-time setup (`.env`, migrations, demo data) |
| `npm run seed` / `seed -- --reset` | demo data (dev only) |
| `npm run seed:admin` | create or recover the admin from `.env` |
| `npm test` | 316 API tests (authorization, isolation, approvals, uploads, agency-management features…) |
| `npm run typecheck` | TypeScript check of server and client |
| `npm run db:backup` | timestamped SQLite snapshot |
| `npm run db:studio` | browse the database (Prisma Studio) |
| `npm run db:migrate` | `prisma migrate dev` after you edit `schema.prisma` |

## 12. Notes and limits

- **Integrations** (Meta Ads, Google Ads, TikTok Ads, Google Analytics, WhatsApp, email, Slack) are defined as TypeScript interfaces with a no-op registry in `server/src/integrations/`. Nothing is connected yet; report numbers are entered by staff.
- **Email is not sent** - notifications are in-app (bell + notifications page). The `EmailProvider` interface is ready for an SMTP implementation.
- **Reports aggregate in memory** (capped at 20,000 rows per query), which is plenty for an agency-sized dataset. If you outgrow it, move the sums into SQL.
- **PDF export** is a print-optimized page (`/reports/print`) plus the browser's own "Print → Save as PDF" — no server-side PDF library, so it needs no extra dependency and always matches what's on screen. CSV export is available everywhere a table can be exported.
- **No payments.** Invoices and contracts are internal record-keeping only — there is no Stripe integration, no payment collection, and no client-facing "pay now" button.
- Single-tenant by design: one agency, many clients — not a multi-tenant SaaS product (no plans, no billing, no super-admin).

## 13. Troubleshooting

- **"SESSION_SECRET is missing or shorter than 32 characters"** - create `.env` (`npm run setup` or copy `.env.example`) and set a long random secret.
- **Password with `#` not working in `.env`** - wrap it in quotes: `SEED_ADMIN_PASSWORD="Admin#12345"`.
- **Login works but you are logged out on refresh in production** - you are on plain HTTP with `COOKIE_SECURE=true`. Use HTTPS (or `COOKIE_SECURE=false` on a private network only).
- **Port already in use** - change `PORT` in `.env` (and `CLIENT_ORIGIN`/the Vite proxy target in `client/vite.config.ts` in development).
- **Start over** - stop the app, delete `prisma/dev.db*` and `uploads/*`, then `npx prisma migrate dev && npm run seed`.
# marketing-system
