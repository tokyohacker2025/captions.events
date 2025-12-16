-- Create event_translations table for managing per-event language switches
CREATE TABLE IF NOT EXISTS event_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure one row per event+language
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_translations_event_language
ON event_translations(event_id, language_code);

-- Enable Row Level Security
ALTER TABLE event_translations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Event translations viewable by everyone"
  ON event_translations FOR SELECT
  USING (true);

CREATE POLICY "Event creators can add translations"
  ON event_translations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.creator_id = auth.uid()
    )
  );

CREATE POLICY "Event creators can update translations"
  ON event_translations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.creator_id = auth.uid()
    )
  );

CREATE POLICY "Event creators can delete translations"
  ON event_translations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.creator_id = auth.uid()
    )
  );

-- Turn on realtime for the event_translations table
ALTER PUBLICATION supabase_realtime
ADD TABLE event_translations;
