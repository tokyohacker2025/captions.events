## Scope
- Add host-controlled translation sessions per event (language codes like "ja", "zh").
- Batch-translate new finalized captions via OpenAI every ~5s when a language is ON.
- Persist translations and the original caption mapping to avoid re-sending.
- Sync translations to viewers with Supabase Realtime.
- Viewer can choose Original, Translation, or Both (responsive side-by-side/stacked).
- Show inactive message if the host turns off a selected language.

## Data Model
- New table: `event_translations` (per-event language switches)
  - `id` UUID PK, `event_id` UUID FK→`events(id)`, `language_code` TEXT, `is_active` BOOLEAN, `updated_at` TIMESTAMPTZ.
  - RLS: everyone can SELECT; event creator can INSERT/UPDATE/DELETE.
- New table: `translations` (persisted translated sentences)
  - `id` UUID PK, `event_id` UUID FK→`events(id)`, `caption_id` UUID FK→`captions(id)`, `language_code` TEXT, `translated_text` TEXT, `sequence_number` INT, `created_at` TIMESTAMPTZ.
  - Indexes on `event_id`, `language_code`, `caption_id`, `sequence_number`.
  - Realtime publication enabled.
- No changes to `captions` schema; use `is_final` to determine completed sentences.

## API Endpoints
- `POST /api/translations/run` (server-only)
  - Input: `{ eventUid, languageCode, partialText? }`.
  - Auth: must be event creator (reuse server Supabase client + cookies).
  - Flow:
    1. Resolve `event_id` by `uid`, verify ownership.
    2. Fetch finalized captions for the event that are NOT yet translated for `languageCode`.
    3. Build OpenAI prompt: include the batch of completed captions (id + text) and optionally current `partialText`, instructing the model to ignore uncompleted text.
    4. Call OpenAI (env `OPENAI_API_KEY`) with `gpt-4o-mini` via `fetch`.
    5. Expect strict JSON: `[{ caption_id: string, translated_text: string }]`.
    6. Insert results into `translations` with `sequence_number` copied from `captions`.
    7. Return inserted rows.
- Rate: client-side `setInterval` ~5s while any `event_translations.is_active=true`.

## Host UI (/broadcast)
- Panel: "Translations"
  - Add language row: Select from `LANGUAGES` (code + name).
  - Toggle switch per language to turn ON/OFF (`event_translations`).
  - Show active languages list with status.
- Background worker:
  - When ≥1 active language, start a 5s interval.
  - On each tick, for each active language:
    - POST to `/api/translations/run` with `eventUid`, `languageCode`, and current `partialText`.
  - Stop interval when no active languages.

## Viewer UI (/view)
- Language dropdown shows only active languages for the event (plus "Original").
- View mode switch: `Original | Translation | Both`.
- Layout:
  - Desktop: two columns (original left, translation right) when Both.
  - Mobile: original above, translation below per caption when Both.
- Realtime subscriptions:
  - `captions` channel (existing) still used for originals.
  - New `translations` channel filtered by `event_id` + selected `language_code`.
- Inactive message: when selected language becomes inactive, show a footer note indicating official translation paused.

## Batching & Prompt Design
- Batch includes only finalized, untranslated captions (by `caption_id` join exclusion).
- Optionally include `partialText` as context, instruct model not to translate it yet.
- System prompt:
  - Define source language (from `captions.language_code` if available; otherwise infer implicitly), target `languageCode`.
  - Instruct to return strict JSON array with `caption_id` and `translated_text` only.
  - State: Ignore `partialText` or mark pending; do not include it in output.

## Supabase Policies & Realtime
- `event_translations`: SELECT for all; INSERT/UPDATE/DELETE only by event creator.
- `translations`: SELECT for all; INSERT only by event creator (through authenticated API route).
- Add both tables to `supabase_realtime` publication.

## Implementation Files
- Migrations: `supabase/migrations/*` for the two new tables and realtime publication.
- API: `app/api/translations/run/route.ts` (server handler using `getSupabaseServerClient`).
- Broadcast UI: `components/broadcaster-interface.tsx` — add Translation panel, switches, interval worker.
- Viewer UI: `components/viewer-interface.tsx` — add active-language source, view-mode, subscribe to `translations`, responsive layout and inactive notice.

## Error Handling & Performance
- Debounce partialText sampling client-side to avoid rapid changes.
- Guard OpenAI calls: skip when no pending captions.
- Catch and surface API failures in broadcaster UI; keep interval resilient.
- Avoid duplicate inserts by relying on `caption_id + language_code` uniqueness (DB constraint) and join filtering.

## Security & Config
- Use `OPENAI_API_KEY` from env on the server only.
- Do not log secrets; add minimal logs for errors.
- Follow existing code style and avoid adding packages (use `fetch`).

## Testing
- Create one event, produce sample captions, enable `ja` translation.
- Verify `/translations` rows insert and stream to viewer in real-time.
- Switch languages ON/OFF and see viewer dropdown and inactive message update.
- Confirm batching avoids retranslating already translated captions.

Do you want me to proceed with implementing these changes end-to-end?