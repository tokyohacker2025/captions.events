# Vercel Deployment Guide

## Overview

This project is ready to deploy on Vercel with Next.js. It uses Supabase for auth, storage, and realtime, ElevenLabs for Scribe tokens, and OpenAI for server-side batch translation.

## Prerequisites

- Vercel account
- Supabase project (production)
- GitHub OAuth app (production)
- API keys: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`

## Vercel Configuration

1. Import the repository in Vercel.
2. Framework: Next.js (defaults are fine).
3. Environment Variables (Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`: your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: your Supabase anon key
   - `NEXT_PUBLIC_SITE_URL`: your production domain (e.g., `https://captions.yourdomain.com`)
   - `ELEVENLABS_API_KEY`: your ElevenLabs key
   - `OPENAI_API_KEY`: your OpenAI key
4. Redeploy after setting variables.

## Supabase (Production)

1. Authentication → URL Configuration:
   - Set `Site URL` to your production domain (e.g., `https://captions.yourdomain.com`)
2. Authentication → Providers → GitHub:
   - Enable GitHub and set Client ID/Secret from your GitHub OAuth App
3. GitHub OAuth App:
   - Authorization callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback`
4. Apply migrations (SQL Editor → run file contents):
   - `supabase/migrations/20251217090000_event_translations.sql`
   - `supabase/migrations/20251217090500_translations.sql`
5. Ensure `supabase_realtime` publication includes: `captions`, `event_translations`, `translations`.

## App Behavior Notes

- `middleware.ts` protects `/dashboard` and `/broadcast/*`.
- Viewer subscribes to `captions`, `translations`, and `event_translations` via Supabase Realtime.
- Host translation worker runs every ~5s while recording is ON and languages are active, and on every finalized caption.
- Server translation API (`/api/translations/run`) uses `OPENAI_API_KEY` for batch translation.

## Testing Checklist

1. Sign in with GitHub.
2. Create an event; open `/broadcast/[uid]`.
3. Start Recording; speak and confirm captions save.
4. Add target languages and turn them ON; confirm translated rows appear and stream to `/view/[uid]`.
5. Turn languages OFF; viewer shows inactive notice and translation stops.

## Troubleshooting

- 401 on API routes: ensure user is authenticated and cookies are present (Vercel keeps auth via `@supabase/ssr`).
- 500 on OpenAI: verify `OPENAI_API_KEY` and check server logs (the API logs prompt and response).
- RLS errors: confirm policies exist in production DB for new tables.
- Redirect issues: ensure `NEXT_PUBLIC_SITE_URL` and Supabase `Site URL` match your Vercel domain.

## Security

- Do not commit secrets. Set all keys in Vercel Environment Variables.
