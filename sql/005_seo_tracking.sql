-- 005_seo_tracking.sql
-- SEO 키워드 순위 추적 시스템

-- ─── 1. keywords 테이블 ─────────────────────────────────────
-- 추적할 키워드 목록
CREATE TABLE IF NOT EXISTS keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  target_url TEXT NOT NULL,
  search_engine TEXT NOT NULL DEFAULT 'google', -- google, naver, bing 등
  country TEXT DEFAULT 'kr', -- 국가 코드 (kr, us 등)
  language TEXT DEFAULT 'ko', -- 언어 코드 (ko, en 등)
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 중복 방지: 같은 키워드+URL+검색엔진+국가 조합은 하나만
  UNIQUE(keyword, target_url, search_engine, country)
);

CREATE INDEX IF NOT EXISTS idx_keywords_active
  ON keywords(active, search_engine, country);

-- ─── 2. keyword_rankings 테이블 ────────────────────────────
-- 키워드 순위 히스토리
CREATE TABLE IF NOT EXISTS keyword_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  rank INTEGER, -- NULL = 100위권 밖
  page INTEGER DEFAULT 1, -- 검색 결과 페이지 번호
  position_on_page INTEGER, -- 페이지 내 위치 (1-10 등)
  url TEXT, -- 실제 랭크된 URL (target_url과 다를 수 있음)
  title TEXT, -- 검색 결과 제목
  snippet TEXT, -- 검색 결과 스니펫
  checked_at TIMESTAMPTZ DEFAULT NOW(),

  -- 데이터 품질 메타데이터
  check_method TEXT, -- 'manual', 'api', 'scrape'
  confidence NUMERIC(3,2) DEFAULT 1.0, -- 신뢰도 (0.0-1.0)
  notes TEXT -- 특이사항 메모
);

-- 시계열 조회 최적화
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_keyword_time
  ON keyword_rankings(keyword_id, checked_at DESC);

-- 순위 변화 분석용 인덱스
CREATE INDEX IF NOT EXISTS idx_keyword_rankings_rank
  ON keyword_rankings(keyword_id, rank)
  WHERE rank IS NOT NULL;

-- ─── 3. 편의 뷰: 최신 순위 ──────────────────────────────────
-- 각 키워드의 가장 최근 순위
CREATE OR REPLACE VIEW latest_keyword_rankings AS
SELECT DISTINCT ON (kr.keyword_id)
  k.id,
  k.keyword,
  k.target_url,
  k.search_engine,
  k.country,
  k.language,
  kr.rank,
  kr.checked_at,
  kr.url AS ranked_url,
  kr.title,
  kr.snippet
FROM keywords k
LEFT JOIN keyword_rankings kr ON k.id = kr.keyword_id
WHERE k.active = TRUE
ORDER BY kr.keyword_id, kr.checked_at DESC;

-- ─── 4. 순위 변화 계산 함수 ────────────────────────────────
-- 지정 기간 동안의 순위 변화량 계산
CREATE OR REPLACE FUNCTION get_rank_change(
  p_keyword_id UUID,
  p_days_ago INTEGER DEFAULT 7
)
RETURNS TABLE (
  current_rank INTEGER,
  previous_rank INTEGER,
  rank_change INTEGER,
  percent_change NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH current AS (
    SELECT rank
    FROM keyword_rankings
    WHERE keyword_id = p_keyword_id
    ORDER BY checked_at DESC
    LIMIT 1
  ),
  previous AS (
    SELECT rank
    FROM keyword_rankings
    WHERE keyword_id = p_keyword_id
      AND checked_at <= NOW() - (p_days_ago || ' days')::INTERVAL
    ORDER BY checked_at DESC
    LIMIT 1
  )
  SELECT
    c.rank AS current_rank,
    p.rank AS previous_rank,
    COALESCE(p.rank, 0) - COALESCE(c.rank, 0) AS rank_change, -- 순위 상승이 양수
    CASE
      WHEN p.rank IS NULL OR p.rank = 0 THEN NULL
      ELSE ROUND(
        ((COALESCE(p.rank, 0) - COALESCE(c.rank, 0))::NUMERIC / p.rank) * 100,
        2
      )
    END AS percent_change
  FROM current c
  CROSS JOIN previous p;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── 5. 키워드 통계 집계 뷰 ────────────────────────────────
-- 각 키워드의 통계 요약
CREATE OR REPLACE VIEW keyword_statistics AS
SELECT
  k.id AS keyword_id,
  k.keyword,
  k.target_url,
  k.search_engine,
  COUNT(kr.id) AS total_checks,
  MIN(kr.rank) AS best_rank,
  MAX(kr.rank) AS worst_rank,
  ROUND(AVG(kr.rank), 1) AS avg_rank,
  MIN(kr.checked_at) AS first_check,
  MAX(kr.checked_at) AS last_check
FROM keywords k
LEFT JOIN keyword_rankings kr ON k.id = kr.keyword_id
WHERE k.active = TRUE AND kr.rank IS NOT NULL
GROUP BY k.id, k.keyword, k.target_url, k.search_engine;

-- ─── 6. 업데이트 트리거 ────────────────────────────────────
-- keywords 테이블의 updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_keywords_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER keywords_updated_at_trigger
  BEFORE UPDATE ON keywords
  FOR EACH ROW
  EXECUTE FUNCTION update_keywords_updated_at();
