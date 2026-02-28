-- YouTube Channel Monitoring System
-- Tracks monitored channels and discovered videos

CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_url TEXT NOT NULL,
  feed_type TEXT NOT NULL CHECK (feed_type IN ('rss', 'api')), -- 'rss' or 'api'
  rss_url TEXT, -- For RSS feed-based monitoring
  api_key_env TEXT, -- Environment variable name for API key
  check_interval_minutes INT NOT NULL DEFAULT 30,
  last_checked_at TIMESTAMP WITH TIME ZONE,
  last_video_id TEXT, -- ID of the last discovered video (for deduplication)
  enabled BOOLEAN DEFAULT TRUE,
  metadata JSONB DEFAULT '{}', -- Custom config, tags, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  published_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_seconds INT,
  thumbnail_url TEXT,
  watch_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'analyzed', 'failed')),
  analysis_result JSONB, -- Stores researcher analysis output
  researcher_task_id UUID, -- Link to task_queue entry
  conversation_id UUID REFERENCES conversations(id), -- Link to conversation session
  error_message TEXT, -- If analysis failed
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  analyzed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(channel_id, video_id) -- Prevent duplicates within channel
);

CREATE TABLE youtube_monitoring_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  run_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  videos_found INT DEFAULT 0,
  new_videos INT DEFAULT 0,
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_youtube_channels_enabled ON youtube_channels(enabled);
CREATE INDEX idx_youtube_channels_last_checked ON youtube_channels(last_checked_at);
CREATE INDEX idx_youtube_videos_channel_status ON youtube_videos(channel_id, status);
CREATE INDEX idx_youtube_videos_published ON youtube_videos(published_at DESC);
CREATE INDEX idx_youtube_videos_discovered ON youtube_videos(discovered_at DESC);
CREATE INDEX idx_youtube_monitoring_runs_channel ON youtube_monitoring_runs(channel_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_youtube_channels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_youtube_channels_updated_at
BEFORE UPDATE ON youtube_channels
FOR EACH ROW
EXECUTE FUNCTION update_youtube_channels_updated_at();

CREATE OR REPLACE FUNCTION update_youtube_videos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_youtube_videos_updated_at
BEFORE UPDATE ON youtube_videos
FOR EACH ROW
EXECUTE FUNCTION update_youtube_videos_updated_at();
