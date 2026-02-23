-- 일일 개인 비서 인사이트: 매일 agent 활동 데이터를 분석하여 사용자 인사이트를 저장

CREATE TABLE IF NOT EXISTS user_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  daily_summary TEXT NOT NULL,
  topics JSONB NOT NULL DEFAULT '[]',
  patterns JSONB NOT NULL DEFAULT '{}',
  preferences JSONB NOT NULL DEFAULT '{}',
  history_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_insights_date ON user_insights(date DESC);
CREATE INDEX IF NOT EXISTS idx_user_insights_created_at ON user_insights(created_at DESC);
