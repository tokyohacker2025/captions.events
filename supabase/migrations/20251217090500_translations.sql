-- Create translations table for storing translated captions
CREATE TABLE IF NOT EXISTS translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  caption_id UUID NOT NULL REFERENCES captions(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Prevent duplicate translations for the same caption+language
CREATE UNIQUE INDEX IF NOT EXISTS uniq_translations_caption_language
ON translations(caption_id, language_code);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_translations_event_id ON translations(event_id);
CREATE INDEX IF NOT EXISTS idx_translations_language_code ON translations(language_code);
CREATE INDEX IF NOT EXISTS idx_translations_sequence_number ON translations(sequence_number);

-- Enable Row Level Security
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Translations are viewable by everyone"
  ON translations FOR SELECT
  USING (true);

CREATE POLICY "Event creators can add translations"
  ON translations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.creator_id = auth.uid()
    )
  );

-- Turn on realtime for the translations table
ALTER PUBLICATION supabase_realtime
ADD TABLE translations;
