# SecureITLab Leave Tracker

Employee leave management for **SecureITLab**, integrated with the existing **Secureitlab** Slack workspace (`secureitlabhq.slack.com`).

| Layer | Choice |
|-------|--------|
| App | Next.js 15 (App Router) |
| Database | Supabase PostgreSQL (Prisma) |
| Dashboard auth | Auth.js (email/password) |
| Employee UX | Slack App **SecureITLab Leave Tracker** |
| Hosting | Vercel (recommended) — no Docker |

---

## How the system works

There are **two interfaces**:

### 1. Web dashboard (admins / HR / managers)

Used mainly by **SUPER_ADMIN**, **HR_ADMIN**, and **MANAGER** at `/leave/*`.

| Who | What they do in the dashboard |
|-----|-------------------------------|
| **SUPER_ADMIN / HR_ADMIN** | Employees, Slack mapping, leave types, policies, holidays, all requests, reports, audit logs |
| **MANAGER** | Team leave requests, approve/reject, team calendar/reports |
| **EMPLOYEE** | Can log in, but day-to-day leave is intended via **Slack** (apply, balance, history, holidays) |

Employees do **not** need the web dashboard for normal leave. They use Slack.

### 2. Slack (employees + managers)

Inside the existing Secureitlab workspace (no new workspace):

```
Employee → #leave-tracker or /leave
        → Apply Leave modal
        → Backend validates + creates PENDING
        → Manager gets Slack DM with Approve / Reject
        → Balance + audit updated
        → Employee notified in Slack
```

Employees can also:

- Check **My Balance**
- Check **My Leave History**
- View **Upcoming Holidays**

Sensitive leave reasons are **not** posted publicly in `#leave-tracker`.

### Data flow

```
Slack (/leave, buttons, modals)
        │
        ▼
Next.js API  /api/slack/*
        │
        ▼
Leave services (validation, working days, balances, audit)
        │
        ▼
Supabase PostgreSQL (Prisma)

Web dashboard /leave/*
        │
Auth.js session + RBAC
        │
        ▼
Next.js API  /api/leaves, /api/employees, ...
```

---

## Who uses what?

| Role | Primary UI | Access |
|------|------------|--------|
| SUPER_ADMIN | Web dashboard | Everything |
| HR_ADMIN | Web dashboard | Employees, leaves, holidays, policies, reports, Slack mapping |
| MANAGER | Slack DMs + web dashboard | Own team only |
| EMPLOYEE | Slack (`/leave`, `#leave-tracker`) | Own leave, balance, history, holidays |

---

## Local setup (Supabase — no Docker)

```bash
cp .env.example .env
# Fill DATABASE_URL + DIRECT_URL from Supabase → Settings → Database
# Fill NEXT_PUBLIC_SUPABASE_* from Supabase → Settings → API Keys

npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Open http://localhost:3000

| Email | Password | Role |
|-------|----------|------|
| admin@secureitlab.com | Admin@123 | SUPER_ADMIN |
| hr@secureitlab.com | Admin@123 | HR_ADMIN |
| amit@secureitlab.com | Admin@123 | MANAGER |
| rahul@secureitlab.com | Admin@123 | EMPLOYEE |

---

## Environment variables

See [`.env.example`](.env.example).

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | Supabase → Database → URI (**Transaction** pooler, port `6543`) |
| `DIRECT_URL` | Supabase → Database → URI (**Direct**, port `5432`) — for Prisma migrations |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key |
| `NEXTAUTH_URL` | Local: `http://localhost:3000` · Prod: your Vercel URL |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | Long random secrets for Auth.js |
| `SLACK_BOT_TOKEN` | Slack App → OAuth → Bot User OAuth Token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack App → Basic Information |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Slack App credentials |
| `SLACK_APP_TOKEN` | Optional (Socket Mode) |
| `SLACK_LEAVE_CHANNEL_ID` | Channel ID of `#leave-tracker` (see below) |
| `BACKEND_URL` / `FRONTEND_URL` | Same as public app URL in production |

Never commit DB passwords or Slack secrets. Never put the Supabase **secret** key in `NEXT_PUBLIC_*`.

---

## How to get `SLACK_LEAVE_CHANNEL_ID`

The app uses the **channel ID**, not the name `#leave-tracker`.

### Method A — Slack desktop / web (easiest)

1. Open the **Secureitlab** workspace.
2. Open channel **`#leave-tracker`** (create it if it does not exist).
3. Click the channel name at the top → **About** / **View channel details**.
4. Scroll to the bottom — copy **Channel ID** (starts with `C`, e.g. `C08ABCD12EF`).
5. Put it in `.env`:

```env
SLACK_LEAVE_CHANNEL_ID=C08ABCD12EF
```

### Method B — From channel link

1. Right-click `#leave-tracker` → **Copy link**.
2. Link looks like:  
   `https://secureitlabhq.slack.com/archives/C08ABCD12EF`
3. The part after `/archives/` is the channel ID.

### Method C — After creating the channel

1. Create `#leave-tracker` in Secureitlab.
2. Invite the Leave Tracker bot: `/invite @SecureITLab Leave Tracker`
3. Copy the Channel ID as above into `SLACK_LEAVE_CHANNEL_ID`.
4. Restart the app, then (as admin) call `POST /api/slack/welcome` to post the welcome message.

---

## Slack App setup (Secureitlab workspace)

A workspace Owner/Admin must:

1. Open [https://api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → **From scratch**
3. Name: **SecureITLab Leave Tracker**
4. Workspace: existing **Secureitlab** (do **not** create a new workspace)
5. **OAuth & Permissions** → Bot scopes below
6. **Event Subscriptions** →  
   `https://YOUR-DOMAIN.com/api/slack/events`
7. **Interactivity** →  
   `https://YOUR-DOMAIN.com/api/slack/interactions`
8. **Slash Command** `/leave` →  
   `https://YOUR-DOMAIN.com/api/slack/commands`
9. **Install App** to Secureitlab → copy Bot Token + Signing Secret into `.env`
10. Create `#leave-tracker`, invite the bot, set `SLACK_LEAVE_CHANNEL_ID`

Local Slack testing needs an HTTPS tunnel (ngrok/cloudflared) pointing at your machine.

### Required Bot Token Scopes

- `commands`
- `chat:write`
- `im:write`
- `im:history`
- `users:read`
- `users:read.email`
- `channels:read`
- `channels:join` (optional if you invite the bot manually)

---

## Dashboard pages (web)

| Path | Purpose |
|------|---------|
| `/leave/dashboard` | KPI cards + charts |
| `/leave/requests` | View / approve / reject / cancel |
| `/leave/employees` | Employees, managers, Slack user mapping |
| `/leave/balances` | Leave balances |
| `/leave/holidays` | Public / festival / optional holidays |
| `/leave/types` | Leave types |
| `/leave/policies` | Allocations and rules |
| `/leave/calendar` | Who is on leave + holidays |
| `/leave/reports` | Reports + CSV/Excel export |
| `/leave/audit-logs` | Audit trail |

---

## API overview

**Slack**

- `POST /api/slack/events`
- `POST /api/slack/interactions`
- `POST /api/slack/commands`
- `POST /api/slack/welcome`

**REST** (session auth)

- Leaves: list/create/approve/reject/cancel
- Balances, holidays, types, policies, employees, Slack sync/map
- Reports + export, dashboard, calendar, audit, health

---

## Business rules

- Working days calculated on the server (weekends + non-optional holidays excluded; half-day = 0.5)
- PENDING reserves balance; APPROVED moves pending → used; REJECTED releases pending
- Managers only act on their team; admins can override
- Slack signatures verified; retries are idempotent
- Optional holidays respect `maxRequests`
- Leave history is never hard-deleted

---

## Testing

```bash
npm test
```

---

## Production (Vercel + Supabase)

1. Host Postgres on **Supabase** (same project as local, or a separate prod project).
2. Deploy the Next.js app to **Vercel**.
3. Set the same env vars in Vercel (use the Vercel HTTPS URL for `NEXTAUTH_URL`, `BACKEND_URL`, `FRONTEND_URL`).
4. Run once against prod DB:

```bash
npx prisma migrate deploy
npx prisma db seed
```

5. Point Slack Request URLs at your Vercel domain.

Health check: `GET /api/health`

---

## Troubleshooting

| Issue | Check |
|-------|--------|
| Slack signature failures | `SLACK_SIGNING_SECRET`, server clock |
| `/leave` does nothing | Slash URL, bot install, HTTPS tunnel / Vercel URL |
| Manager no DM | Manager has `slackUserId` mapped; `im:write` |
| Channel posts fail | Bot invited to `#leave-tracker`; correct `SLACK_LEAVE_CHANNEL_ID` |
| Login / DB errors | `DATABASE_URL` + `DIRECT_URL` from Supabase Database settings |

---

## License

Proprietary — SecureITLab
