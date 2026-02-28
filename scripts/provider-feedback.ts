/**
 * Provider Feedback System
 *
 * Tracks provider performance based on user satisfaction ratings.
 * Users only see "good/bad" — provider identity is hidden from the user.
 * Internally correlates ratings to providers for smart routing decisions.
 */

import * as path from "path";

export type Provider = "claude" | "codex" | "gemini";

export interface TaskProviderRecord {
  commandId: string;
  agentId: string;
  provider: Provider;
  taskCategory: string; // from model-router: "quick" | "writing" | "standard" | "visual" | "ultrabrain" or auto-detected
  success: boolean;
  elapsedMs?: number;
  timestamp: Date;
}

export interface UserFeedback {
  commandId: string;
  rating: "good" | "bad";
  timestamp: Date;
}

export interface ProviderScore {
  provider: Provider;
  totalTasks: number;
  ratedTasks: number;
  goodRatings: number;
  badRatings: number;
  satisfactionRate: number; // goodRatings / ratedTasks * 100
  successRate: number; // successful executions / totalTasks * 100
  avgElapsedMs: number;
}

export interface CategoryProviderScore {
  category: string;
  scores: ProviderScore[];
  recommended: Provider; // provider with highest satisfactionRate (min 5 ratings)
}

class ProviderFeedbackManager {
  private static instance: ProviderFeedbackManager;
  private db: any; // Use any to avoid importing Database at top level
  private dbPath: string;

  private constructor() {
    this.dbPath = path.resolve(__dirname, "..", ".omc", "provider-feedback.db");
    this.initDb();
  }

  private initDb() {
    try {
      // Lazy load better-sqlite3 to avoid bundling issues
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath);
      this.initializeSchema();
    } catch (error) {
      console.error("Failed to initialize provider feedback database:", error);
      throw error;
    }
  }

  static getInstance(): ProviderFeedbackManager {
    if (!ProviderFeedbackManager.instance) {
      ProviderFeedbackManager.instance = new ProviderFeedbackManager();
    }
    return ProviderFeedbackManager.instance;
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        task_category TEXT NOT NULL DEFAULT 'standard',
        success BOOLEAN NOT NULL,
        elapsed_ms INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_command_id ON provider_tasks(command_id);
      CREATE INDEX IF NOT EXISTS idx_provider ON provider_tasks(provider);
      CREATE INDEX IF NOT EXISTS idx_category ON provider_tasks(task_category);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON provider_tasks(timestamp);

      CREATE TABLE IF NOT EXISTS provider_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_id TEXT NOT NULL UNIQUE,
        rating TEXT NOT NULL CHECK(rating IN ('good', 'bad')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (command_id) REFERENCES provider_tasks(command_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rating_command ON provider_ratings(command_id);
    `);
  }

  recordTask(record: TaskProviderRecord): void {
    const stmt = this.db.prepare(
      `INSERT INTO provider_tasks (command_id, agent_id, provider, task_category, success, elapsed_ms, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      record.commandId,
      record.agentId,
      record.provider,
      record.taskCategory,
      record.success ? 1 : 0,
      record.elapsedMs || null,
      record.timestamp.toISOString()
    );
  }

  recordFeedback(feedback: UserFeedback): boolean {
    const task = this.db
      .prepare(`SELECT command_id FROM provider_tasks WHERE command_id = ?`)
      .get(feedback.commandId);

    if (!task) {
      return false;
    }

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO provider_ratings (command_id, rating, timestamp)
       VALUES (?, ?, ?)`
    );
    stmt.run(feedback.commandId, feedback.rating, feedback.timestamp.toISOString());
    return true;
  }

  getProviderScores(windowDays?: number): ProviderScore[] {
    let query = `
      SELECT
        pt.provider,
        COUNT(*) as total_tasks,
        SUM(CASE WHEN pt.success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(pr.rating) as rated_count,
        SUM(CASE WHEN pr.rating = 'good' THEN 1 ELSE 0 END) as good_count,
        SUM(CASE WHEN pr.rating = 'bad' THEN 1 ELSE 0 END) as bad_count,
        AVG(pt.elapsed_ms) as avg_elapsed
      FROM provider_tasks pt
      LEFT JOIN provider_ratings pr ON pt.command_id = pr.command_id
    `;

    const params: any[] = [];
    if (windowDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - windowDays);
      query += ` WHERE pt.timestamp >= ?`;
      params.push(cutoffDate.toISOString());
    }

    query += ` GROUP BY pt.provider`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      provider: string;
      total_tasks: number;
      success_count: number;
      rated_count: number;
      good_count: number;
      bad_count: number;
      avg_elapsed: number | null;
    }>;

    return rows.map((r) => ({
      provider: r.provider as Provider,
      totalTasks: r.total_tasks,
      ratedTasks: r.rated_count,
      goodRatings: r.good_count,
      badRatings: r.bad_count,
      satisfactionRate:
        r.rated_count > 0 ? Math.round((r.good_count / r.rated_count) * 10000) / 100 : 0,
      successRate: Math.round((r.success_count / r.total_tasks) * 10000) / 100,
      avgElapsedMs: Math.round(r.avg_elapsed || 0),
    }));
  }

  getCategoryScores(category: string, windowDays?: number): CategoryProviderScore {
    let query = `
      SELECT
        pt.provider,
        COUNT(*) as total_tasks,
        SUM(CASE WHEN pt.success = 1 THEN 1 ELSE 0 END) as success_count,
        COUNT(pr.rating) as rated_count,
        SUM(CASE WHEN pr.rating = 'good' THEN 1 ELSE 0 END) as good_count,
        SUM(CASE WHEN pr.rating = 'bad' THEN 1 ELSE 0 END) as bad_count,
        AVG(pt.elapsed_ms) as avg_elapsed
      FROM provider_tasks pt
      LEFT JOIN provider_ratings pr ON pt.command_id = pr.command_id
      WHERE pt.task_category = ?
    `;

    const params: any[] = [category];
    if (windowDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - windowDays);
      query += ` AND pt.timestamp >= ?`;
      params.push(cutoffDate.toISOString());
    }

    query += ` GROUP BY pt.provider`;

    const rows = this.db.prepare(query).all(...params) as Array<{
      provider: string;
      total_tasks: number;
      success_count: number;
      rated_count: number;
      good_count: number;
      bad_count: number;
      avg_elapsed: number | null;
    }>;

    const scores: ProviderScore[] = rows.map((r) => ({
      provider: r.provider as Provider,
      totalTasks: r.total_tasks,
      ratedTasks: r.rated_count,
      goodRatings: r.good_count,
      badRatings: r.bad_count,
      satisfactionRate:
        r.rated_count > 0 ? Math.round((r.good_count / r.rated_count) * 10000) / 100 : 0,
      successRate: Math.round((r.success_count / r.total_tasks) * 10000) / 100,
      avgElapsedMs: Math.round(r.avg_elapsed || 0),
    }));

    // Find recommended provider (highest satisfaction rate with min 5 ratings)
    const qualified = scores.filter((s) => s.ratedTasks >= 5);
    const recommended =
      qualified.length > 0
        ? qualified.reduce((best, current) =>
            current.satisfactionRate > best.satisfactionRate ? current : best
          ).provider
        : (scores[0]?.provider || "claude");

    return {
      category,
      scores,
      recommended,
    };
  }

  getRecommendedProvider(category: string): Provider | null {
    const query = `
      SELECT
        pt.provider,
        COUNT(pr.rating) as rated_count,
        SUM(CASE WHEN pr.rating = 'good' THEN 1 ELSE 0 END) as good_count
      FROM provider_tasks pt
      LEFT JOIN provider_ratings pr ON pt.command_id = pr.command_id
      WHERE pt.task_category = ?
      GROUP BY pt.provider
      HAVING rated_count >= 5
      ORDER BY (CAST(good_count AS REAL) / rated_count) DESC
      LIMIT 1
    `;

    const row = this.db.prepare(query).get(category) as
      | { provider: string; rated_count: number; good_count: number }
      | undefined;

    return row ? (row.provider as Provider) : null;
  }

  getRecentUnratedTasks(
    limit: number = 10
  ): Array<{ commandId: string; agentId: string; timestamp: Date }> {
    const query = `
      SELECT pt.command_id, pt.agent_id, pt.timestamp
      FROM provider_tasks pt
      LEFT JOIN provider_ratings pr ON pt.command_id = pr.command_id
      WHERE pr.rating IS NULL
      ORDER BY pt.timestamp DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(query).all(limit) as Array<{
      command_id: string;
      agent_id: string;
      timestamp: string;
    }>;

    return rows.map((r) => ({
      commandId: r.command_id,
      agentId: r.agent_id,
      timestamp: new Date(r.timestamp),
    }));
  }

  close(): void {
    this.db.close();
  }
}

// Convenience exports
export const recordProviderTask = (record: TaskProviderRecord) => {
  ProviderFeedbackManager.getInstance().recordTask(record);
};

export const recordProviderFeedback = (feedback: UserFeedback): boolean => {
  return ProviderFeedbackManager.getInstance().recordFeedback(feedback);
};

export const getProviderScores = (windowDays?: number): ProviderScore[] => {
  return ProviderFeedbackManager.getInstance().getProviderScores(windowDays);
};

export const getCategoryProviderScores = (
  category: string,
  windowDays?: number
): CategoryProviderScore => {
  return ProviderFeedbackManager.getInstance().getCategoryScores(category, windowDays);
};

export const getRecommendedProvider = (category: string): Provider | null => {
  return ProviderFeedbackManager.getInstance().getRecommendedProvider(category);
};

export const getRecentUnratedTasks = (
  limit?: number
): Array<{ commandId: string; agentId: string; timestamp: Date }> => {
  return ProviderFeedbackManager.getInstance().getRecentUnratedTasks(limit);
};

export const closeProviderFeedbackManager = () => {
  ProviderFeedbackManager.getInstance().close();
};
