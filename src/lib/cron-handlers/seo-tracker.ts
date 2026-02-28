// SEO Tracker Cron Handler
// Google Search Console 및 SERP API를 통한 일일 SEO 모니터링

import type { CronHandler, CronHandlerResult } from "../cron-handlers";
import { query, queryOne } from "../db";

interface GoogleSearchConsoleData {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  date: string;
}

interface SerpApiResult {
  keyword: string;
  rank: number;
  url: string;
  title: string;
  snippet: string;
  date: string;
}

interface SeoTrackerConfig {
  googleSearchConsoleKey?: string;
  serpApiKey?: string;
  trackingUrls?: string[];
  topKeywords?: string[];
  reportEmail?: string;
}

/**
 * Google Search Console에서 최근 7일 데이터 조회
 */
async function fetchGoogleSearchConsoleData(
  apiKey: string
): Promise<GoogleSearchConsoleData[]> {
  if (!apiKey) {
    console.warn("[seo-tracker] Google Search Console API key not configured");
    return [];
  }

  try {
    // 실제 구현에서는 Google API 클라이언트 사용
    // 예: const analytics = google.searchconsole({ version: 'v1', auth });
    console.log("[seo-tracker] Fetching Google Search Console data...");

    // Mock 데이터 (실제 구현에서는 API 호출)
    const mockData: GoogleSearchConsoleData[] = [
      {
        query: "seo monitoring tool",
        clicks: 5,
        impressions: 47,
        ctr: 10.64,
        position: 2.1,
        date: new Date().toISOString().split("T")[0],
      },
      {
        query: "dashboard analytics",
        clicks: 3,
        impressions: 32,
        ctr: 9.38,
        position: 1.8,
        date: new Date().toISOString().split("T")[0],
      },
    ];

    return mockData;
  } catch (error) {
    console.error("[seo-tracker] Failed to fetch Google Search Console data:", error);
    throw new Error(`Google Search Console API error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * SERP API에서 검색 순위 및 경쟁사 정보 조회
 */
async function fetchSerpApiData(
  apiKey: string,
  keywords: string[]
): Promise<SerpApiResult[]> {
  if (!apiKey) {
    console.warn("[seo-tracker] SERP API key not configured");
    return [];
  }

  try {
    console.log(`[seo-tracker] Fetching SERP data for ${keywords.length} keywords...`);

    // 실제 구현에서는 SERP API 호출
    // 예: const response = await fetch('https://serpapi.com/search?...');
    const results: SerpApiResult[] = [];

    for (const keyword of keywords) {
      // Mock 데이터
      results.push({
        keyword,
        rank: Math.floor(Math.random() * 20) + 1,
        url: "https://your-domain.com",
        title: "Your Site Title",
        snippet: "Sample snippet...",
        date: new Date().toISOString().split("T")[0],
      });
    }

    return results;
  } catch (error) {
    console.error("[seo-tracker] Failed to fetch SERP data:", error);
    throw new Error(`SERP API error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 수집한 SEO 데이터를 database에 저장
 */
async function storeSeoData(
  source: "gsc" | "serp",
  data: GoogleSearchConsoleData[] | SerpApiResult[]
): Promise<number> {
  if (data.length === 0) return 0;

  let insertedCount = 0;

  try {
    for (const item of data) {
      if (source === "gsc") {
        const gscItem = item as GoogleSearchConsoleData;
        await queryOne(
          `INSERT INTO seo_metrics (source, metric_date, keyword, clicks, impressions, ctr, avg_position, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (source, metric_date, keyword) DO UPDATE
           SET clicks = EXCLUDED.clicks, impressions = EXCLUDED.impressions, ctr = EXCLUDED.ctr, avg_position = EXCLUDED.avg_position`,
          ["gsc", gscItem.date, gscItem.query, gscItem.clicks, gscItem.impressions, gscItem.ctr, gscItem.position]
        );
        insertedCount++;
      } else {
        const serpItem = item as SerpApiResult;
        await queryOne(
          `INSERT INTO seo_metrics (source, metric_date, keyword, serp_rank, serp_url, serp_title, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (source, metric_date, keyword) DO UPDATE
           SET serp_rank = EXCLUDED.serp_rank, serp_url = EXCLUDED.serp_url, serp_title = EXCLUDED.serp_title`,
          ["serp", serpItem.date, serpItem.keyword, serpItem.rank, serpItem.url, serpItem.title]
        );
        insertedCount++;
      }
    }

    console.log(`[seo-tracker] Stored ${insertedCount} ${source.toUpperCase()} metrics`);
    return insertedCount;
  } catch (error) {
    console.error(`[seo-tracker] Failed to store ${source} data:`, error);
    throw error;
  }
}

/**
 * 순위 급변 감지 (전일 대비)
 */
async function detectRankChanges(): Promise<Array<{ keyword: string; change: number; oldRank: number; newRank: number }>> {
  try {
    const changes = await query<{
      keyword: string;
      old_rank: number;
      new_rank: number;
      change: number;
    }>(
      `SELECT
         keyword,
         LAG(serp_rank) OVER (PARTITION BY keyword ORDER BY metric_date DESC) as old_rank,
         serp_rank as new_rank,
         LAG(serp_rank) OVER (PARTITION BY keyword ORDER BY metric_date DESC) - serp_rank as change
       FROM seo_metrics
       WHERE source = 'serp' AND metric_date >= (CURRENT_DATE - INTERVAL '2 days')
       ORDER BY ABS(change) DESC NULLS LAST
       LIMIT 20`
    );

    const significantChanges = changes
      .filter((c) => c.old_rank && Math.abs(c.change) >= 3) // 3순위 이상 변동
      .map((c) => ({
        keyword: c.keyword,
        change: c.change,
        oldRank: c.old_rank!,
        newRank: c.new_rank,
      }));

    if (significantChanges.length > 0) {
      console.log(`[seo-tracker] Detected ${significantChanges.length} significant rank changes`);
    }

    return significantChanges;
  } catch (error) {
    console.error("[seo-tracker] Failed to detect rank changes:", error);
    return [];
  }
}

/**
 * 월간/주간 요약 리포트 생성
 */
async function generateSeoReport(period: "daily" | "weekly" | "monthly"): Promise<Record<string, unknown>> {
  try {
    const daysAgo = period === "daily" ? 1 : period === "weekly" ? 7 : 30;

    // 상위 성과 키워드
    const topKeywords = await query<{
      keyword: string;
      avg_clicks: number;
      avg_impressions: number;
      avg_ctr: number;
      avg_position: number;
    }>(
      `SELECT
         keyword,
         ROUND(AVG(clicks)::numeric, 2) as avg_clicks,
         ROUND(AVG(impressions)::numeric, 2) as avg_impressions,
         ROUND(AVG(ctr)::numeric, 2) as avg_ctr,
         ROUND(AVG(avg_position)::numeric, 2) as avg_position
       FROM seo_metrics
       WHERE source = 'gsc' AND metric_date >= (CURRENT_DATE - INTERVAL '${daysAgo} days')
       GROUP BY keyword
       ORDER BY avg_clicks DESC
       LIMIT 10`
    );

    // 순위 변동 키워드
    const rankingKeywords = await query<{
      keyword: string;
      avg_rank: number;
      count: number;
    }>(
      `SELECT
         keyword,
         ROUND(AVG(serp_rank)::numeric, 2) as avg_rank,
         COUNT(*) as count
       FROM seo_metrics
       WHERE source = 'serp' AND metric_date >= (CURRENT_DATE - INTERVAL '${daysAgo} days')
       GROUP BY keyword
       ORDER BY avg_rank ASC
       LIMIT 20`
    );

    // 전체 요약
    const summary = await queryOne<{
      total_clicks: number;
      total_impressions: number;
      avg_ctr: number;
      avg_position: number;
    }>(
      `SELECT
         COALESCE(SUM(clicks), 0) as total_clicks,
         COALESCE(SUM(impressions), 0) as total_impressions,
         ROUND(AVG(ctr)::numeric, 2) as avg_ctr,
         ROUND(AVG(avg_position)::numeric, 2) as avg_position
       FROM seo_metrics
       WHERE source = 'gsc' AND metric_date >= (CURRENT_DATE - INTERVAL '${daysAgo} days')`
    );

    return {
      period,
      daysIncluded: daysAgo,
      generatedAt: new Date().toISOString(),
      summary: summary || {
        total_clicks: 0,
        total_impressions: 0,
        avg_ctr: 0,
        avg_position: 0,
      },
      topKeywords: topKeywords.slice(0, 10),
      rankingKeywords: rankingKeywords.slice(0, 20),
    };
  } catch (error) {
    console.error("[seo-tracker] Failed to generate report:", error);
    throw error;
  }
}

/**
 * SEO Tracker 메인 핸들러
 */
export const seoTrackerHandler: CronHandler = async (context) => {
  const config = context.config as SeoTrackerConfig;
  const gscKey = config.googleSearchConsoleKey || process.env.GOOGLE_SEARCH_CONSOLE_KEY;
  const serpKey = config.serpApiKey || process.env.SERP_API_KEY;
  const topKeywords = config.topKeywords || [
    "seo monitoring",
    "dashboard analytics",
    "rank tracking",
  ];

  try {
    console.log("[seo-tracker] Starting SEO tracking cycle...");

    const startTime = Date.now();
    let totalMetricsCollected = 0;
    const results: Record<string, unknown> = {};

    // 1. Google Search Console 데이터 수집
    if (gscKey) {
      try {
        const gscData = await fetchGoogleSearchConsoleData(gscKey);
        const gscStored = await storeSeoData("gsc", gscData);
        totalMetricsCollected += gscStored;
        results.googleSearchConsole = {
          collected: gscData.length,
          stored: gscStored,
          status: "success",
        };
      } catch (error) {
        results.googleSearchConsole = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      results.googleSearchConsole = {
        status: "skipped",
        reason: "API key not configured",
      };
    }

    // 2. SERP API 데이터 수집
    if (serpKey) {
      try {
        const serpData = await fetchSerpApiData(serpKey, topKeywords);
        const serpStored = await storeSeoData("serp", serpData);
        totalMetricsCollected += serpStored;
        results.serpApi = {
          collected: serpData.length,
          stored: serpStored,
          status: "success",
        };
      } catch (error) {
        results.serpApi = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      results.serpApi = {
        status: "skipped",
        reason: "API key not configured",
      };
    }

    // 3. 순위 급변 감지
    const rankChanges = await detectRankChanges();
    results.rankChanges = {
      detected: rankChanges.length,
      items: rankChanges.slice(0, 5),
    };

    // 4. 일일 리포트 생성
    const dailyReport = await generateSeoReport("daily");
    results.dailyReport = dailyReport;

    // 5. 실행 시간
    const duration = Date.now() - startTime;

    console.log(
      `[seo-tracker] Completed in ${duration}ms. Collected ${totalMetricsCollected} metrics.`
    );

    return {
      message: `SEO tracking completed: ${totalMetricsCollected} metrics collected`,
      data: {
        ...results,
        metricsCollected: totalMetricsCollected,
        durationMs: duration,
        executedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[seo-tracker] Handler failed:", error);
    throw new Error(`SEO Tracker failed: ${errorMsg}`);
  }
};
