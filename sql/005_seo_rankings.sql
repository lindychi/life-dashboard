-- SEO Rankings Table
-- Stores keyword ranking data from Google Search Console and SerpAPI

CREATE TABLE IF NOT EXISTS seo_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  ctr DECIMAL(5, 4), -- e.g., 0.0523 = 5.23%
  source TEXT NOT NULL, -- 'gsc' (Google Search Console) or 'serpapi'
  country_code TEXT DEFAULT 'global',
  device TEXT DEFAULT 'all', -- 'desktop', 'mobile', 'tablet', 'all'
  metadata JSONB, -- Additional data like query variations, featured snippets, etc.
  collected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_seo_rankings_keyword ON seo_rankings(keyword, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_url ON seo_rankings(url, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_source ON seo_rankings(source, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_rankings_collected_at ON seo_rankings(collected_at DESC);

-- SEO Tracking Configuration Table
-- Stores keywords to track and their monitoring settings
CREATE TABLE IF NOT EXISTS seo_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL UNIQUE,
  target_url TEXT,
  country_code TEXT DEFAULT 'global',
  device TEXT DEFAULT 'all',
  active BOOLEAN DEFAULT TRUE,
  check_frequency_hours INTEGER DEFAULT 24, -- How often to check (in hours)
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_keywords_active ON seo_keywords(active, last_checked_at);

-- View for latest rankings per keyword
CREATE OR REPLACE VIEW seo_latest_rankings AS
SELECT DISTINCT ON (keyword, source)
  id,
  keyword,
  url,
  position,
  clicks,
  impressions,
  ctr,
  source,
  country_code,
  device,
  metadata,
  collected_at
FROM seo_rankings
ORDER BY keyword, source, collected_at DESC;

-- View for ranking trends (compare current vs previous)
CREATE OR REPLACE VIEW seo_ranking_trends AS
WITH current_ranks AS (
  SELECT keyword, url, position, collected_at, source
  FROM seo_latest_rankings
),
previous_ranks AS (
  SELECT DISTINCT ON (r.keyword, r.source)
    r.keyword,
    r.url,
    r.position,
    r.collected_at,
    r.source
  FROM seo_rankings r
  WHERE r.collected_at < (
    SELECT MAX(collected_at) FROM seo_rankings
  )
  ORDER BY r.keyword, r.source, r.collected_at DESC
)
SELECT
  c.keyword,
  c.url,
  c.position AS current_position,
  p.position AS previous_position,
  (p.position - c.position) AS position_change, -- Positive = improvement (moved up)
  c.collected_at AS current_date,
  p.collected_at AS previous_date,
  c.source
FROM current_ranks c
LEFT JOIN previous_ranks p ON c.keyword = p.keyword AND c.source = p.source;
