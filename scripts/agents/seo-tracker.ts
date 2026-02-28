#!/usr/bin/env node
/**
 * SEO Tracker Agent
 * Monitors keyword rankings using Google Search Console API and SerpAPI
 *
 * Features:
 * - Google Search Console integration for owned sites
 * - SerpAPI integration for competitive analysis
 * - Automatic retry with exponential backoff
 * - Rate limiting to prevent API quota exhaustion
 * - Batched database writes for efficiency
 */

import { google } from "googleapis"
import axios from "axios"
import {
  saveRankingsBatch,
  getKeywordsDueForCheck,
  markKeywordChecked,
  addKeyword,
  getActiveKeywords,
} from "../../src/lib/seo"
import { addHistoryEntry } from "../../src/lib/history"

const AGENT_ID = "seo-tracker"

// API Configuration
const GSC_CREDENTIALS_PATH = process.env.GSC_CREDENTIALS_PATH // Path to Google service account JSON
const GSC_SITE_URL = process.env.GSC_SITE_URL // e.g., "https://example.com"
const SERPAPI_KEY = process.env.SERPAPI_KEY
const SERPAPI_BASE_URL = "https://serpapi.com/search.json"

// Rate Limiting Configuration
const GSC_REQUESTS_PER_MINUTE = 10
const SERPAPI_REQUESTS_PER_MINUTE = 50
const REQUEST_DELAY_MS = 1000 // Delay between batches

// Retry Configuration
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000
const BACKOFF_MULTIPLIER = 2

interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface SerpApiResult {
  position: number
  link: string
  title: string
  snippet?: string
}

/**
 * Sleep utility for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries = MAX_RETRIES
): Promise<T> {
  let lastError: Error | unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const isRateLimitError =
        axios.isAxiosError(error) &&
        (error.response?.status === 429 || error.response?.status === 503)

      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1)
        await addHistoryEntry(AGENT_ID, {
          type: "output",
          content: `⚠️ ${operation} failed (attempt ${attempt}/${retries}). Retrying in ${delay}ms...`,
          metadata: { error: String(error), attempt },
        })
        await sleep(delay)
      } else {
        await addHistoryEntry(AGENT_ID, {
          type: "task_failed",
          content: `❌ ${operation} failed after ${retries} attempts: ${String(lastError)}`,
          metadata: { error: String(lastError), attempts: retries },
        })
      }
    }
  }

  throw new Error(`${operation} failed after ${retries} retries: ${String(lastError)}`)
}

/**
 * Initialize Google Search Console API client
 */
async function initGscClient() {
  if (!GSC_CREDENTIALS_PATH || !GSC_SITE_URL) {
    throw new Error(
      "GSC_CREDENTIALS_PATH and GSC_SITE_URL must be set in environment"
    )
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: GSC_CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  })

  const authClient = await auth.getClient()
  return google.searchconsole({ version: "v1", auth: authClient })
}

/**
 * Fetch keyword rankings from Google Search Console
 */
async function fetchGscRankings(keywords: string[]): Promise<
  Array<{
    keyword: string
    url: string
    position: number
    clicks: number
    impressions: number
    ctr: number
    source: "gsc"
  }>
> {
  if (keywords.length === 0) return []

  const gsc = await initGscClient()

  return withRetry(
    async () => {
      const endDate = new Date().toISOString().split("T")[0]
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0]

      const response = await gsc.searchanalytics.query({
        siteUrl: GSC_SITE_URL,
        requestBody: {
          startDate,
          endDate,
          dimensions: ["query", "page"],
          dimensionFilterGroups: [
            {
              filters: keywords.map((keyword) => ({
                dimension: "query",
                operator: "equals",
                expression: keyword,
              })),
            },
          ],
          rowLimit: 1000,
        },
      })

      const rows: GscRow[] = (response.data.rows as GscRow[]) || []

      return rows.map((row) => ({
        keyword: row.keys[0],
        url: row.keys[1],
        position: Math.round(row.position),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        source: "gsc" as const,
      }))
    },
    `GSC API request for ${keywords.length} keywords`
  )
}

/**
 * Fetch keyword ranking from SerpAPI
 */
async function fetchSerpApiRanking(
  keyword: string,
  targetUrl?: string,
  countryCode = "global",
  device = "desktop"
): Promise<{
  keyword: string
  url: string
  position: number | null
  clicks: number
  impressions: number
  ctr: number | null
  source: "serpapi"
  metadata?: Record<string, unknown>
} | null> {
  if (!SERPAPI_KEY) {
    throw new Error("SERPAPI_KEY must be set in environment")
  }

  return withRetry(
    async () => {
      const params: Record<string, string> = {
        api_key: SERPAPI_KEY,
        q: keyword,
        engine: "google",
        num: "100", // Get top 100 results
      }

      if (countryCode !== "global") {
        params.gl = countryCode
      }

      if (device === "mobile") {
        params.device = "mobile"
      }

      const response = await axios.get(SERPAPI_BASE_URL, {
        params,
        timeout: 15000,
      })

      const results: SerpApiResult[] = response.data.organic_results || []

      // Find target URL in results
      let position: number | null = null
      let matchedUrl = targetUrl || ""

      if (targetUrl) {
        const match = results.find((r) => r.link.includes(targetUrl))
        if (match) {
          position = match.position
          matchedUrl = match.link
        }
      } else if (results.length > 0) {
        // If no target URL, return top result
        position = results[0].position
        matchedUrl = results[0].link
      }

      if (position === null) {
        return null // Not found in top 100
      }

      return {
        keyword,
        url: matchedUrl,
        position,
        clicks: 0, // SerpAPI doesn't provide clicks
        impressions: 0, // SerpAPI doesn't provide impressions
        ctr: null, // SerpAPI doesn't provide CTR
        source: "serpapi" as const,
        metadata: {
          total_results: results.length,
          device,
          country_code: countryCode,
        },
      }
    },
    `SerpAPI request for keyword: ${keyword}`
  )
}

/**
 * Process keywords in batches to respect rate limits
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>,
  delayMs: number
): Promise<R[]> {
  const results: R[] = []

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await processor(batch)
    results.push(...batchResults)

    // Rate limiting delay
    if (i + batchSize < items.length) {
      await sleep(delayMs)
    }
  }

  return results
}

/**
 * Main tracking function
 */
async function trackKeywords() {
  await addHistoryEntry(AGENT_ID, {
    type: "task_started",
    content: "🔍 Starting SEO keyword tracking...",
  })

  try {
    // Get keywords that need checking
    const keywords = await getKeywordsDueForCheck()

    if (keywords.length === 0) {
      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: "✅ No keywords due for checking",
      })
      return
    }

    await addHistoryEntry(AGENT_ID, {
      type: "output",
      content: `📊 Tracking ${keywords.length} keywords...`,
    })

    const allRankings: Array<{
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
    }> = []

    // Step 1: Google Search Console (if configured)
    if (GSC_CREDENTIALS_PATH && GSC_SITE_URL) {
      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: "📈 Fetching data from Google Search Console...",
      })

      const gscKeywords = keywords.map((k) => k.keyword)
      const gscBatchSize = Math.min(
        GSC_REQUESTS_PER_MINUTE,
        Math.ceil(gscKeywords.length / 5)
      )

      const gscRankings = await processBatch(
        [gscKeywords], // Single batch for GSC
        1,
        (batch) => fetchGscRankings(batch[0]),
        REQUEST_DELAY_MS
      )

      allRankings.push(...gscRankings)

      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: `✅ GSC: Collected ${gscRankings.length} rankings`,
      })
    }

    // Step 2: SerpAPI (if configured)
    if (SERPAPI_KEY) {
      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: "🔎 Fetching data from SerpAPI...",
      })

      const serpBatchSize = Math.floor(SERPAPI_REQUESTS_PER_MINUTE / 10)
      const serpRankings = await processBatch(
        keywords,
        serpBatchSize,
        async (batch) => {
          const results = await Promise.all(
            batch.map((k) =>
              fetchSerpApiRanking(k.keyword, k.target_url || undefined, k.country_code, k.device)
            )
          )
          return results.filter((r): r is NonNullable<typeof r> => r !== null)
        },
        REQUEST_DELAY_MS
      )

      allRankings.push(...serpRankings)

      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: `✅ SerpAPI: Collected ${serpRankings.length} rankings`,
      })
    }

    // Step 3: Save to database
    if (allRankings.length > 0) {
      const saved = await saveRankingsBatch(allRankings)

      await addHistoryEntry(AGENT_ID, {
        type: "output",
        content: `💾 Saved ${saved} rankings to database`,
      })
    }

    // Step 4: Mark keywords as checked
    await Promise.all(keywords.map((k) => markKeywordChecked(k.keyword)))

    await addHistoryEntry(AGENT_ID, {
      type: "task_completed",
      content: `✅ SEO tracking completed: ${allRankings.length} rankings collected`,
      metadata: {
        keywords_checked: keywords.length,
        rankings_saved: allRankings.length,
      },
    })
  } catch (error) {
    await addHistoryEntry(AGENT_ID, {
      type: "task_failed",
      content: `❌ SEO tracking failed: ${String(error)}`,
      metadata: { error: String(error) },
    })
    throw error
  }
}

/**
 * CLI entry point
 */
async function main() {
  const command = process.argv[2]

  switch (command) {
    case "track":
      await trackKeywords()
      break

    case "add-keyword": {
      const keyword = process.argv[3]
      const targetUrl = process.argv[4]

      if (!keyword) {
        console.error("Usage: seo-tracker.ts add-keyword <keyword> [targetUrl]")
        process.exit(1)
      }

      const result = await addKeyword({ keyword, target_url: targetUrl })
      console.log(`✅ Added keyword: ${result.keyword}`)
      break
    }

    case "list-keywords": {
      const keywords = await getActiveKeywords()
      console.log(`📋 Active keywords (${keywords.length}):`)
      keywords.forEach((k) => {
        console.log(
          `  • ${k.keyword} (check every ${k.check_frequency_hours}h, last: ${k.last_checked_at || "never"})`
        )
      })
      break
    }

    default:
      console.log(`SEO Tracker Agent

Usage:
  seo-tracker.ts track                    - Track all due keywords
  seo-tracker.ts add-keyword <keyword>    - Add a keyword to track
  seo-tracker.ts list-keywords            - List all active keywords

Environment Variables:
  GSC_CREDENTIALS_PATH   - Path to Google service account JSON
  GSC_SITE_URL          - Google Search Console site URL
  SERPAPI_KEY           - SerpAPI key for competitive analysis
`)
      process.exit(1)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}

export { trackKeywords, fetchGscRankings, fetchSerpApiRanking }
