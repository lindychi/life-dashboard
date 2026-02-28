/**
 * SEO 키워드 순위 추적 라이브러리
 *
 * 기능:
 * - 키워드 등록/조회/업데이트
 * - 순위 데이터 저장
 * - 시계열 순위 히스토리 조회
 * - 순위 변화 트렌드 분석
 */

import { query, queryOne } from "./db";

// ──────────────────────────────────────────────────────────
// 타입 정의
// ──────────────────────────────────────────────────────────

export interface Keyword {
  id: string;
  keyword: string;
  target_url: string;
  search_engine: string;
  country: string;
  language: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface KeywordRanking {
  id: string;
  keyword_id: string;
  rank: number | null;
  page: number;
  position_on_page: number | null;
  url: string | null;
  title: string | null;
  snippet: string | null;
  checked_at: Date;
  check_method: string | null;
  confidence: number;
  notes: string | null;
}

export interface LatestRanking {
  id: string;
  keyword: string;
  target_url: string;
  search_engine: string;
  country: string;
  language: string;
  rank: number | null;
  checked_at: Date | null;
  ranked_url: string | null;
  title: string | null;
  snippet: string | null;
}

export interface RankChange {
  current_rank: number | null;
  previous_rank: number | null;
  rank_change: number | null;
  percent_change: number | null;
}

export interface KeywordStatistics {
  keyword_id: string;
  keyword: string;
  target_url: string;
  search_engine: string;
  total_checks: number;
  best_rank: number | null;
  worst_rank: number | null;
  avg_rank: number | null;
  first_check: Date | null;
  last_check: Date | null;
}

export interface TrendDataPoint {
  checked_at: Date;
  rank: number | null;
  url: string | null;
  title: string | null;
}

// ──────────────────────────────────────────────────────────
// 키워드 관리
// ──────────────────────────────────────────────────────────

/**
 * 새 키워드 추적 등록
 * 이미 존재하는 키워드는 활성화 상태로 업데이트
 */
export async function addKeyword(params: {
  keyword: string;
  targetUrl: string;
  searchEngine?: string;
  country?: string;
  language?: string;
}): Promise<Keyword> {
  const {
    keyword,
    targetUrl,
    searchEngine = "google",
    country = "kr",
    language = "ko",
  } = params;

  const sql = `
    INSERT INTO keywords (keyword, target_url, search_engine, country, language, active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    ON CONFLICT (keyword, target_url, search_engine, country)
    DO UPDATE SET
      active = TRUE,
      language = EXCLUDED.language,
      updated_at = NOW()
    RETURNING *
  `;

  const result = await queryOne<Keyword>(sql, [
    keyword,
    targetUrl,
    searchEngine,
    country,
    language,
  ]);

  if (!result) {
    throw new Error("Failed to add keyword");
  }

  return result;
}

/**
 * 키워드 조회 (활성 키워드만)
 */
export async function getKeywords(params?: {
  searchEngine?: string;
  country?: string;
  activeOnly?: boolean;
}): Promise<Keyword[]> {
  const { searchEngine, country, activeOnly = true } = params || {};

  let sql = "SELECT * FROM keywords WHERE 1=1";
  const sqlParams: unknown[] = [];
  let paramIndex = 1;

  if (activeOnly) {
    sql += " AND active = TRUE";
  }

  if (searchEngine) {
    sql += ` AND search_engine = $${paramIndex++}`;
    sqlParams.push(searchEngine);
  }

  if (country) {
    sql += ` AND country = $${paramIndex++}`;
    sqlParams.push(country);
  }

  sql += " ORDER BY created_at DESC";

  return query<Keyword>(sql, sqlParams);
}

/**
 * 키워드 ID로 조회
 */
export async function getKeywordById(id: string): Promise<Keyword | null> {
  const sql = "SELECT * FROM keywords WHERE id = $1";
  return queryOne<Keyword>(sql, [id]);
}

/**
 * 키워드 비활성화
 */
export async function deactivateKeyword(id: string): Promise<void> {
  const sql = "UPDATE keywords SET active = FALSE, updated_at = NOW() WHERE id = $1";
  await query(sql, [id]);
}

/**
 * 키워드 활성화
 */
export async function activateKeyword(id: string): Promise<void> {
  const sql = "UPDATE keywords SET active = TRUE, updated_at = NOW() WHERE id = $1";
  await query(sql, [id]);
}

/**
 * 키워드 삭제 (연관된 랭킹 데이터도 CASCADE 삭제)
 */
export async function deleteKeyword(id: string): Promise<void> {
  const sql = "DELETE FROM keywords WHERE id = $1";
  await query(sql, [id]);
}

// ──────────────────────────────────────────────────────────
// 순위 데이터 저장
// ──────────────────────────────────────────────────────────

/**
 * 키워드 순위 기록 저장
 */
export async function saveRanking(params: {
  keywordId: string;
  rank: number | null;
  page?: number;
  positionOnPage?: number | null;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  checkMethod?: string;
  confidence?: number;
  notes?: string | null;
}): Promise<KeywordRanking> {
  const {
    keywordId,
    rank,
    page = 1,
    positionOnPage = null,
    url = null,
    title = null,
    snippet = null,
    checkMethod = "manual",
    confidence = 1.0,
    notes = null,
  } = params;

  const sql = `
    INSERT INTO keyword_rankings (
      keyword_id, rank, page, position_on_page, url, title, snippet,
      check_method, confidence, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;

  const result = await queryOne<KeywordRanking>(sql, [
    keywordId,
    rank,
    page,
    positionOnPage,
    url,
    title,
    snippet,
    checkMethod,
    confidence,
    notes,
  ]);

  if (!result) {
    throw new Error("Failed to save ranking");
  }

  return result;
}

/**
 * 여러 키워드의 순위를 일괄 저장 (트랜잭션)
 */
export async function saveRankingBatch(
  rankings: Array<Parameters<typeof saveRanking>[0]>
): Promise<KeywordRanking[]> {
  if (rankings.length === 0) return [];

  const results: KeywordRanking[] = [];

  for (const ranking of rankings) {
    const result = await saveRanking(ranking);
    results.push(result);
  }

  return results;
}

// ──────────────────────────────────────────────────────────
// 순위 히스토리 조회
// ──────────────────────────────────────────────────────────

/**
 * 특정 키워드의 순위 히스토리 조회
 */
export async function getKeywordHistory(
  keywordId: string,
  params?: {
    limit?: number;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<KeywordRanking[]> {
  const { limit = 100, startDate, endDate } = params || {};

  let sql = `
    SELECT * FROM keyword_rankings
    WHERE keyword_id = $1
  `;
  const sqlParams: unknown[] = [keywordId];
  let paramIndex = 2;

  if (startDate) {
    sql += ` AND checked_at >= $${paramIndex++}`;
    sqlParams.push(startDate);
  }

  if (endDate) {
    sql += ` AND checked_at <= $${paramIndex++}`;
    sqlParams.push(endDate);
  }

  sql += ` ORDER BY checked_at DESC LIMIT $${paramIndex}`;
  sqlParams.push(limit);

  return query<KeywordRanking>(sql, sqlParams);
}

/**
 * 최신 순위 조회 (모든 활성 키워드)
 */
export async function getLatestRankings(params?: {
  searchEngine?: string;
  country?: string;
}): Promise<LatestRanking[]> {
  const { searchEngine, country } = params || {};

  let sql = "SELECT * FROM latest_keyword_rankings WHERE 1=1";
  const sqlParams: unknown[] = [];
  let paramIndex = 1;

  if (searchEngine) {
    sql += ` AND search_engine = $${paramIndex++}`;
    sqlParams.push(searchEngine);
  }

  if (country) {
    sql += ` AND country = $${paramIndex++}`;
    sqlParams.push(country);
  }

  sql += " ORDER BY keyword";

  return query<LatestRanking>(sql, sqlParams);
}

// ──────────────────────────────────────────────────────────
// 순위 변화 분석
// ──────────────────────────────────────────────────────────

/**
 * 키워드 순위 변화 계산
 */
export async function getRankChange(
  keywordId: string,
  daysAgo: number = 7
): Promise<RankChange | null> {
  const sql = "SELECT * FROM get_rank_change($1, $2)";
  return queryOne<RankChange>(sql, [keywordId, daysAgo]);
}

/**
 * 키워드 통계 조회
 */
export async function getKeywordStatistics(
  keywordId?: string
): Promise<KeywordStatistics[]> {
  let sql = "SELECT * FROM keyword_statistics";
  const sqlParams: unknown[] = [];

  if (keywordId) {
    sql += " WHERE keyword_id = $1";
    sqlParams.push(keywordId);
  }

  sql += " ORDER BY keyword";

  return query<KeywordStatistics>(sql, sqlParams);
}

/**
 * 키워드 순위 트렌드 데이터 (차트용)
 */
export async function getKeywordTrends(
  keywordId: string,
  params?: {
    days?: number;
    interval?: "hour" | "day" | "week";
  }
): Promise<TrendDataPoint[]> {
  const { days = 30, interval = "day" } = params || {};

  // 시간 간격별 최신 순위 선택
  const sql = `
    WITH time_buckets AS (
      SELECT
        DATE_TRUNC($3, checked_at) AS bucket,
        rank,
        url,
        title,
        ROW_NUMBER() OVER (
          PARTITION BY DATE_TRUNC($3, checked_at)
          ORDER BY checked_at DESC
        ) AS rn
      FROM keyword_rankings
      WHERE keyword_id = $1
        AND checked_at >= NOW() - ($2 || ' days')::INTERVAL
    )
    SELECT
      bucket AS checked_at,
      rank,
      url,
      title
    FROM time_buckets
    WHERE rn = 1
    ORDER BY bucket ASC
  `;

  return query<TrendDataPoint>(sql, [keywordId, days, interval]);
}

/**
 * 여러 키워드의 순위 비교
 */
export async function compareKeywords(
  keywordIds: string[],
  days: number = 30
): Promise<
  Record<
    string,
    {
      keyword: string;
      target_url: string;
      trends: TrendDataPoint[];
      latest_rank: number | null;
    }
  >
> {
  if (keywordIds.length === 0) return {};

  const result: Record<
    string,
    {
      keyword: string;
      target_url: string;
      trends: TrendDataPoint[];
      latest_rank: number | null;
    }
  > = {};

  for (const id of keywordIds) {
    const keyword = await getKeywordById(id);
    if (!keyword) continue;

    const trends = await getKeywordTrends(id, { days });
    const latest = trends[trends.length - 1];

    result[id] = {
      keyword: keyword.keyword,
      target_url: keyword.target_url,
      trends,
      latest_rank: latest?.rank || null,
    };
  }

  return result;
}
