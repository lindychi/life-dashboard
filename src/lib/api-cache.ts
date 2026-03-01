/**
 * Pre-configured cache instances for high-traffic API routes.
 *
 * TTLs are intentionally short to balance freshness vs. DB load:
 *   - projectMetricsCache: 5 s  (metrics change frequently)
 *   - okrObjectivesCache:  10 s (OKR data changes less often)
 *   - agentStatsCache:     30 s (agent stats are coarse-grained)
 *
 * Invalidation helpers are called from mutation routes (POST/PUT/DELETE)
 * and from SSE broadcast helpers so caches stay coherent on writes.
 */

import { LRUCache } from "./lru-cache";
import { broadcastSSE } from "./sse-broadcaster";

export const projectMetricsCache = new LRUCache<unknown>(50);
export const okrObjectivesCache = new LRUCache<unknown>(50);
export const agentStatsCache = new LRUCache<unknown>(20);

// TTLs (ms)
export const PROJECT_METRICS_TTL = 5_000;
export const OKR_OBJECTIVES_TTL = 10_000;
export const AGENT_STATS_TTL = 30_000;

/**
 * Invalidate all project-metrics cache entries and broadcast SSE event.
 * Call from mutation routes that change project metrics.
 */
export function invalidateProjectMetrics(projectId?: string): void {
  if (projectId) {
    projectMetricsCache.delete(projectId);
    projectMetricsCache.delete(`metrics:${projectId}`);
  } else {
    projectMetricsCache.clear();
  }

  broadcastSSE({
    type: "project:metrics:updated",
    data: { projectId: projectId ?? null, invalidated: true },
  });
}

/**
 * Invalidate OKR objectives cache and broadcast SSE event.
 * Call from mutation routes that change objectives or key results.
 */
export function invalidateOKR(objectiveId?: string): void {
  if (objectiveId) {
    okrObjectivesCache.delete(objectiveId);
    okrObjectivesCache.delete(`objective:${objectiveId}`);
  } else {
    okrObjectivesCache.clear();
  }

  broadcastSSE({
    type: "okr:objective:updated",
    data: { objectiveId: objectiveId ?? null, invalidated: true },
  });
}

/**
 * Invalidate agent stats cache and broadcast SSE event.
 * Call from mutation routes that change agent state.
 */
export function invalidateAgentStats(agentId?: string): void {
  if (agentId) {
    agentStatsCache.delete(agentId);
    agentStatsCache.delete(`stats:${agentId}`);
  } else {
    agentStatsCache.clear();
  }

  broadcastSSE({
    type: "task:status:changed",
    data: { agentId: agentId ?? null, invalidated: true },
  });
}
