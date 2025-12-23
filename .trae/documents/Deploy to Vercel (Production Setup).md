## Goal
Create a single markdown document visible in Trae’s Documents panel that explains how to deploy this project to Vercel, including environment variables, Supabase/GitHub OAuth setup, database migrations, and a testing checklist.

## File Location
- Create `VERCEL_DEPLOYMENT.md` in the repository root so it appears in Trae’s Documents section.

## Document Structure
### Overview
- What the app does and that it is Vercel-ready.

### Prerequisites
- Vercel account
- Supabase project (production)
- GitHub OAuth app (production)
- API keys: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`

### Vercel Configuration
- Import repo
- Framework: Next.js
- Environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SITE_URL`
  - `ELEVENLABS_API_KEY`
  - `OPENAI_API_KEY`
- Redeploy after setting variables

### Supabase (Production)
- Set Authentication → URL Configuration → Site URL to production domain
- Providers → GitHub: enable and set Client ID/Secret
- GitHub OAuth callback: `https://<your-project-ref>.supabase.co/auth/v1/callback`
- Apply DB migrations (copy/paste SQL):
  - `supabase/migrations/20251217090000_event_translations.sql`
  - `supabase/migrations/20251217090500_translations.sql`
- Confirm `supabase_realtime` publication includes `captions`, `event_translations`, `translations`

### App Behavior Notes
- Middleware protects `/dashboard` and `/broadcast/*`
- Viewer reads translations via Supabase Realtime
- Host triggers batch translation via `/api/translations/run` using `OPENAI_API_KEY`

### Testing Checklist
- Sign in with GitHub
- Create event, start broadcasting
- Toggle translations ON; confirm translated rows arrive and stream to viewer
- Turn translations OFF; viewer shows inactive notice

### Troubleshooting
- 401 on API routes: check auth and cookies
- 500 on OpenAI: verify `OPENAI_API_KEY`
- RLS errors: confirm policies applied in production
- Redirect issues: check `NEXT_PUBLIC_SITE_URL` and Supabase Site URL

### Security
- Never commit secrets; set in Vercel environment variables only.

If approved, I will add `VERCEL_DEPLOYMENT.md` to the repo root with this content.