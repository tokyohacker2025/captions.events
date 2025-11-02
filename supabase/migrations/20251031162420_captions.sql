-- Create captions table for storing live captions
CREATE TABLE IF NOT EXISTS captions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sequence_number INTEGER NOT NULL,
  is_final BOOLEAN DEFAULT false
);

-- Create index on event_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_captions_event_id ON captions(event_id);

-- Create index on timestamp for ordering
CREATE INDEX IF NOT EXISTS idx_captions_timestamp ON captions(timestamp);

-- Enable Row Level Security
ALTER TABLE captions ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view captions
CREATE POLICY "Captions are viewable by everyone"
  ON captions FOR SELECT
  USING (true);

-- Policy: Only event creators can insert captions
CREATE POLICY "Event creators can add captions"
  ON captions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_id
      AND events.creator_id = auth.uid()
    )
  );

-- Turn on realtime for the captions table
alter publication supabase_realtime
add table captions;