// Agent 개선 탐색 Cron Handler
// 등록된 에이전트들의 성과를 분석하고 개선 권장사항을 생성

import { query, queryOne } from "../db";
import { sendMessage } from "../messages";
import { getAgents } from "../agents";
import {
  registerCronHandler,
  type CronHandlerContext,
} from "../cron-handlers";

// ─── 타입 정의 ────────────────────────────────────────────

interface AgentMetrics {
  taskCompleted: number;
  taskFailed: number;
  failureRate: number;
  avgExecutionMinutes: number;
  totalTasks: number;
}

interface Issue {
  type:
    | "high_failure_rate"
    | "recurring_error"
    | "slow_execution"
    | "user_complaint"
    | "timeout_pattern";
  pattern: string;
  count: number;
  severity: "low" | "medium" | "high" | "critical";
  examples: string[];
}

interface Recommendation {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  actionType: "config_change" | "code_fix" | "monitoring" | "investigation";
}

interface AgentReport {
  agentId: string;
  agentName: string;
  metrics: AgentMetrics;
  issues: Issue[];
  recommendations: Recommendation[];
}

// ─── 심각도 산출 ──────────────────────────────────────────

/** 발생 횟수 기반 심각도 계산 */
function severityFromCount(count: number): Issue["severity"] {
  if (count >= 10) return "critical";
  if (count >= 5) return "high";
  if (count >= 3) return "medium";
  return "low";
}

// ─── 분석 함수 ────────────────────────────────────────────

/**
 * 에이전트의 전체 성과 지표 산출
 * task_started → task_completed/task_failed 쌍으로 실행 시간 계산
 */
async function analyzeAgentHistory(
  agentId: string
): Promise<AgentMetrics> {
  // 기본 태스크 카운트 조회
  const counts = await queryOne<{
    completed: string;
    failed: string;
    total: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE type = 'task_completed') AS completed,
       COUNT(*) FILTER (WHERE type = 'task_failed')    AS failed,
       COUNT(*) FILTER (WHERE type IN ('task_completed', 'task_failed')) AS total
     FROM agent_history
     WHERE agent_id = $1`,
    [agentId]
  );

  const taskCompleted = parseInt(counts?.completed || "0", 10);
  const taskFailed = parseInt(counts?.failed || "0", 10);
  const totalTasks = parseInt(counts?.total || "0", 10);
  const failureRate =
    totalTasks > 0
      ? Math.round((taskFailed / totalTasks) * 10000) / 100
      : 0;

  // request_group_id 기준 평균 실행 시간 (started → completed/failed)
  const avgRow = await queryOne<{ avg_minutes: string | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (finish.created_at - start.created_at)) / 60)
            AS avg_minutes
     FROM agent_history start
     JOIN agent_history finish
       ON start.agent_id = finish.agent_id
       AND start.request_group_id = finish.request_group_id
       AND start.type = 'task_started'
       AND finish.type IN ('task_completed', 'task_failed')
     WHERE start.agent_id = $1
       AND start.request_group_id IS NOT NULL`,
    [agentId]
  );

  const avgExecutionMinutes = avgRow?.avg_minutes
    ? Math.round(parseFloat(avgRow.avg_minutes) * 100) / 100
    : 0;

  return {
    taskCompleted,
    taskFailed,
    failureRate,
    avgExecutionMinutes,
    totalTasks,
  };
}

/**
 * 에러 패턴 감지
 * task_failed 엔트리에서 반복적인 에러 패턴을 그룹화
 */
async function detectErrorPatterns(
  agentId: string
): Promise<Issue[]> {
  // task_failed 엔트리 조회
  const failures = await query<{
    content: string;
    metadata: Record<string, unknown> | null;
  }>(
    `SELECT content, metadata
     FROM agent_history
     WHERE agent_id = $1
       AND type = 'task_failed'
     ORDER BY created_at DESC`,
    [agentId]
  );

  if (failures.length === 0) return [];

  const issues: Issue[] = [];

  // 에러 메시지별 그룹화 (첫 100자를 패턴 키로 사용)
  const errorGroups = new Map<string, string[]>();
  const timeoutExamples: string[] = [];

  for (const f of failures) {
    const content = f.content || "";
    const errorKey = content.slice(0, 100).trim().toLowerCase();

    // 타임아웃 패턴 감지
    if (/timeout|timed?\s*out/i.test(content)) {
      timeoutExamples.push(content.slice(0, 200));
    }

    // 일반 에러 그룹화
    if (!errorGroups.has(errorKey)) {
      errorGroups.set(errorKey, []);
    }
    errorGroups.get(errorKey)!.push(content.slice(0, 200));
  }

  // 타임아웃 패턴 이슈
  if (timeoutExamples.length > 0) {
    issues.push({
      type: "timeout_pattern",
      pattern: "타임아웃 반복 발생",
      count: timeoutExamples.length,
      severity: severityFromCount(timeoutExamples.length),
      examples: timeoutExamples.slice(0, 5),
    });
  }

  // 반복 에러 패턴 이슈 (2건 이상 발생한 패턴만)
  for (const [pattern, examples] of errorGroups) {
    if (examples.length >= 2) {
      issues.push({
        type: "recurring_error",
        pattern: pattern || "(빈 에러 메시지)",
        count: examples.length,
        severity: severityFromCount(examples.length),
        examples: examples.slice(0, 5),
      });
    }
  }

  return issues;
}

/**
 * 사용자 피드백 패턴 감지
 * user → agent 메시지 중 부정적 키워드 포함 메시지 분석
 */
async function detectUserFeedbackPatterns(
  agentId: string
): Promise<Issue[]> {
  // 부정적 피드백 키워드 (한국어 + 영어)
  const negativeKeywords = [
    "실패",
    "오류",
    "문제",
    "느림",
    "안됨",
    "불만",
    "에러",
    "fail",
    "error",
    "slow",
    "broken",
    "bug",
    "wrong",
  ];

  // ILIKE 조건 생성 (각 키워드에 대해 OR 조건)
  const likeConditions = negativeKeywords
    .map((_, i) => `m.content ILIKE $${i + 2}`)
    .join(" OR ");
  const likeParams = negativeKeywords.map((kw) => `%${kw}%`);

  const messages = await query<{
    content: string;
    created_at: string;
  }>(
    `SELECT m.content, m.created_at
     FROM messages m
     WHERE m.from_id = 'user'
       AND m.to_id = $1
       AND (${likeConditions})
     ORDER BY m.created_at DESC`,
    [agentId, ...likeParams]
  );

  if (messages.length === 0) return [];

  // 키워드별 매칭 그룹화
  const keywordHits = new Map<string, string[]>();

  for (const msg of messages) {
    const contentLower = msg.content.toLowerCase();
    for (const kw of negativeKeywords) {
      if (contentLower.includes(kw.toLowerCase())) {
        if (!keywordHits.has(kw)) {
          keywordHits.set(kw, []);
        }
        keywordHits.get(kw)!.push(msg.content.slice(0, 200));
      }
    }
  }

  const issues: Issue[] = [];

  for (const [keyword, examples] of keywordHits) {
    issues.push({
      type: "user_complaint",
      pattern: `사용자 불만 키워드: "${keyword}"`,
      count: examples.length,
      severity: severityFromCount(examples.length),
      examples: examples.slice(0, 5),
    });
  }

  return issues;
}

// ─── 권장사항 생성 ────────────────────────────────────────

/**
 * 지표 및 이슈 기반 개선 권장사항 생성
 */
function generateRecommendations(
  metrics: AgentMetrics,
  issues: Issue[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // 높은 실패율 (>10%)
  if (metrics.failureRate > 10) {
    recommendations.push({
      title: "실패율 조사 필요",
      description: `실패율이 ${metrics.failureRate}%로 높습니다. 최근 실패 로그를 분석하여 근본 원인을 파악해야 합니다.`,
      priority: metrics.failureRate > 30 ? "high" : "medium",
      actionType: "investigation",
    });

    recommendations.push({
      title: "타임아웃 설정 검토",
      description:
        "실패율이 높은 경우 태스크 타임아웃 설정이 적절한지 확인하고 필요시 조정하세요.",
      priority: "medium",
      actionType: "config_change",
    });
  }

  // 이슈 유형별 권장사항
  for (const issue of issues) {
    switch (issue.type) {
      case "timeout_pattern":
        recommendations.push({
          title: "Stale 타임아웃 값 조정",
          description: `타임아웃이 ${issue.count}건 반복 발생했습니다. stale timeout 값을 늘리거나 태스크 분할을 검토하세요.`,
          priority: issue.severity === "critical" ? "high" : "medium",
          actionType: "config_change",
        });
        break;

      case "recurring_error":
        recommendations.push({
          title: `반복 에러 패턴 수정: ${issue.pattern.slice(0, 50)}`,
          description: `동일 에러가 ${issue.count}건 반복됩니다. 해당 코드 경로를 점검하고 방어 로직을 추가하세요.`,
          priority: issue.severity === "critical" || issue.severity === "high"
            ? "high"
            : "medium",
          actionType: "code_fix",
        });
        break;

      case "slow_execution":
        recommendations.push({
          title: "성능 프로파일링 필요",
          description: `실행 속도가 느린 패턴이 감지되었습니다 (${issue.count}건). 병목 구간을 프로파일링하세요.`,
          priority: "medium",
          actionType: "monitoring",
        });
        break;

      case "user_complaint":
        recommendations.push({
          title: `사용자 불만 조사: ${issue.pattern}`,
          description: `관련 피드백이 ${issue.count}건 접수되었습니다. 사용자 경험 개선을 위한 조사가 필요합니다.`,
          priority: issue.severity === "critical" || issue.severity === "high"
            ? "high"
            : "low",
          actionType: "investigation",
        });
        break;
    }
  }

  // 느린 실행 (평균 10분 초과)
  if (metrics.avgExecutionMinutes > 10) {
    recommendations.push({
      title: "평균 실행 시간 최적화",
      description: `평균 실행 시간이 ${metrics.avgExecutionMinutes}분입니다. 태스크 분할 또는 처리 파이프라인 최적화를 검토하세요.`,
      priority: metrics.avgExecutionMinutes > 30 ? "high" : "medium",
      actionType: "monitoring",
    });
  }

  return recommendations;
}

// ─── 리포트 저장 ──────────────────────────────────────────

/**
 * 리포트를 agent_improvement_reports 테이블에 UPSERT
 * 동일 agent_id + report_date 조합은 덮어쓰기
 */
async function saveReport(
  report: AgentReport,
  reportDate: Date
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_improvement_reports (agent_id, report_date, metrics, issues, recommendations, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (agent_id, report_date) DO UPDATE
     SET metrics = EXCLUDED.metrics,
         issues = EXCLUDED.issues,
         recommendations = EXCLUDED.recommendations,
         status = 'pending'
     RETURNING id`,
    [
      report.agentId,
      reportDate.toISOString().slice(0, 10),
      JSON.stringify(report.metrics),
      JSON.stringify(report.issues),
      JSON.stringify(report.recommendations),
    ]
  );

  if (!row) {
    throw new Error(
      `리포트 저장 실패: agent=${report.agentId}, date=${reportDate.toISOString()}`
    );
  }

  return row.id;
}

// ─── 알림 발송 ────────────────────────────────────────────

/**
 * 심각한 이슈 또는 높은 실패율 발견 시 사용자에게 알림 메시지 발송
 */
async function notifyIfNeeded(
  report: AgentReport,
  reportId: string
): Promise<void> {
  const hasCriticalIssues = report.issues.some(
    (i) => i.severity === "high" || i.severity === "critical"
  );
  const hasHighFailureRate = report.metrics.failureRate > 10;

  // 알림 조건: 심각한 이슈가 있거나 실패율이 10% 초과
  if (!hasCriticalIssues && !hasHighFailureRate) return;

  const issueLines = report.issues
    .map((i) => `- [${i.severity}] ${i.pattern} (${i.count}건)`)
    .join("\n");

  const recLines = report.recommendations
    .map((r) => `- [${r.priority}] ${r.title}: ${r.description}`)
    .join("\n");

  const content = [
    `**${report.agentName} 에이전트 성과 리포트**`,
    ``,
    `실패율: ${report.metrics.failureRate}%`,
    `총 태스크: ${report.metrics.totalTasks}건 (성공: ${report.metrics.taskCompleted}, 실패: ${report.metrics.taskFailed})`,
    `평균 실행 시간: ${report.metrics.avgExecutionMinutes}분`,
    ``,
    report.issues.length > 0 ? `주요 이슈:\n${issueLines}` : "",
    report.recommendations.length > 0
      ? `\n권장 조치:\n${recLines}`
      : "",
    ``,
    `이 리포트를 승인하면 자동으로 개선 작업이 등록됩니다.`,
    `리포트 ID: ${reportId}`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendMessage({
    from: "system",
    to: "user",
    content,
    type: "result",
  });
}

// ─── Cron Handler 등록 ───────────────────────────────────

registerCronHandler(
  "agent-improvement-scanner",
  async (ctx: CronHandlerContext) => {
    const agents = getAgents();
    const reports: AgentReport[] = [];
    let issuesFound = 0;

    for (const agent of agents) {
      // 1. 성과 지표 분석
      const metrics = await analyzeAgentHistory(agent.id);

      // 태스크가 전혀 없으면 리포트 생략
      if (metrics.totalTasks === 0 && metrics.taskCompleted === 0) {
        continue;
      }

      // 2. 에러 패턴 감지
      const errorIssues = await detectErrorPatterns(agent.id);

      // 3. 사용자 피드백 패턴 감지
      const feedbackIssues = await detectUserFeedbackPatterns(agent.id);

      // 4. 느린 실행 이슈 추가 (평균 10분 초과)
      const allIssues: Issue[] = [...errorIssues, ...feedbackIssues];
      if (metrics.avgExecutionMinutes > 10) {
        allIssues.push({
          type: "slow_execution",
          pattern: `평균 실행 시간 ${metrics.avgExecutionMinutes}분 (10분 초과)`,
          count: metrics.totalTasks,
          severity: metrics.avgExecutionMinutes > 30 ? "high" : "medium",
          examples: [],
        });
      }

      // 5. 높은 실패율 이슈 추가
      if (metrics.failureRate > 10) {
        allIssues.push({
          type: "high_failure_rate",
          pattern: `실패율 ${metrics.failureRate}% (기준: 10%)`,
          count: metrics.taskFailed,
          severity: metrics.failureRate > 30 ? "critical" : "high",
          examples: [],
        });
      }

      // 6. 권장사항 생성
      const recommendations = generateRecommendations(metrics, allIssues);

      const report: AgentReport = {
        agentId: agent.id,
        agentName: agent.name,
        metrics,
        issues: allIssues,
        recommendations,
      };

      // 7. 리포트 저장
      const reportId = await saveReport(report, new Date());

      // 8. 필요시 알림 발송
      await notifyIfNeeded(report, reportId);

      reports.push(report);
      issuesFound += allIssues.length;
    }

    return {
      message: `${agents.length}개 에이전트 분석 완료, ${reports.filter((r) => r.issues.length > 0).length}개 이슈 발견`,
      data: {
        agentCount: agents.length,
        reportsGenerated: reports.length,
        totalIssues: issuesFound,
      },
    };
  }
);
