# Production checklist

## 1. Supabase (cloud project)

Create a project at supabase.com, then from the repo root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies all migrations (0001 … 00xx) to the cloud DB
```

Copy the project's keys into the API/web environment (see below):
`Project Settings → API` → Project URL, `anon` key, `service_role` key;
`Project Settings → API → JWT Settings` → JWT secret.

### Auth — turn ON email confirmation (production)

In the Supabase dashboard:

- **Authentication → URL Configuration**
  - **Site URL**: `https://app.yourdomain.com` (your deployed web app)
  - **Redirect URLs**: add `https://app.yourdomain.com` (and any preview URLs)
- **Authentication → Providers → Email**
  - Enable **Confirm email** (ON). New sign-ups must confirm before they can sign in.
  - Configure a custom **SMTP** sender (Auth → Emails → SMTP) so confirmation
    emails deliver reliably — the built-in sender is rate-limited and not for production.

The web app already handles this: after sign-up with confirmation ON, it shows
“Account created. Check your email to confirm your address, then sign in.”

## 2. API (NestJS) — e.g. Render

Deploy `apps/api/Dockerfile`. Environment variables:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # server only — never ship to the browser
SUPABASE_JWT_SECRET=<jwt secret>
API_PORT=3000
API_GLOBAL_PREFIX=api/v1
CORS_ORIGIN=https://app.yourdomain.com          # your web domain
```

## 3. Web (Vite) — e.g. Vercel / Netlify / Cloudflare Pages

Build `apps/web`. Build-time environment variables (baked into the bundle):

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_API_URL=https://<your-api-host>/api/v1
```

## Notes
- Only the **anon** key ever reaches the browser; RLS is the security boundary.
- Free tiers: the API host may cold-start after idle, and the Supabase free
  project pauses after ~1 week of inactivity — upgrade when you have real users.
