# Ebizz Accounting

A multi-tenant, multi-currency, double-entry accounting platform with inventory,
supplier and customer management — built to scale as a SaaS product.

> **Status:** Milestone 2 — full transaction layer on top of the double-entry core.
> Sales invoices (A/R), purchase bills (A/P), payments, tax, and financial
> reports (P&L, Balance Sheet, Trial Balance, A/R & A/P aging) — with inventory
> automatically moved and the ledger posted on every document.

---

## Architecture

```
┌──────────────┐     HTTPS/JWT      ┌──────────────┐     RLS-scoped     ┌──────────────┐
│  React (web) │ ─────────────────▶ │ NestJS (api) │ ─────────────────▶ │   Supabase   │
│  Vite + RQ   │  Bearer + company  │  REST + docs │  user-token client │ Postgres+Auth│
└──────────────┘                    └──────────────┘                    └──────────────┘
        │                                                                      ▲
        └──────────────── Supabase Auth (sign in / session) ───────────────────┘
```

- **Multi-tenancy:** shared database + **Row Level Security**. Every business
  row carries `organization_id`; a user may only touch rows in orgs they are a
  member of. Writes additionally require an editor role. See
  [`supabase/migrations/0004_rls.sql`](supabase/migrations/0004_rls.sql).
- **Multi-company ("origins"):** an organization holds many companies, each with
  its own **base currency** and chart of accounts.
- **Double-entry ledger:** `accounts` → `journal_entries` → `journal_lines`.
  Posting is balance-enforced by a Postgres trigger (base-currency debits must
  equal credits); posted entries are immutable. See
  [`0002_ledger.sql`](supabase/migrations/0002_ledger.sql).
- **Inventory ↔ ledger:** `record_inventory_movement` is the single write path
  for stock — it updates moving-average cost and quantity-on-hand **and** posts
  the matching journal entry atomically, so the warehouse and the books can
  never drift. See [`0005_rpc.sql`](supabase/migrations/0005_rpc.sql).

### Monorepo layout

```
apps/
  api/         NestJS REST API (auth guard, RLS-scoped Supabase client, modules)
  web/         React + Vite SPA (Supabase auth, React Query, CRUD screens)
packages/
  shared/      Framework-agnostic domain enums + DTO types (used by api & web)
supabase/
  migrations/  SQL schema, RLS policies, RPCs (source of truth)
  config.toml  Local Supabase stack config
docker-compose.yml
```

---

## Prerequisites

- Node 20+ and **pnpm** (`corepack enable`)
- **Docker Desktop** (for the local Supabase stack)
- **Supabase CLI** (`supabase`)

## Getting started (local)

```bash
# 1. Install dependencies
pnpm install

# 2. Start the local Supabase stack (Postgres, Auth, Studio…) and apply migrations
pnpm db:start          # supabase start
pnpm db:reset          # applies everything in supabase/migrations

# 3. Copy env and fill in the keys printed by `supabase status`
cp .env.example .env
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL

# 4. (optional) regenerate typed DB types
pnpm db:types

# 5. Run API + web together
pnpm dev
#   API  → http://localhost:3000/api/v1   (Swagger at /docs)
#   Web  → http://localhost:5173
```

Then open the web app, **sign up**, and complete onboarding — this calls the
`create_organization` RPC to create your org, owner membership, first company
and a default chart of accounts in one transaction.

## Running with Docker

The API and web app are containerized; the database is the Supabase CLI stack.

```bash
pnpm db:start                       # Supabase stack on the host
# ensure .env has SUPABASE_* and VITE_* values from `supabase status`
docker compose up --build
#   API → http://localhost:3000     Web → http://localhost:8080
```

---

## API surface (v1)

All endpoints require `Authorization: Bearer <supabase-jwt>`. Company-scoped
endpoints also require an `x-company-id` header.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/organizations` | Bootstrap tenant (org + company + CoA) |
| `GET` | `/organizations`, `/companies` | List the user's orgs / companies |
| `POST` | `/companies` | Add a company to an org (+ default CoA) |
| `GET` | `/currencies`, `/accounts`, `/locations` | Reference data |
| `POST/PATCH` | `/locations` | Manage warehouses |
| `GET/POST/PATCH/DELETE` | `/suppliers` | Supplier management |
| `GET/POST/PATCH/DELETE` | `/customers` | Customer management |
| `GET/POST/PATCH/DELETE` | `/items` | Item / product catalogue |
| `GET/POST` | `/items/:id/suppliers` | Item ↔ supplier sourcing |
| `GET` | `/items/:id/levels` | Stock on hand per location |
| `POST` | `/items/:id/movements` | Record stock movement (+ auto ledger post) |
| `GET/POST` | `/tax-rates` | Tax rates |
| `GET/POST/PATCH` `POST /:id/post` | `/invoices` | Sales invoices (draft → post) |
| `GET/POST/PATCH` `POST /:id/post` | `/bills` | Purchase bills (draft → post) |
| `GET/POST` | `/payments` | Customer/supplier payments + allocation |
| `GET` | `/reports/trial-balance` | Trial balance |
| `GET` | `/reports/profit-loss` | Profit & Loss |
| `GET` | `/reports/balance-sheet` | Balance Sheet |
| `GET` | `/reports/ar-aging`, `/reports/ap-aging` | Receivable / payable aging |

Interactive docs: **`http://localhost:3000/docs`**.

### How posting works

Documents are created as **draft**, then **posted**. Posting is one atomic DB
transaction (a `SECURITY DEFINER` RPC) that moves inventory *and* writes a
balanced journal entry:

- **Post a bill** → Dr Inventory (stocked lines, moving-average cost in) / Dr
  Expense (service lines) + Dr Input Tax, Cr Accounts Payable.
- **Post an invoice** → Dr Accounts Receivable, Cr Revenue + Cr Tax; and for
  stocked lines Dr COGS / Cr Inventory (issued at moving-average cost).
- **Payments** → customer: Dr Bank, Cr A/R; supplier: Dr A/P, Cr Bank; and
  allocations mark invoices/bills paid.

Posted documents are immutable; only drafts can be edited or deleted.

---

## Roadmap (post-milestone-2)

1. Credit notes / refunds; void & reverse posted documents
2. Purchase-order & sales-order layer, partial shipments/receipts
3. FX revaluation, multi-currency gain/loss
4. Roles/permissions UI, audit log, org member invitations
5. Billing/subscription layer for SaaS

## Security notes

- The service-role key is **server-only** and bypasses RLS — never expose it to
  the browser. The web app only uses the anon key; RLS is the real boundary.
- Tenant isolation is enforced in Postgres (RLS), not just the app layer, so a
  bug in the API cannot leak another tenant's data.
