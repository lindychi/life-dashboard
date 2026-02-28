/**
 * Agent Intelligence System
 *
 * Tracks agent performance metrics and automatically promotes models based on failure rates.
 * Uses better-sqlite3 for efficient local persistence.
 *
 * Features:
 * - Per-agent task result recording (success/failure)
 * - Failure rate tracking and trend analysis
 * - Automatic model tier promotion (haiku → sonnet → opus) when failure rate exceeds 30%
 * - Performance statistics and promotion history
 */

import * as path from "path";
import Database from "better-sqlite3";

export type ModelTier = "haiku" | "sonnet" | "opus";

export interface AgentStats {
  agentId: string;
  totalTasks: number;
  successTasks: number;
  failedTasks: number;
  successRate: number;
  failureRate: number;
  currentModelTier: ModelTier;
  promotionCount: number;
  lastPromotionAt?: Date;
  lastTaskAt?: Date;
}

export interface TaskResult {
  agentId: string;
  success: boolean;
  timestamp: Date;
  taskDuration?: number;
  error?: string;
}

export interface PromotionEvent {
  agentId: string;
  fromTier: ModelTier;
  toTier: ModelTier;
  failureRate: number;
  timestamp: Date;
}

class AgentIntelligenceManager {
  private static instance: AgentIntelligenceManager;
  private db: Database.Database;
  private dbPath: string;

  private constructor() {
    this.dbPath = path.resolve(__dirname, "..", ".omc", "agent-intelligence.db");
    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  static getInstance(): AgentIntelligenceManager {
    if (!AgentIntelligenceManager.instance) {
      AgentIntelligenceManager.instance = new AgentIntelligenceManager();
    }
    return AgentIntelligenceManager.instance;
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        task_duration INTEGER,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_id ON task_results(agent_id);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON task_results(timestamp);
      CREATE INDEX IF NOT EXISTS idx_agent_timestamp ON task_results(agent_id, timestamp);

      CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        from_tier TEXT NOT NULL,
        to_tier TEXT NOT NULL,
        failure_rate REAL NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_promotion_agent ON promotions(agent_id);
    `);
  }

  recordTaskResult(result: TaskResult): void {
    const stmt = this.db.prepare(
      `INSERT INTO task_results (agent_id, success, timestamp, task_duration, error)
       VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(
      result.agentId,
      result.success ? 1 : 0,
      result.timestamp.toISOString(),
      result.taskDuration || null,
      result.error || null
    );
  }

  getAgentStats(agentId: string, windowDays: number = 30): AgentStats {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - windowDays);

    const rows = this.db
      .prepare(
        `SELECT success, COUNT(*) as count FROM task_results
         WHERE agent_id = ? AND timestamp >= ?
         GROUP BY success`
      )
      .all(agentId, cutoffDate.toISOString()) as Array<{ success: number; count: number }>;

    const successCount = rows.find((r) => r.success === 1)?.count || 0;
    const failureCount = rows.find((r) => r.success === 0)?.count || 0;
    const totalCount = successCount + failureCount;

    const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 100;
    const failureRate = totalCount > 0 ? (failureCount / totalCount) * 100 : 0;

    const promotionRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM promotions WHERE agent_id = ?`)
      .get(agentId) as { count: number };

    const lastTask = this.db
      .prepare(
        `SELECT timestamp FROM task_results WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 1`
      )
      .get(agentId) as { timestamp: string } | undefined;

    const lastPromotion = this.db
      .prepare(
        `SELECT timestamp FROM promotions WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 1`
      )
      .get(agentId) as { timestamp: string } | undefined;

    return {
      agentId,
      totalTasks: totalCount,
      successTasks: successCount,
      failedTasks: failureCount,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      currentModelTier: getCurrentModelTier(agentId),
      promotionCount: promotionRow.count,
      lastPromotionAt: lastPromotion ? new Date(lastPromotion.timestamp) : undefined,
      lastTaskAt: lastTask ? new Date(lastTask.timestamp) : undefined,
    };
  }

  checkForPromotion(agentId: string): ModelTier | null {
    const stats = this.getAgentStats(agentId);

    if (stats.failureRate < 30) {
      return null;
    }

    const currentTier = getCurrentModelTier(agentId);

    if (currentTier === "opus") {
      return null;
    }

    if (stats.lastPromotionAt) {
      const hoursSincePromotion =
        (Date.now() - stats.lastPromotionAt.getTime()) / (1000 * 60 * 60);
      if (hoursSincePromotion < 24) {
        return null;
      }
    }

    const promotionMap: Record<ModelTier, ModelTier> = {
      haiku: "sonnet",
      sonnet: "opus",
      opus: "opus",
    };

    return promotionMap[currentTier];
  }

  markPromoted(agentId: string, fromTier: ModelTier, toTier: ModelTier): void {
    const stats = this.getAgentStats(agentId);
    const stmt = this.db.prepare(
      `INSERT INTO promotions (agent_id, from_tier, to_tier, failure_rate, timestamp)
       VALUES (?, ?, ?, ?, ?)`
    );
    stmt.run(agentId, fromTier, toTier, stats.failureRate, new Date().toISOString());

    console.log(
      `✅ [Agent Intelligence] Promoted ${agentId}: ${fromTier} → ${toTier} (failureRate: ${stats.failureRate.toFixed(1)}%)`
    );
  }

  getPromotionHistory(agentId: string, limit: number = 10): PromotionEvent[] {
    const rows = this.db
      .prepare(
        `SELECT agent_id, from_tier, to_tier, failure_rate, timestamp
         FROM promotions
         WHERE agent_id = ?
         ORDER BY timestamp DESC
         LIMIT ?`
      )
      .all(agentId, limit) as Array<{
      agent_id: string;
      from_tier: string;
      to_tier: string;
      failure_rate: number;
      timestamp: string;
    }>;

    return rows.map((r) => ({
      agentId: r.agent_id,
      fromTier: r.from_tier as ModelTier,
      toTier: r.to_tier as ModelTier,
      failureRate: r.failure_rate,
      timestamp: new Date(r.timestamp),
    }));
  }

  getAllAgentStats(windowDays: number = 30): AgentStats[] {
    const agentIds = this.db
      .prepare(
        `SELECT DISTINCT agent_id FROM task_results
         WHERE timestamp >= datetime('now', '-' || ? || ' days')
         ORDER BY agent_id`
      )
      .all(windowDays) as Array<{ agent_id: string }>;

    return agentIds.map((row) => this.getAgentStats(row.agent_id, windowDays));
  }

  close(): void {
    this.db.close();
  }
}

function getCurrentModelTier(agentId: string): ModelTier {
  const defaultModels: Record<string, ModelTier> = {
    pm: "sonnet",
    dev: "sonnet",
    designer: "sonnet",
    qa: "sonnet",
    devops: "haiku",
    growth: "haiku",
    finance: "haiku",
    researcher: "haiku",
    analyst: "sonnet",
    assistant: "haiku",
    learner: "sonnet",
  };

  return defaultModels[agentId] || "sonnet";
}

export const recordTaskResult = (result: TaskResult) => {
  AgentIntelligenceManager.getInstance().recordTaskResult(result);
};

export const checkForPromotion = (agentId: string): ModelTier | null => {
  return AgentIntelligenceManager.getInstance().checkForPromotion(agentId);
};

export const markPromoted = (agentId: string, fromTier: ModelTier, toTier: ModelTier) => {
  AgentIntelligenceManager.getInstance().markPromoted(agentId, fromTier, toTier);
};

export const getAgentStats = (agentId: string, windowDays?: number): AgentStats => {
  return AgentIntelligenceManager.getInstance().getAgentStats(agentId, windowDays);
};

export const getPromotionHistory = (agentId: string, limit?: number): PromotionEvent[] => {
  return AgentIntelligenceManager.getInstance().getPromotionHistory(agentId, limit);
};

export const getAllAgentStats = (windowDays?: number): AgentStats[] => {
  return AgentIntelligenceManager.getInstance().getAllAgentStats(windowDays);
};

export const closeIntelligenceManager = () => {
  AgentIntelligenceManager.getInstance().close();
};
