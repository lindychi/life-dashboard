// 일일 개인 비서 Cron Handler
// 매일 agent 활동 데이터를 분석하여 사용자 인사이트를 생성하고 브리핑 메시지를 전송

import { query, queryOne } from "../db";
import { sendMessage } from "../messages";
import {
  registerCronHandler,
  type CronHandlerContext,
  type CronHandlerResult,
} from "../cron-handlers";

// ─── 타입 정의 ────────────────────────────────────────────

interface HistoryRow {
  id: string;
  agent_id: string;
  type: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  request_group_id: string | null;
  request_title: string | null;
}

interface MessageRow {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  type: string;
  created_at: string;
}

interface TopicEntry {
  topic: string;
  count: number;
  agents: string[];
}

interface Patterns {
  peakHours: number[];
  mostActiveAgent: string | null;
  taskSuccessRate: number;
  avgMessagesPerAgent: number;
  mostUsedTaskType: string | null;
}

interface Preferences {
  preferredAgents: string[];
  commonTaskTypes: string[];
  activeTimeRange: { start: number; end: number } | null;
}

interface UserInsightRow {
  id: string;
  date: string;
  daily_summary: string;
  topics: TopicEntry[];
  patterns: Patterns;
  preferences: Preferences;
  history_count: number;
  message_count: number;
  created_at: string;
}

// ─── 데이터 수집 함수 ─────────────────────────────────────

/**
 * 당일 agent_history 엔트리 조회
 */
async function getTodayHistory(targetDate: string): Promise<HistoryRow[]> {
  return query<HistoryRow>(
    `SELECT id, agent_id, type, content, metadata, created_at,
            request_group_id, request_title
     FROM agent_history
     WHERE created_at::date = $1::date
     ORDER BY created_at ASC`,
    [targetDate]
  );
}

/**
 * 당일 messages 조회
 */
async function getTodayMessages(targetDate: string): Promise<MessageRow[]> {
  return query<MessageRow>(
    `SELECT id, from_id, to_id, content, type, created_at
     FROM messages
     WHERE created_at::date = $1::date
     ORDER BY created_at ASC`,
    [targetDate]
  );
}

/**
 * 최근 N일간의 user_insights 조회 (개인화를 위한 이전 데이터 참조)
 */
async function getRecentInsights(
  days: number = 7
): Promise<UserInsightRow[]> {
  return query<UserInsightRow>(
    `SELECT id, date, daily_summary, topics, patterns, preferences,
            history_count, message_count, created_at
     FROM user_insights
     WHERE date >= CURRENT_DATE - $1::integer
     ORDER BY date DESC`,
    [days]
  );
}

// ─── 분석 함수 ────────────────────────────────────────────

/**
 * 히스토리와 메시지에서 토픽 추출
 */
function extractTopics(
  history: HistoryRow[],
  messages: MessageRow[]
): TopicEntry[] {
  const topicMap = new Map<string, { count: number; agents: Set<string> }>();

  // 히스토리에서 토픽 추출 (request_title 기반)
  for (const entry of history) {
    const topic = entry.request_title || categorizeContent(entry.content);
    if (!topic) continue;

    const normalized = topic.toLowerCase().trim();
    const existing = topicMap.get(normalized) || {
      count: 0,
      agents: new Set<string>(),
    };
    existing.count++;
    existing.agents.add(entry.agent_id);
    topicMap.set(normalized, existing);
  }

  // 메시지에서 토픽 추출 (task/result 타입)
  for (const msg of messages) {
    if (msg.type === "task" || msg.type === "result") {
      const topic = categorizeContent(msg.content);
      if (!topic) continue;

      const normalized = topic.toLowerCase().trim();
      const existing = topicMap.get(normalized) || {
        count: 0,
        agents: new Set<string>(),
      };
      existing.count++;
      existing.agents.add(msg.from_id);
      topicMap.set(normalized, existing);
    }
  }

  return Array.from(topicMap.entries())
    .map(([topic, data]) => ({
      topic,
      count: data.count,
      agents: Array.from(data.agents),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20); // 상위 20개 토픽
}

/**
 * 콘텐츠를 간단한 카테고리로 분류
 */
function categorizeContent(content: string): string | null {
  if (!content) return null;

  const lower = content.toLowerCase();
  const keywords: Record<string, string[]> = {
    build: ["build", "compile", "bundle", "webpack", "vite"],
    test: ["test", "spec", "jest", "vitest", "coverage"],
    deploy: ["deploy", "release", "ci/cd", "pipeline", "docker"],
    debug: ["debug", "error", "fix", "bug", "issue"],
    feature: ["feature", "implement", "add", "create", "new"],
    refactor: ["refactor", "cleanup", "optimize", "improve"],
    docs: ["doc", "readme", "comment", "documentation"],
    config: ["config", "env", "setting", "setup"],
    database: ["db", "sql", "migration", "query", "postgres"],
    api: ["api", "endpoint", "route", "request", "response"],
    auth: ["auth", "login", "token", "session", "permission"],
    ui: ["ui", "component", "style", "css", "frontend", "design"],
  };

  for (const [category, words] of Object.entries(keywords)) {
    if (words.some((w) => lower.includes(w))) {
      return category;
    }
  }

  // 50자 이하면 그대로 사용, 아니면 앞부분만
  return content.length <= 50 ? content : content.substring(0, 50);
}

/**
 * 활동 패턴 분석
 */
function analyzePatterns(
  history: HistoryRow[],
  messages: MessageRow[]
): Patterns {
  // 시간대별 활동량
  const hourCounts = new Map<number, number>();
  const allTimestamps = [
    ...history.map((h) => new Date(h.created_at)),
    ...messages.map((m) => new Date(m.created_at)),
  ];

  for (const ts of allTimestamps) {
    const hour = ts.getHours();
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  }

  // 피크 시간대 (상위 3개)
  const peakHours = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour]) => hour)
    .sort((a, b) => a - b);

  // 가장 활동적인 에이전트
  const agentActivity = new Map<string, number>();
  for (const entry of history) {
    agentActivity.set(
      entry.agent_id,
      (agentActivity.get(entry.agent_id) || 0) + 1
    );
  }
  for (const msg of messages) {
    if (msg.from_id !== "user" && msg.from_id !== "system") {
      agentActivity.set(
        msg.from_id,
        (agentActivity.get(msg.from_id) || 0) + 1
      );
    }
  }

  const mostActiveAgent =
    Array.from(agentActivity.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    null;

  // 태스크 성공률
  const completed = history.filter(
    (h) => h.type === "task_completed"
  ).length;
  const failed = history.filter((h) => h.type === "task_failed").length;
  const totalTasks = completed + failed;
  const taskSuccessRate =
    totalTasks > 0 ? Math.round((completed / totalTasks) * 100) : 0;

  // 에이전트별 평균 메시지 수
  const uniqueAgents = new Set([
    ...history.map((h) => h.agent_id),
    ...messages
      .map((m) => m.from_id)
      .filter((id) => id !== "user" && id !== "system"),
  ]);
  const avgMessagesPerAgent =
    uniqueAgents.size > 0
      ? Math.round(messages.length / uniqueAgents.size)
      : 0;

  // 가장 많이 사용된 태스크 타입
  const typeCounts = new Map<string, number>();
  for (const entry of history) {
    typeCounts.set(entry.type, (typeCounts.get(entry.type) || 0) + 1);
  }
  const mostUsedTaskType =
    Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    null;

  return {
    peakHours,
    mostActiveAgent,
    taskSuccessRate,
    avgMessagesPerAgent,
    mostUsedTaskType,
  };
}

/**
 * 사용자 선호도 추론
 */
function inferPreferences(
  history: HistoryRow[],
  messages: MessageRow[],
  recentInsights: UserInsightRow[]
): Preferences {
  // 자주 사용하는 에이전트 (현재 + 누적)
  const agentUsage = new Map<string, number>();

  for (const entry of history) {
    agentUsage.set(
      entry.agent_id,
      (agentUsage.get(entry.agent_id) || 0) + 1
    );
  }

  // 이전 인사이트에서 선호 에이전트 가중치 추가
  for (const insight of recentInsights) {
    const prefs = insight.preferences as Preferences;
    if (prefs?.preferredAgents) {
      for (const agent of prefs.preferredAgents) {
        agentUsage.set(agent, (agentUsage.get(agent) || 0) + 0.5);
      }
    }
  }

  const preferredAgents = Array.from(agentUsage.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agent]) => agent);

  // 자주 사용하는 태스크 타입
  const taskTypes = new Map<string, number>();
  for (const entry of history) {
    taskTypes.set(entry.type, (taskTypes.get(entry.type) || 0) + 1);
  }
  const commonTaskTypes = Array.from(taskTypes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type]) => type);

  // 활동 시간대 범위
  const timestamps = [
    ...history.map((h) => new Date(h.created_at)),
    ...messages.map((m) => new Date(m.created_at)),
  ];

  let activeTimeRange: { start: number; end: number } | null = null;
  if (timestamps.length > 0) {
    const hours = timestamps.map((ts) => ts.getHours());
    activeTimeRange = {
      start: Math.min(...hours),
      end: Math.max(...hours),
    };
  }

  return { preferredAgents, commonTaskTypes, activeTimeRange };
}

/**
 * 일일 요약 텍스트 생성
 */
function generateDailySummary(
  history: HistoryRow[],
  messages: MessageRow[],
  topics: TopicEntry[],
  patterns: Patterns
): string {
  const parts: string[] = [];

  // 기본 통계
  const completed = history.filter(
    (h) => h.type === "task_completed"
  ).length;
  const failed = history.filter((h) => h.type === "task_failed").length;
  const started = history.filter((h) => h.type === "task_started").length;

  parts.push(
    `총 ${history.length}건의 히스토리, ${messages.length}건의 메시지가 기록되었습니다.`
  );

  if (started > 0) {
    parts.push(
      `태스크: ${started}건 시작, ${completed}건 완료, ${failed}건 실패 (성공률 ${patterns.taskSuccessRate}%)`
    );
  }

  // 주요 토픽
  if (topics.length > 0) {
    const topTopics = topics.slice(0, 5).map((t) => t.topic);
    parts.push(`주요 토픽: ${topTopics.join(", ")}`);
  }

  // 활동 패턴
  if (patterns.mostActiveAgent) {
    parts.push(`가장 활동적인 에이전트: ${patterns.mostActiveAgent}`);
  }

  if (patterns.peakHours.length > 0) {
    const peakStr = patterns.peakHours.map((h) => `${h}시`).join(", ");
    parts.push(`피크 시간대: ${peakStr}`);
  }

  return parts.join(" ");
}

/**
 * 오늘의 브리핑 메시지 생성
 * 이전 인사이트를 참조하여 개인화된 브리핑 제공
 */
function generateBriefingMessage(
  todaySummary: string,
  topics: TopicEntry[],
  patterns: Patterns,
  preferences: Preferences,
  recentInsights: UserInsightRow[]
): string {
  const lines: string[] = [];
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  lines.push(`📋 **일일 브리핑** (${dateStr})`);
  lines.push("");

  // 어제 요약
  lines.push("### 📊 어제 활동 요약");
  lines.push(todaySummary);
  lines.push("");

  // 주요 토픽
  if (topics.length > 0) {
    lines.push("### 🏷️ 주요 작업 토픽");
    for (const topic of topics.slice(0, 5)) {
      const agentStr = topic.agents.join(", ");
      lines.push(`- **${topic.topic}** (${topic.count}건, 에이전트: ${agentStr})`);
    }
    lines.push("");
  }

  // 트렌드 분석 (이전 인사이트 기반)
  if (recentInsights.length >= 2) {
    lines.push("### 📈 트렌드");

    // 활동량 추세
    const recentCounts = recentInsights
      .slice(0, 7)
      .map((i) => i.history_count + i.message_count);
    const avg = recentCounts.reduce((a, b) => a + b, 0) / recentCounts.length;
    const latestCount = recentCounts[0] || 0;

    if (latestCount > avg * 1.3) {
      lines.push("- 📈 최근 활동량이 평균 대비 높습니다. 활발한 개발 중!");
    } else if (latestCount < avg * 0.7) {
      lines.push("- 📉 최근 활동량이 평균보다 낮습니다.");
    } else {
      lines.push("- ➡️ 활동량이 안정적인 수준을 유지하고 있습니다.");
    }

    // 반복 토픽 감지
    const allTopics = new Map<string, number>();
    for (const insight of recentInsights) {
      const insightTopics = insight.topics as TopicEntry[];
      if (Array.isArray(insightTopics)) {
        for (const t of insightTopics) {
          allTopics.set(t.topic, (allTopics.get(t.topic) || 0) + t.count);
        }
      }
    }
    const recurringTopics = Array.from(allTopics.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (recurringTopics.length > 0) {
      const topicNames = recurringTopics.map(([t]) => t).join(", ");
      lines.push(`- 🔄 반복 주제: ${topicNames} (지속적으로 작업 중)`);
    }

    // 성공률 트렌드
    const recentRates = recentInsights
      .slice(0, 7)
      .map((i) => (i.patterns as Patterns)?.taskSuccessRate)
      .filter((r): r is number => r !== undefined && r !== null);
    if (recentRates.length >= 2) {
      const avgRate = recentRates.reduce((a, b) => a + b, 0) / recentRates.length;
      lines.push(`- 🎯 최근 7일 평균 태스크 성공률: ${Math.round(avgRate)}%`);
    }

    lines.push("");
  }

  // 맞춤 인사이트
  if (preferences.preferredAgents.length > 0) {
    lines.push("### 💡 인사이트");
    lines.push(
      `- 자주 사용하는 에이전트: ${preferences.preferredAgents.slice(0, 3).join(", ")}`
    );

    if (preferences.activeTimeRange) {
      lines.push(
        `- 주로 활동하는 시간대: ${preferences.activeTimeRange.start}시 ~ ${preferences.activeTimeRange.end}시`
      );
    }

    if (preferences.commonTaskTypes.length > 0) {
      lines.push(
        `- 주요 작업 유형: ${preferences.commonTaskTypes.slice(0, 3).join(", ")}`
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("*이 브리핑은 매일 자동 생성됩니다. 데이터가 쌓일수록 더 정확한 인사이트를 제공합니다.*");

  return lines.join("\n");
}

// ─── 인사이트 저장 ────────────────────────────────────────

/**
 * user_insights 테이블에 저장 (UPSERT: 같은 날짜에 대해 중복 실행 시 업데이트)
 */
async function saveUserInsight(data: {
  date: string;
  dailySummary: string;
  topics: TopicEntry[];
  patterns: Patterns;
  preferences: Preferences;
  historyCount: number;
  messageCount: number;
}): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO user_insights (date, daily_summary, topics, patterns, preferences, history_count, message_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (date) DO UPDATE SET
       daily_summary = EXCLUDED.daily_summary,
       topics = EXCLUDED.topics,
       patterns = EXCLUDED.patterns,
       preferences = EXCLUDED.preferences,
       history_count = EXCLUDED.history_count,
       message_count = EXCLUDED.message_count
     RETURNING id`,
    [
      data.date,
      data.dailySummary,
      JSON.stringify(data.topics),
      JSON.stringify(data.patterns),
      JSON.stringify(data.preferences),
      data.historyCount,
      data.messageCount,
    ]
  );

  if (!row) {
    throw new Error("Failed to save user insight");
  }

  return row.id;
}

// ─── 메인 핸들러 ──────────────────────────────────────────

/**
 * daily-assistant 핸들러
 *
 * handler_config 옵션:
 * - targetDate?: string (YYYY-MM-DD) — 분석 대상 날짜 (기본: 어제)
 * - recentDays?: number — 이전 인사이트 참조 일수 (기본: 7)
 * - sendBriefing?: boolean — 브리핑 메시지 전송 여부 (기본: true)
 */
async function dailyAssistantHandler(
  ctx: CronHandlerContext
): Promise<CronHandlerResult> {
  const config = ctx.config;

  // 대상 날짜 결정 (기본: 어제)
  let targetDate: string;
  if (config.targetDate && typeof config.targetDate === "string") {
    targetDate = config.targetDate;
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    targetDate = yesterday.toISOString().split("T")[0];
  }

  const recentDays =
    typeof config.recentDays === "number" ? config.recentDays : 7;
  const sendBriefing = config.sendBriefing !== false;

  console.log(
    `[daily-assistant] Analyzing data for ${targetDate} (recent ${recentDays} days)`
  );

  // 1. 당일 데이터 수집
  const [history, messages, recentInsights] = await Promise.all([
    getTodayHistory(targetDate),
    getTodayMessages(targetDate),
    getRecentInsights(recentDays),
  ]);

  console.log(
    `[daily-assistant] Collected: ${history.length} history, ${messages.length} messages, ${recentInsights.length} recent insights`
  );

  // 2. 데이터가 없으면 최소한의 기록만 남기고 종료
  if (history.length === 0 && messages.length === 0) {
    const emptyInsightId = await saveUserInsight({
      date: targetDate,
      dailySummary: "활동 데이터가 없습니다.",
      topics: [],
      patterns: {
        peakHours: [],
        mostActiveAgent: null,
        taskSuccessRate: 0,
        avgMessagesPerAgent: 0,
        mostUsedTaskType: null,
      },
      preferences: {
        preferredAgents: [],
        commonTaskTypes: [],
        activeTimeRange: null,
      },
      historyCount: 0,
      messageCount: 0,
    });

    return {
      message: `No activity data for ${targetDate}. Empty insight saved.`,
      data: { insightId: emptyInsightId, targetDate, historyCount: 0, messageCount: 0 },
    };
  }

  // 3. 분석 수행
  const topics = extractTopics(history, messages);
  const patterns = analyzePatterns(history, messages);
  const preferences = inferPreferences(history, messages, recentInsights);
  const dailySummary = generateDailySummary(
    history,
    messages,
    topics,
    patterns
  );

  // 4. 인사이트 저장
  const insightId = await saveUserInsight({
    date: targetDate,
    dailySummary,
    topics,
    patterns,
    preferences,
    historyCount: history.length,
    messageCount: messages.length,
  });

  console.log(`[daily-assistant] Insight saved: ${insightId}`);

  // 5. 브리핑 메시지 생성 및 전송
  let briefingMessageId: string | undefined;
  if (sendBriefing) {
    const briefingContent = generateBriefingMessage(
      dailySummary,
      topics,
      patterns,
      preferences,
      recentInsights
    );

    const briefingMsg = await sendMessage({
      from: "system",
      to: "user",
      content: briefingContent,
      type: "text",
    });

    briefingMessageId = briefingMsg.id;
    console.log(`[daily-assistant] Briefing message sent: ${briefingMessageId}`);
  }

  return {
    message: `Daily insight generated for ${targetDate}: ${history.length} history, ${messages.length} messages analyzed`,
    data: {
      insightId,
      targetDate,
      historyCount: history.length,
      messageCount: messages.length,
      topicsCount: topics.length,
      taskSuccessRate: patterns.taskSuccessRate,
      briefingMessageId,
    },
  };
}

// ─── 핸들러 등록 ──────────────────────────────────────────

registerCronHandler("daily-assistant", dailyAssistantHandler);

export {
  dailyAssistantHandler,
  getTodayHistory,
  getTodayMessages,
  getRecentInsights,
  saveUserInsight,
  extractTopics,
  analyzePatterns,
  inferPreferences,
  generateDailySummary,
  generateBriefingMessage,
};

export type { TopicEntry, Patterns, Preferences, UserInsightRow };
