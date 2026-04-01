<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AyurLedger

This project currently runs as a Vite React frontend plus a custom Express server backed by a local SQLite database (`ayurledger.db`).

## Local Run

Prerequisites: Node.js

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env.local`
3. Set any required keys in `.env.local`
4. Run `npm run dev`

The app will be available at `http://localhost:3000`.

## Supabase Setup

This repo now includes the foundation needed to move the local SQLite data into Supabase.

1. Create a new Supabase project.
2. Open the Supabase SQL Editor and run [supabase/schema.sql](/c:/Users/User/Downloads/ayurledger-premium/supabase/schema.sql).
3. Fill these variables in `.env.local`:
   `VITE_SUPABASE_URL`
   `VITE_SUPABASE_ANON_KEY`
   `SUPABASE_URL`
   `SUPABASE_SERVICE_ROLE_KEY`
4. Import the current SQLite data with `npm run supabase:sync`
5. Run [supabase/reset_sequences.sql](/c:/Users/User/Downloads/ayurledger-premium/supabase/reset_sequences.sql) in Supabase after the import finishes.

## Important Limitation

The existing app logic is still implemented in [server.ts](/c:/Users/User/Downloads/ayurledger-premium/server.ts) against SQLite. Supabase is now wired in as a connection layer and data-migration path, but a full backend migration would still require porting the Express routes and SQL queries to Supabase/Postgres or Supabase Edge Functions.

## Vercel Deploy

This repo is configured to deploy on Vercel with:

1. Static frontend output from `dist`
2. Express API routed through [api/[...route].ts](/c:/Users/User/Downloads/ayurledger-premium/api/[...route].ts#L1)
3. Vercel routing config in [vercel.json](/c:/Users/User/Downloads/ayurledger-premium/vercel.json#L1)

Set these environment variables in the Vercel project:

- `GEMINI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended:

- leave `VITE_API_BASE_URL` empty on Vercel so the frontend uses the same domain
- keep `SUPABASE_SERVICE_ROLE_KEY` server-only

## Railway Backend Deploy

If you want a more reliable production setup, deploy the Express backend to Railway and keep the frontend on Vercel.

Backend env vars in Railway:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY` if you use AI insight
- `NODE_ENV=production`
- `SERVE_FRONTEND=false`
- `CORS_ALLOWED_ORIGINS=https://your-vercel-domain.vercel.app,https://ayurhaya.online`

Frontend env vars in Vercel for split deployment:

- `VITE_API_BASE_URL=https://your-railway-backend.up.railway.app`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Notes:

- [railway.json](/c:/Users/User/Downloads/ayurledger-premium/railway.json#L1) starts the backend with `npm run start`
- login now respects `VITE_API_BASE_URL`, so the Vercel frontend can call the Railway API directly
- CORS is controlled by `CORS_ALLOWED_ORIGINS` on the backend
