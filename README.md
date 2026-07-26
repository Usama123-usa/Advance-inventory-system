# InventoryPro — Premium Inventory Management & POS System

A full-stack inventory management and point-of-sale system.

**Stack:** React + Vite + Tailwind CSS (frontend) · Node.js + Express (backend) · Supabase (Postgres via the `supabase-js` client — PostgREST + RPC, no raw DB connection string) · JWT auth · deployable to Vercel as a single project.

## Project Structure

```
inventory/
├── client/            React + Vite frontend
├── server/             Express backend (source of truth for API logic)
├── api/index.js         Vercel serverless entry point (re-exports server/src/app.js)
├── sql/schema.sql       Paste directly into the Supabase SQL Editor
├── vercel.json           Vercel build config (static frontend + serverless API)
├── package.json          Root package.json — holds backend deps so Vercel's
│                        function bundler can resolve them from api/index.js
└── .env.example
```

## 1. Set up Supabase

1. Create a project at https://supabase.com.
2. Open **SQL Editor** and paste the entire contents of [`sql/schema.sql`](sql/schema.sql), then run it.
   This creates all 8 tables (`users`, `categories`, `products`, `inventory_logs`, `customers`, `sales`, `sale_items`, `settings`), indexes, triggers, the RPC functions the backend calls for aggregates/atomic operations (`create_sale`, `adjust_stock`, dashboard/report queries, etc.), a public `product-images` storage bucket, and seeds:
   - A default settings row
   - A default admin login: **admin@example.com / Admin@123** — change this password after first login.
3. Go to **Project Settings → API** and copy the Project URL and the **secret key** (full access, bypasses RLS — used by the backend only). The publishable key isn't required by this backend but is included in `.env.example` for reference.

There is no separate database connection string to configure — the backend talks to Postgres entirely through the Supabase client (PostgREST for CRUD/joins, RPC functions for aggregates and atomic multi-step operations like completing a sale).

## 2. Configure environment variables

Copy `.env.example` to `.env` in the project root (used by the backend when running locally):

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and a strong random `JWT_SECRET`.

Also copy `client/.env.example` to `client/.env`:

```bash
cp client/.env.example client/.env
```

`VITE_API_URL` should point at your backend (`http://localhost:5000/api` for local dev).

## 3. Install dependencies

```bash
npm install                 # root deps (used by the Vercel serverless function)
cd server && npm install    # backend deps for local dev
cd ../client && npm install # frontend deps
```

## 4. Run locally

In two terminals:

```bash
# Terminal 1 — backend
npm run dev:server          # http://localhost:5000

# Terminal 2 — frontend
npm run dev:client          # http://localhost:5173
```

Log in with `admin@example.com` / `Admin@123`.

## 5. Deploy to Vercel

1. Push this project to a GitHub repository.
2. In Vercel, **Add New Project** → import the repo. **Root Directory must be left blank / at the repository root** — do not point it at `client`, or Vercel won't see `vercel.json`, `api/`, or the root `package.json` at all.
3. Framework Preset: it doesn't matter what Vercel auto-detects — `vercel.json` sets `"framework": null` and defines `installCommand`/`buildCommand`/`outputDirectory` explicitly, which always override the dashboard/auto-detected settings.
4. Add all variables from `.env.example` under **Project Settings → Environment Variables** (same names, real values: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, etc.). Also add `VITE_API_URL=/api` so the deployed frontend calls the same-origin `/api` routes instead of localhost.
5. Deploy. Vercel will:
   - Run `npm install` at the repo root (populates `node_modules` so the `/api` function can resolve `express`, `@supabase/supabase-js`, etc.).
   - Run the `buildCommand`, which installs `client/`'s own dependencies and builds it with Vite → `client/dist`, served as static files.
   - Treat `api/index.js` (which wraps the full Express app) as a serverless function. The `rewrites` in `vercel.json` forward every `/api/*` request to it — a single Express file naturally only answers the literal `/api` path by Vercel's file-based routing convention, so the rewrite is what makes every nested route (`/api/auth/login`, `/api/products`, etc.) reach it. The second rewrite sends any other non-file path to `index.html` for React Router's client-side routing.

No separate backend hosting is needed — everything ships from one Vercel project.

**If you still get a 404 after deploying:** double-check **Project Settings → General → Root Directory** is empty (not `client`), then trigger a redeploy — a previously-set Root Directory from an earlier import attempt is the most common cause.

## Features

- **Auth**: JWT login/logout, protected routes, role-based access (admin/staff)
- **Dashboard**: totals, low stock alerts, today/monthly sales, revenue, recent sales, best sellers, sales trend chart
- **Categories & Products**: full CRUD, search, filters, image upload (stored in Supabase Storage), hard delete
- **Inventory**: current stock, stock in/out with audit log, low stock alerts, full history
- **Customers**: CRUD + purchase history
- **POS**: barcode/search product grid, live cart, discount/tax/grand total, cash/card/bank transfer, automatic stock deduction, invoice generation
- **Invoice**: professional print view + PDF download
- **Reports**: sales (daily/weekly/monthly), top products, stock, profit — export to PDF and Excel
- **Settings**: store info + logo upload, currency/tax/invoice footer, light/dark theme
- Responsive, glassmorphism-accented UI with skeleton loaders, toasts, and confirm-before-delete dialogs throughout

## Notes on scope

This is the core MVP described in the spec. The extra features mentioned (barcode-scanner hardware integration beyond keyboard-wedge scanners, granular staff permission sets, sales returns, purchase orders/supplier management, backup & restore) were intentionally left for a follow-up phase — ask if you'd like any of them added next.
