# TicketBooks — Work Management Platform

A production-grade, Jira-inspired ticketing & work management platform built with Next.js, TypeScript, PostgreSQL and Prisma. Managers assign and track work across their teams; employees manage their assigned work and claim available tickets from a queue — with full audit trails, email notifications, realtime updates and reporting.

---

## Feature overview

| Area | What's included |
| --- | --- |
| **Auth** | Session-based auth (httpOnly cookies, server-side sessions), login/logout, forgot/reset password, change password, account status enforcement, audit of logins/failures |
| **RBAC** | Configurable roles stored as permission arrays (`roles.permissions` JSON). Super Admin (`*`), Manager, Employee seeded. Every API route checks permissions; ticket visibility is scope-filtered per role/team |
| **Tickets** | 9 seeded types (Task, Bug, Story, Improvement, Feature, Support, Request, Epic, Sub-task), rich-text descriptions, labels, story points, sprints, due dates, parent/sub-task hierarchy, watchers, attachments |
| **Numbering** | Per-project atomic counters (`SELECT ... FOR UPDATE`) → `WEB-1001`, `OPS-1024`, ... never duplicated under concurrency |
| **Assignment** | Manager assign/reassign with notifications; self-service **Pick Ticket** with a transactional single-winner guarantee |
| **Workflow** | 9 configurable statuses grouped into TODO / IN_PROGRESS / DONE categories; reopen tracking (`reopenedCount`), resolved/reopened emails |
| **Board** | Kanban with drag-and-drop (@dnd-kit) — dropping a card PATCHes status optimistically with rollback on failure |
| **Backlog** | Sprint vs backlog columns, drag to schedule, type-grouped backlog |
| **Comments** | Threaded replies, edit/delete (soft), `@mention` parsing → immediate mention notification + email |
| **History** | Every field change, comment, attachment, creation and archive recorded in an immutable timeline |
| **Notifications** | In-app center + bell dropdown, unread counts, mark read/all-read, SSE realtime push |
| **Email** | Provider abstraction (console dev logger / SMTP incl. Gmail & M365 app passwords). Durable `EmailEvent` queue with exponential-backoff retries; failures never break business actions. 11 overridable templates with `{{variables}}` |
| **Email-to-ticket** | `POST /api/email/inbound` webhook gateway — new subjects create tickets, `[KEY-1234]` replies become comments (secret-verified) |
| **Search** | Global Ctrl+K command palette; exact-key jump (`STRIKE-1024`), text search across title/description, all scoped by permissions |
| **Reports** | Overview, workload-by-employee, created-vs-completed trend, aging report — filterable by period, CSV export |
| **Dashboards** | Role-aware: managers get team stats/charts/workload; employees get personal stats + available-work callout |
| **Audit logs** | Logins (success/failed), user/team/project changes, settings edits, bulk ops, archives — searchable admin view |
| **UI** | Original enterprise design system, dark/light/system themes, collapsible sidebar, responsive down to mobile, skeletons, empty/error states, toasts |

## Tech stack

- **Next.js 15** (App Router, standalone output) + **React 19** + **TypeScript**
- **Tailwind CSS** design tokens (light/dark)
- **PostgreSQL 16** + **Prisma** ORM
- **@dnd-kit** drag-and-drop, **Recharts** charts, **Lucide** icons
- **bcryptjs** hashing, DB-backed sessions, **nodemailer** SMTP transport
- **Vitest** test suite (29 tests incl. concurrency integration tests)

---

## Getting started

### Prerequisites
- Node.js 20+
- Docker (for the bundled Postgres) *or* any PostgreSQL instance

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` (a working `.env` for local dev is included):

```ini
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ticketing?schema=public"
APP_URL="http://localhost:3000"
SESSION_SECRET="change-me"
EMAIL_PROVIDER="console"        # console | smtp
SMTP_HOST=""  SMTP_PORT="587"  SMTP_USER=""  SMTP_PASSWORD=""
```

### 3. Start Postgres + migrate + seed

```bash
npm run db:up          # docker compose up -d (postgres:16-alpine)
npx prisma migrate dev # apply schema
npm run db:seed        # demo org: 3 teams, 3 projects, 11 users, 30 tickets
```

### 4. Run

```bash
npm run dev            # http://localhost:3000
# or production:
npm run build && npm start
```

### Demo accounts (password: `Password123!`)

| Email | Role | Team |
| --- | --- | --- |
| `admin@strike.io` | Super Admin | — |
| `meera@strike.io` | Manager | Engineering |
| `rohan@strike.io` | Manager | QA |
| `divya@strike.io` | Manager | Support |
| `rahul@strike.io`, `priya@strike.io`, `arjun@strike.io` | Employee | Engineering |
| `sneha@strike.io`, `vikram@strike.io` | Employee | QA |
| `neha@strike.io`, `karan@strike.io` | Employee | Support |

Projects: **WEB** Website, **MOB** Mobile Application, **OPS** Internal Operations.

---

## Tests

```bash
npm test
```

Covers: RBAC permission matrix, visibility scoping rules, @mention extraction, utils, email provider abstraction/template rendering/queue durability, bcrypt roundtrip, plus **database integration tests**:

- **Claim concurrency**: two simultaneous claims → exactly one winner, one `CONFLICT`
- **Ticket numbering**: 8 concurrent creates under `FOR UPDATE` → contiguous unique keys

An end-to-end HTTP smoke script exercising the full manager→employee flow lives at `tests/smoke-test.ps1` (run against a started server).

---

## Email setup

- `EMAIL_PROVIDER=console` (default) prints emails to the server log and records every message in the `EmailEvent` table — zero config.
- `EMAIL_PROVIDER=smtp` uses Settings → **Email** (admin UI) or env vars. Works with Gmail/Google Workspace and Microsoft 365 via SMTP app passwords (e.g. `smtp.gmail.com:587`, `smtp.office365.com:587`).
- Delivery failures are retried with capped exponential backoff (max 5 attempts) by a background worker (`src/instrumentation.ts`). Application actions never fail because of email outages.
- Administrators can edit all 11 notification templates with `{{ticket_key}}`, `{{assignee_name}}`, etc. via the `templates` setting row.

## Email-to-ticket

Point your inbound mail webhook (SendGrid Inbound Parse, AWS SES receipt rule, Mailgun routes, or a small IMAP poller) at:

```
POST /api/email/inbound
x-strike-inbound-secret: <INBOUND_EMAIL_SECRET>
{ "from": "customer@example.com", "to": "support@yourdomain.com", "subject": "...", "textBody": "..." }
```

- New subject → ticket created in the configured inbound project (Settings → Organization → *Inbound email project key*)
- Subject containing `[WEB-1002]` → authenticated sender's reply becomes a ticket comment; unknown senders are only logged

## Switching to Supabase

The app talks to PostgreSQL exclusively through Prisma, and Supabase *is* PostgreSQL — no code changes are needed, only configuration. Two connection URLs are used (see `prisma/schema.prisma`):

| Env var | Used for | Supabase connection type |
| --- | --- | --- |
| `DATABASE_URL` | app runtime queries | **Pooled** — port `6543`, keep `?pgbouncer=true` |
| `DIRECT_URL` | `prisma migrate` commands | **Direct/session** — port `5432` |

**Steps**

1. Create a project at [supabase.com](https://supabase.com), then open **Project Settings → Connect** (or the **Connect** button on the project home).
2. Copy both strings into `.env`:
   ```ini
   # runtime - pooled via PgBouncer
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"
   # migrations - session/direct connection
   DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
   ```
3. Create the schema and (optionally) load demo data:
   ```bash
   npx prisma migrate deploy   # applies prisma/migrations to Supabase
   npm run db:seed             # optional demo organization
   ```
4. Restart the app. Verify with `npx prisma migrate status`.

**Notes**
- `pgbouncer=true` tells Prisma to skip prepared statements required by Supabase's transaction-mode pooler. Interactive transactions (ticket numbering locks, atomic claims) work through it.
- Keep `DIRECT_URL` secret too — it allows schema changes.
- Migrating existing data instead of reseeding: dump from local (`docker exec strike-db pg_dump -U postgres -d ticketing`) and restore into Supabase's SQL editor / `psql`, or just reseed if you only have demo data.
- Optional next steps once on Supabase: move attachment storage from disk to Supabace Storage buckets (`src/app/api/tickets/[key]/attachments/route.ts` is the single file to swap) and point the inbound-email webhook at Supabase Edge Functions.

## Deploying to Vercel (with GitHub)

The stack is Vercel-native: push to GitHub → import the repo at vercel.com → add env vars → deploy. Supabase stays as the external database.

**1. Push to GitHub**

```bash
git init
git add .
git commit -m "TicketBooks work management platform"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

**2. Import on Vercel** — "Add New Project" → select the repo → Framework preset: Next.js (auto-detected). `postinstall` runs `prisma generate` automatically.

**3. Environment variables** (Project Settings → Environment Variables):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | your Supabase pooled URL (port 6543, keep `?pgbouncer=true&connection_limit=1`) |
| `DIRECT_URL` | same credentials, session port 5432 |
| `APP_URL` | `https://<your-project>.vercel.app` (or custom domain) — used in email links |
| `SESSION_SECRET` | long random string |
| `EMAIL_PROVIDER` | `console` or `smtp` (+ `SMTP_*` vars) |
| `CRON_SECRET` | any random string — secures the background-jobs endpoint |
| `SUPABASE_URL` | `https://<ref>.supabase.co` (only for attachments) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (only for attachments) |
| `SUPABASE_STORAGE_BUCKET` | `attachments` (create it as a **private** bucket) |

**4. Background jobs.** Serverless functions can't run timers, so the SLA breach scanner and email retries are exposed as a secured endpoint (`GET /api/cron`, Bearer-authenticated via `CRON_SECRET`). Two scheduling options:

- **Vercel Cron**: already configured in `vercel.json` (`*/10 * * * *`). On Hobby plans scheduled crons are limited to daily frequency.
- **GitHub Actions** (any plan, every 15 min): `.github/workflows/sla-cron.yml` is included — add `APP_URL` and `CRON_SECRET` as repository secrets and enable the workflow.

On self-hosted/long-running servers no cron is needed; the workers start automatically with the app.

**Platform notes**

- Attachments: serverless filesystems are ephemeral, so configure the three `SUPABASE_STORAGE_*` variables to store files in a private bucket (the code switches automatically; local disk remains the default when unset).
- Request body size: Vercel caps uploads at ~4.5 MB per request regardless of `MAX_UPLOAD_MB`.
- Realtime notifications use SSE; on serverless the stream recycles at function timeouts and EventSource reconnects automatically — updates stay near-realtime.



1. Provision PostgreSQL and set `DATABASE_URL`.
2. Set a strong `SESSION_SECRET`; set `APP_URL` to the public HTTPS URL (session cookies auto-enable `secure`).
3. `npx prisma migrate deploy && npm run build`.
4. `output: "standalone"` produces `.next/standalone` for containerized deploys: `node .next/standalone/server.js`. Any Node host works (`npm start`).
5. Mount a persistent volume for uploads or swap `src/app/api/tickets/[key]/attachments` storage for S3 (single file).
6. The SSE endpoint (`/api/events`) requires buffering disabled on reverse proxies (`X-Accel-Buffering: no` header is already sent; disable proxy buffering for `/api/events`).

## AI tools (MCP server)

Strike exposes a remote MCP server at `/api/mcp` so Claude Code (or any MCP client) can do everything the web app does: tickets, comments, attachments, projects, teams, users, notifications, reports, audit and settings (45 tools, `src/lib/mcp/tools.ts`).

```bash
claude mcp add --transport http strike https://<your-domain>/api/mcp
# then inside Claude Code: /mcp -> strike -> Authenticate
```

The browser opens the Strike login; after signing in, the user approves the tool and Claude Code receives a token. Access rules:

- Only signed-in Strike users can connect (OAuth 2.1 + PKCE). Disabled users lose access immediately.
- Each tool runs the same route handler as the web app, so the AI has exactly the user's role permissions.
- Optional `ALLOWED_EMAIL_DOMAINS="acme.com,acme.io"` restricts AI access to company email domains.
- Self-registered clients may only redirect to `http://localhost` (CLI tools like Claude Code). Web-based clients need their callback host in `MCP_ALLOWED_REDIRECT_HOSTS` (e.g. `claude.ai` for claude.ai connectors); this blocks consent-phishing via look-alike apps.
- Tokens are stored hashed; access tokens last 1 hour (auto-refreshed), refresh tokens 30 days and rotate on use.
- Connects/disconnects are audit-logged. Revoke with the `disconnect_ai_tool` tool or `DELETE /api/oauth/connections?clientId=...`.
- Requires the `20261019000000_mcp_oauth` migration (`npx prisma migrate deploy`).

## Security model

- Passwords hashed with bcrypt (cost 10); reset tokens stored hashed with single-use semantics and session invalidation
- Session cookies: httpOnly, SameSite=Lax, Secure in production; sessions are server-side rows (revocable)
- Rate limiting on auth endpoints (10/min) and per-user API throttling
- Zod validation on every mutating endpoint; parameterized queries via Prisma; no raw error leakage
- File uploads: extension whitelist, size cap, random storage names outside web root, download authorization
- Authorization checked server-side on every route; frontend permissions are cosmetic only
- Audit log is append-only; deleting users preserves ticket history via `SetNull` foreign keys

## Project structure

```
prisma/schema.prisma       # 26-table relational schema
prisma/seed.ts             # realistic demo organization
src/lib/
  auth/session.ts          # session create/read/destroy
  rbac.ts                  # permission checks + visibility scopes
  tickets/service.ts       # create/update/claim/comment/watch domain logic
  email/                   # provider abstraction, templates, retrying queue
  events.ts                # in-process pub/sub for SSE fanout
src/app/api/…              # REST endpoints (see spec §33 mapping)
src/app/(app)/…            # dashboard, my-work, tickets, board, backlog,
                           # available-work, projects, reports, users, teams,
                           # notifications, settings, audit-logs
tests/                     # vitest unit + DB integration + E2E smoke script
```
