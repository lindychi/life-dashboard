/**
 * SEO Tracking Library
 * Handles database operations for SEO keyword rankings
 */

import { query, queryOne } from "./db"

export interface SeoRanking {
  id: string
  keyword: string
  url: string
  position: number | null
  clicks: number
  impressions: number
  ctr: number | null
  source: "gsc" | "serpapi"
  country_code: string
  device: string
  metadata?: Record<string, unknown>
  collected_at: Date
  created_at: Date
}

export interface SeoKeyword {
  id: string
  keyword: string
  target_url: string | null
  country_code: string
  device: string
  active: boolean
  check_frequency_hours: number
  last_checked_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface RankingTrend {
  keyword: string
  url: string
  current_position: number | null
  previous_position: number | null
  position_change: number | null
  current_date: Date
  previous_date: Date | null
  source: string
}

/**
 * Save a new SEO ranking entry
 */
export async function saveRanking(data: {
  keyword: string
  url: string
  position?: number
  clicks?: number
  impressions?: number
  ctr?: number
  source: "gsc" | "serpapi"
  country_code?: string
  device?: string
  metadata?: Record<string, unknown>
  collected_at?: Date
}): Promise<SeoRanking> {
  const result = await queryOne<SeoRanking>(
    `
    INSERT INTO seo_rankings (
      keyword, url, position, clicks, impressions, ctr,
      source, country_code, device, metadata, collected_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `,
    [
      data.keyword,
      data.url,
      data.position ?? null,
      data.clicks ?? 0,
      data.impressions ?? 0,
      data.ctr ?? null,
      data.source,
      data.country_code ?? "global",
      data.device ?? "all",
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.collected_at ?? new Date(),
    ]
  )

  if (!result) {
    throw new Error("Failed to save SEO ranking")
  }

  return result
}

/**
 * Batch save multiple rankings (more efficient for bulk operations)
 */
export async function saveRankingsBatch(
  rankings: Array<{
    keyword: string
    url: string
    position?: number
    clicks?: number
    impressions?: number
    ctr?: number
    source: "gsc" | "serpapi"
    country_code?: string
    device?: string
    metadata?: Record<string, unknown>
    collected_at?: Date
  }>
): Promise<number> {
  if (rankings.length === 0) return 0

  const values = rankings
    .map(
      (r, i) =>
        `($${i * 11 + 1}, $${i * 11 + 2}, $${i * 11 + 3}, $${i * 11 + 4}, $${i * 11 + 5}, $${i * 11 + 6}, $${i * 11 + 7}, $${i * 11 + 8}, $${i * 11 + 9}, $${i * 11 + 10}, $${i * 11 + 11})`
    )
    .join(", ")

  const params = rankings.flatMap((r) => [
    r.keyword,
    r.url,
    r.position ?? null,
    r.clicks ?? 0,
    r.impressions ?? 0,
    r.ctr ?? null,
    r.source,
    r.country_code ?? "global",
    r.device ?? "all",
    r.metadata ? JSON.stringify(r.metadata) : null,
    r.collected_at ?? new Date(),
  ])

  // Count inserted rows based on the array length since query() returns T[]
  await query(
    `
    INSERT INTO seo_rankings (
      keyword, url, position, clicks, impressions, ctr,
      source, country_code, device, metadata, collected_at
    ) VALUES ${values}
  `,
    params
  )

  return rankings.length
}

/**
 * Get latest rankings for a keyword
 */
export async function getLatestRankings(
  keyword: string
): Promise<SeoRanking[]> {
  return query<SeoRanking>(
    `SELECT * FROM seo_latest_rankings WHERE keyword = $1`,
    [keyword]
  )
}

/**
 * Get ranking trends (comparison with previous check)
 */
export async function getRankingTrends(
  keyword?: string
): Promise<RankingTrend[]> {
  if (keyword) {
    return query<RankingTrend>(
      `SELECT * FROM seo_ranking_trends WHERE keyword = $1`,
      [keyword]
    )
  }
  return query<RankingTrend>(`SELECT * FROM seo_ranking_trends`)
}

/**
 * Get historical rankings for a keyword
 */
export async function getRankingHistory(
  keyword: string,
  limit = 30
): Promise<SeoRanking[]> {
  return query<SeoRanking>(
    `
    SELECT * FROM seo_rankings
    WHERE keyword = $1
    ORDER BY collected_at DESC
    LIMIT $2
  `,
    [keyword, limit]
  )
}

/**
 * Add a keyword to track
 */
export async function addKeyword(data: {
  keyword: string
  target_url?: string
  country_code?: string
  device?: string
  check_frequency_hours?: number
}): Promise<SeoKeyword> {
  const result = await queryOne<SeoKeyword>(
    `
    INSERT INTO seo_keywords (
      keyword, target_url, country_code, device, check_frequency_hours
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (keyword) DO UPDATE SET
      target_url = EXCLUDED.target_url,
      country_code = EXCLUDED.country_code,
      device = EXCLUDED.device,
      check_frequency_hours = EXCLUDED.check_frequency_hours,
      updated_at = NOW()
    RETURNING *
  `,
    [
      data.keyword,
      data.target_url ?? null,
      data.country_code ?? "global",
      data.device ?? "all",
      data.check_frequency_hours ?? 24,
    ]
  )

  if (!result) {
    throw new Error("Failed to add SEO keyword")
  }

  return result
}

/**
 * Get keywords that need to be checked
 */
export async function getKeywordsDueForCheck(): Promise<SeoKeyword[]> {
  return query<SeoKeyword>(
    `
    SELECT * FROM seo_keywords
    WHERE active = true
    AND (
      last_checked_at IS NULL
      OR last_checked_at < NOW() - (check_frequency_hours || ' hours')::INTERVAL
    )
    ORDER BY last_checked_at ASC NULLS FIRST
  `
  )
}

/**
 * Update last_checked_at timestamp for a keyword
 */
export async function markKeywordChecked(keyword: string): Promise<void> {
  await query(
    `UPDATE seo_keywords SET last_checked_at = NOW() WHERE keyword = $1`,
    [keyword]
  )
}

/**
 * Get all active keywords
 */
export async function getActiveKeywords(): Promise<SeoKeyword[]> {
  return query<SeoKeyword>(
    `SELECT * FROM seo_keywords WHERE active = true ORDER BY keyword`
  )
}

/**
 * Deactivate a keyword (stop tracking)
 */
export async function deactivateKeyword(keyword: string): Promise<void> {
  await query(`UPDATE seo_keywords SET active = false WHERE keyword = $1`, [
    keyword,
  ])
}
