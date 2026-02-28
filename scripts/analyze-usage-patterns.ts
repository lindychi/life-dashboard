#!/usr/bin/env node
/**
 * Life Dashboard Usage Pattern Analysis
 *
 * 현재 시스템 사용 패턴 및 병목 지점 분석:
 * 1. 에이전트별 태스크 실행 빈도/성공률/실패 원인
 * 2. 메시징 시스템 활용도 (에이전트 간 협업 빈도)
 * 3. 사용자 개입 필요 지점 식별
 * 4. 게이트웨이 재시작 빈도 및 원인
 * 5. 자동화 시 ROI가 높은 작업 우선순위
 */

import { query } from "../src/lib/db";

interface AnalysisResult {
  section: string;
  title: string;
  data: unknown;
  insights: string[];
  recommendations: string[];
}

const results: AnalysisResult[] = [];

// ─── 1. 에이전트별 태스크 실행 분석 ────────────────────────

async function analyzeAgentTaskPerformance(): Promise<void> {
  console.log("\n=== 1. Agent Task Performance Analysis ===\n");

  // 1.1 에이전트별 태스크 실행 통계
  const agentStats = await query<{
    assigned_agent: string;
    total_tasks: string;
    completed: string;
    failed: string;
    dead_letter: string;
    avg_duration_seconds: string;
    success_rate: string;
  }>(`
    SELECT
      COALESCE(assigned_agent, 'unassigned') as assigned_agent,
      COUNT(*) as total_tasks,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'dead_letter') as dead_letter,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 2) as avg_duration_seconds,
      ROUND((COUNT(*) FILTER (WHERE status = 'completed')::float / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'dead_letter')), 0) * 100)::numeric, 2) as success_rate
    FROM task_queue
    WHERE status IN ('completed', 'failed', 'dead_letter')
    GROUP BY assigned_agent
    ORDER BY total_tasks DESC
  `);

  console.log("Agent Task Stats:");
  console.table(agentStats);

  // 1.2 실패 원인 분석 (retry_errors에서 추출)
  const failureReasons = await query<{
    error_pattern: string;
    count: string;
    affected_agents: string;
  }>(`
    WITH error_entries AS (
      SELECT
        assigned_agent,
        jsonb_array_elements(retry_errors) as error_entry
      FROM task_queue
      WHERE status IN ('failed', 'dead_letter')
        AND jsonb_array_length(retry_errors) > 0
    )
    SELECT
      SUBSTRING((error_entry->>'error')::text, 1, 100) as error_pattern,
      COUNT(*) as count,
      COUNT(DISTINCT assigned_agent) as affected_agents
    FROM error_entries
    GROUP BY SUBSTRING((error_entry->>'error')::text, 1, 100)
    ORDER BY count DESC
    LIMIT 10
  `);

  console.log("\nTop Failure Reasons:");
  console.table(failureReasons);

  // 1.3 태스크 타입별 성공률
  const taskTypeStats = await query<{
    type: string;
    total: string;
    completed: string;
    failed: string;
    success_rate: string;
  }>(`
    SELECT
      type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter')) as failed,
      ROUND((COUNT(*) FILTER (WHERE status = 'completed')::float / NULLIF(COUNT(*), 0) * 100)::numeric, 2) as success_rate
    FROM task_queue
    WHERE status IN ('completed', 'failed', 'dead_letter')
    GROUP BY type
    ORDER BY total DESC
  `);

  console.log("\nTask Type Success Rates:");
  console.table(taskTypeStats);

  const insights: string[] = [];
  const recommendations: string[] = [];

  // 인사이트 생성
  if (agentStats.length === 0) {
    insights.push("⚠️ No completed tasks found - system may be newly deployed or not actively used");
    recommendations.push("Monitor task execution after initial deployment");
  } else {
    const totalTasks = agentStats.reduce((sum, row) => sum + parseInt(row.total_tasks), 0);
    const avgSuccessRate = agentStats.reduce((sum, row) => sum + parseFloat(row.success_rate || "0"), 0) / agentStats.length;

    insights.push(`📊 Total tasks executed: ${totalTasks}`);
    insights.push(`✅ Average success rate: ${avgSuccessRate.toFixed(2)}%`);

    if (avgSuccessRate < 80) {
      insights.push("⚠️ Success rate below 80% - investigate failure patterns");
      recommendations.push("Implement retry logic improvements for common failure patterns");
    }

    const slowAgents = agentStats.filter(row => parseFloat(row.avg_duration_seconds || "0") > 300);
    if (slowAgents.length > 0) {
      insights.push(`🐌 ${slowAgents.length} agents with avg duration > 5 minutes`);
      recommendations.push("Consider timeout adjustments or task decomposition for slow agents");
    }

    if (failureReasons.length > 0) {
      const topError = failureReasons[0];
      insights.push(`🔥 Most common error: "${topError.error_pattern}" (${topError.count} occurrences)`);
      recommendations.push(`High-priority fix: Address "${topError.error_pattern.substring(0, 50)}..."`);
    }
  }

  results.push({
    section: "1. Agent Task Performance",
    title: "에이전트별 태스크 실행 빈도/성공률/실패 원인",
    data: { agentStats, failureReasons, taskTypeStats },
    insights,
    recommendations,
  });
}

// ─── 2. 메시징 시스템 활용도 분석 ───────────────────────────

async function analyzeMessagingPatterns(): Promise<void> {
  console.log("\n=== 2. Messaging System Usage Analysis ===\n");

  // 2.1 에이전트 간 메시지 흐름
  const messagingStats = await query<{
    from_id: string;
    to_id: string;
    message_count: string;
    unread_rate: string;
    last_message: string;
  }>(`
    SELECT
      from_id,
      to_id,
      COUNT(*) as message_count,
      ROUND((COUNT(*) FILTER (WHERE NOT read)::float / NULLIF(COUNT(*), 0) * 100)::numeric, 2) as unread_rate,
      MAX(created_at) as last_message
    FROM messages
    GROUP BY from_id, to_id
    ORDER BY message_count DESC
    LIMIT 20
  `);

  console.log("Agent Message Flow (Top 20):");
  console.table(messagingStats);

  // 2.2 전체 메시징 활동 통계
  const totalMessagingStats = await query<{
    total_messages: string;
    unique_senders: string;
    unique_receivers: string;
    unread_messages: string;
    avg_messages_per_day: string;
  }>(`
    SELECT
      COUNT(*) as total_messages,
      COUNT(DISTINCT from_id) as unique_senders,
      COUNT(DISTINCT to_id) as unique_receivers,
      COUNT(*) FILTER (WHERE NOT read) as unread_messages,
      ROUND((COUNT(*) / NULLIF(EXTRACT(DAY FROM (NOW() - MIN(created_at))), 0))::numeric, 2) as avg_messages_per_day
    FROM messages
  `);

  console.log("\nOverall Messaging Stats:");
  console.table(totalMessagingStats);

  // 2.3 에이전트별 협업 빈도 (sent + received)
  const agentCollaboration = await query<{
    agent_id: string;
    sent_messages: string;
    received_messages: string;
    total_interactions: string;
    collaboration_partners: string;
  }>(`
    WITH sent AS (
      SELECT from_id as agent_id, COUNT(*) as cnt
      FROM messages
      GROUP BY from_id
    ),
    received AS (
      SELECT to_id as agent_id, COUNT(*) as cnt
      FROM messages
      GROUP BY to_id
    ),
    partners AS (
      SELECT
        from_id as agent_id,
        COUNT(DISTINCT to_id) as partner_count
      FROM messages
      GROUP BY from_id
    )
    SELECT
      COALESCE(sent.agent_id, received.agent_id) as agent_id,
      COALESCE(sent.cnt, 0) as sent_messages,
      COALESCE(received.cnt, 0) as received_messages,
      COALESCE(sent.cnt, 0) + COALESCE(received.cnt, 0) as total_interactions,
      COALESCE(partners.partner_count, 0) as collaboration_partners
    FROM sent
    FULL OUTER JOIN received ON sent.agent_id = received.agent_id
    LEFT JOIN partners ON COALESCE(sent.agent_id, received.agent_id) = partners.agent_id
    ORDER BY total_interactions DESC
  `);

  console.log("\nAgent Collaboration Metrics:");
  console.table(agentCollaboration);

  const insights: string[] = [];
  const recommendations: string[] = [];

  if (totalMessagingStats.length > 0) {
    const stats = totalMessagingStats[0];
    const totalMessages = parseInt(stats.total_messages);
    const unreadRate = totalMessages > 0
      ? (parseInt(stats.unread_messages) / totalMessages * 100).toFixed(2)
      : "0";

    insights.push(`📬 Total messages: ${totalMessages}`);
    insights.push(`👥 Active agents: ${stats.unique_senders} senders, ${stats.unique_receivers} receivers`);
    insights.push(`📊 Unread rate: ${unreadRate}%`);
    insights.push(`📈 Daily avg: ${stats.avg_messages_per_day} messages/day`);

    if (totalMessages === 0) {
      insights.push("⚠️ No inter-agent messaging detected - agents operating in isolation");
      recommendations.push("Consider implementing collaborative workflows to leverage multi-agent capabilities");
    } else if (parseFloat(unreadRate) > 20) {
      insights.push("⚠️ High unread rate - messages may not be processed effectively");
      recommendations.push("Implement message queue monitoring and alerting for unread messages");
    }

    if (agentCollaboration.length > 0) {
      const topCollaborator = agentCollaboration[0];
      insights.push(`🤝 Most active collaborator: ${topCollaborator.agent_id} (${topCollaborator.total_interactions} interactions)`);

      const isolatedAgents = agentCollaboration.filter(row => parseInt(row.collaboration_partners) === 0);
      if (isolatedAgents.length > 0) {
        insights.push(`🔕 ${isolatedAgents.length} agents with no collaboration partners`);
        recommendations.push("Review isolated agents - they may benefit from workflow integration");
      }
    }
  } else {
    insights.push("⚠️ No messaging data found");
    recommendations.push("Enable messaging system to improve agent coordination");
  }

  results.push({
    section: "2. Messaging System",
    title: "메시징 시스템 활용도 및 에이전트 간 협업 빈도",
    data: { messagingStats, totalMessagingStats, agentCollaboration },
    insights,
    recommendations,
  });
}

// ─── 3. 사용자 개입 필요 지점 식별 ──────────────────────────

async function analyzeUserInterventionPoints(): Promise<void> {
  console.log("\n=== 3. User Intervention Points ===\n");

  // 3.1 실패 후 수동 재시도가 필요한 dead_letter 태스크
  const deadLetterTasks = await query<{
    id: string;
    title: string;
    assigned_agent: string;
    retry_count: string;
    error: string;
    created_at: string;
  }>(`
    SELECT
      id,
      title,
      assigned_agent,
      retry_count,
      error,
      created_at
    FROM task_queue
    WHERE status = 'dead_letter'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  console.log("Dead Letter Tasks (Require Manual Intervention):");
  console.table(deadLetterTasks);

  // 3.2 타임아웃 발생 빈도 (timeout으로 실패한 태스크)
  const timeoutStats = await query<{
    timeout_seconds: string;
    timeout_count: string;
    avg_retries: string;
  }>(`
    SELECT
      timeout_seconds,
      COUNT(*) as timeout_count,
      ROUND(AVG(retry_count)::numeric, 2) as avg_retries
    FROM task_queue
    WHERE status IN ('failed', 'dead_letter')
      AND error LIKE '%timeout%'
    GROUP BY timeout_seconds
    ORDER BY timeout_count DESC
  `);

  console.log("\nTimeout Patterns:");
  console.table(timeoutStats);

  // 3.3 의존성 체인 실패 (cascaded failure)
  const dependencyFailures = await query<{
    failed_task_id: string;
    dependent_count: string;
    error_pattern: string;
  }>(`
    WITH failed_deps AS (
      SELECT
        unnest(depends_on) as failed_task_id,
        id as dependent_task_id,
        error
      FROM task_queue
      WHERE status IN ('failed', 'dead_letter')
        AND array_length(depends_on, 1) > 0
    )
    SELECT
      failed_task_id,
      COUNT(DISTINCT dependent_task_id) as dependent_count,
      STRING_AGG(DISTINCT SUBSTRING(error, 1, 50), ' | ') as error_pattern
    FROM failed_deps
    GROUP BY failed_task_id
    ORDER BY dependent_count DESC
    LIMIT 10
  `);

  console.log("\nDependency Chain Failures:");
  console.table(dependencyFailures);

  // 3.4 pending 상태에서 오래 대기 중인 태스크 (24시간 이상)
  const staleTasks = await query<{
    id: string;
    title: string;
    priority: string;
    hours_pending: string;
    depends_on_count: string;
  }>(`
    SELECT
      id,
      title,
      priority,
      ROUND(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600) as hours_pending,
      array_length(depends_on, 1) as depends_on_count
    FROM task_queue
    WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '24 hours'
    ORDER BY created_at
    LIMIT 10
  `);

  console.log("\nStale Pending Tasks (>24h):");
  console.table(staleTasks);

  const insights: string[] = [];
  const recommendations: string[] = [];

  insights.push(`🔴 Dead letter tasks requiring intervention: ${deadLetterTasks.length}`);
  insights.push(`⏱️ Timeout patterns detected: ${timeoutStats.length} different timeout configurations`);
  insights.push(`🔗 Dependency failures: ${dependencyFailures.length} tasks caused cascade failures`);
  insights.push(`⏳ Stale tasks (>24h pending): ${staleTasks.length}`);

  if (deadLetterTasks.length > 0) {
    recommendations.push("HIGH PRIORITY: Review and manually retry dead letter tasks");
    recommendations.push("Consider implementing automatic retry with exponential backoff");
  }

  if (timeoutStats.length > 0 && timeoutStats[0]) {
    const mostCommonTimeout = timeoutStats[0];
    if (parseInt(mostCommonTimeout.timeout_count) > 10) {
      recommendations.push(`Adjust timeout_seconds for tasks with ${mostCommonTimeout.timeout_seconds}s timeout`);
    }
  }

  if (dependencyFailures.length > 0) {
    recommendations.push("Implement dependency health checks before task execution");
    recommendations.push("Add dependency failure notifications to user dashboard");
  }

  if (staleTasks.length > 0) {
    recommendations.push("Investigate why tasks remain pending for >24 hours");
    recommendations.push("Check for deadlock conditions in dependency resolution");
  }

  results.push({
    section: "3. User Intervention Points",
    title: "사용자 개입이 필요한 지점 식별",
    data: { deadLetterTasks, timeoutStats, dependencyFailures, staleTasks },
    insights,
    recommendations,
  });
}

// ─── 4. 게이트웨이 안정성 분석 ──────────────────────────────

async function analyzeGatewayStability(): Promise<void> {
  console.log("\n=== 4. Gateway Stability Analysis ===\n");

  // 4.1 게이트웨이 연결 이력 (재시작 빈도)
  const gatewayConnections = await query<{
    id: string;
    status: string;
    connected_at: string;
    last_heartbeat: string;
    uptime_hours: string;
  }>(`
    SELECT
      id,
      status,
      connected_at,
      last_heartbeat,
      ROUND(EXTRACT(EPOCH FROM (COALESCE(last_heartbeat, NOW()) - connected_at)) / 3600, 2) as uptime_hours
    FROM gateway_connections
    ORDER BY connected_at DESC
  `);

  console.log("Gateway Connection History:");
  console.table(gatewayConnections);

  // 4.2 릴레이 커맨드 실행 통계
  const relayCommandStats = await query<{
    type: string;
    total_commands: string;
    pending: string;
    completed: string;
    avg_completion_seconds: string;
  }>(`
    SELECT
      type,
      COUNT(*) as total_commands,
      COUNT(*) FILTER (WHERE status = 'pending') as pending,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))::numeric, 2) as avg_completion_seconds
    FROM relay_commands
    GROUP BY type
    ORDER BY total_commands DESC
  `);

  console.log("\nRelay Command Stats:");
  console.table(relayCommandStats);

  // 4.3 에이전트 상태 분포
  const agentStatusDistribution = await query<{
    status: string;
    count: string;
    gateway_id: string;
  }>(`
    SELECT
      status,
      COUNT(*) as count,
      gateway_id
    FROM agent_statuses
    GROUP BY status, gateway_id
    ORDER BY gateway_id, count DESC
  `);

  console.log("\nAgent Status Distribution:");
  console.table(agentStatusDistribution);

  // 4.4 게이트웨이별 heartbeat 건강도 (마지막 heartbeat 시간)
  const heartbeatHealth = await query<{
    id: string;
    last_heartbeat: string;
    minutes_since_heartbeat: string;
    health_status: string;
  }>(`
    SELECT
      id,
      last_heartbeat,
      ROUND(EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) / 60) as minutes_since_heartbeat,
      CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) < 60 THEN '✅ Healthy'
        WHEN EXTRACT(EPOCH FROM (NOW() - last_heartbeat)) < 300 THEN '⚠️ Warning'
        ELSE '🔴 Critical'
      END as health_status
    FROM gateway_connections
    WHERE status = 'connected'
    ORDER BY last_heartbeat DESC
  `);

  console.log("\nGateway Heartbeat Health:");
  console.table(heartbeatHealth);

  const insights: string[] = [];
  const recommendations: string[] = [];

  if (gatewayConnections.length === 0) {
    insights.push("⚠️ No gateway connections found - system unable to execute tasks");
    recommendations.push("CRITICAL: Deploy and register at least one gateway connector");
  } else {
    insights.push(`🌐 Total gateway connections: ${gatewayConnections.length}`);

    const avgUptime = gatewayConnections.reduce((sum, row) => sum + parseFloat(row.uptime_hours || "0"), 0) / gatewayConnections.length;
    insights.push(`⏱️ Average uptime: ${avgUptime.toFixed(2)} hours`);

    if (avgUptime < 24) {
      insights.push("⚠️ Gateway uptime < 24 hours - frequent restarts detected");
      recommendations.push("Investigate gateway crash logs and stability issues");
      recommendations.push("Consider implementing gateway health monitoring and auto-recovery");
    }

    const unhealthyGateways = heartbeatHealth.filter(row => row.health_status !== "✅ Healthy");
    if (unhealthyGateways.length > 0) {
      insights.push(`🔴 ${unhealthyGateways.length} gateways with unhealthy heartbeat`);
      recommendations.push("Check network connectivity and process health for unhealthy gateways");
    }
  }

  if (relayCommandStats.length > 0) {
    const totalCommands = relayCommandStats.reduce((sum, row) => sum + parseInt(row.total_commands), 0);
    insights.push(`📡 Total relay commands: ${totalCommands}`);

    const pendingCommands = relayCommandStats.reduce((sum, row) => sum + parseInt(row.pending || "0"), 0);
    if (pendingCommands > 0) {
      insights.push(`⏳ Pending commands: ${pendingCommands}`);
      recommendations.push("Monitor pending commands - may indicate gateway processing bottleneck");
    }
  }

  results.push({
    section: "4. Gateway Stability",
    title: "게이트웨이 재시작 빈도 및 안정성 분석",
    data: { gatewayConnections, relayCommandStats, agentStatusDistribution, heartbeatHealth },
    insights,
    recommendations,
  });
}

// ─── 5. 자동화 ROI 우선순위 도출 ───────────────────────────

async function calculateAutomationROI(): Promise<void> {
  console.log("\n=== 5. Automation ROI Analysis ===\n");

  // 5.1 반복적으로 실패하는 태스크 타입 (자동 복구 대상)
  const repetitiveFailures = await query<{
    type: string;
    failure_count: string;
    avg_retries: string;
    distinct_errors: string;
    potential_time_saved_hours: string;
  }>(`
    SELECT
      type,
      COUNT(*) as failure_count,
      ROUND(AVG(retry_count)::numeric, 2) as avg_retries,
      COUNT(DISTINCT error) as distinct_errors,
      ROUND((COUNT(*) * AVG(retry_count) * 0.5)::numeric, 2) as potential_time_saved_hours
    FROM task_queue
    WHERE status IN ('failed', 'dead_letter')
    GROUP BY type
    HAVING COUNT(*) >= 3
    ORDER BY potential_time_saved_hours DESC
  `);

  console.log("High ROI: Repetitive Failures (Auto-recovery Candidates):");
  console.table(repetitiveFailures);

  // 5.2 수동으로 자주 재시도되는 dead_letter 태스크 패턴
  const manualRetryPatterns = await query<{
    type: string;
    retry_pattern_count: string;
    avg_manual_retries: string;
    estimated_manual_hours: string;
  }>(`
    WITH retry_events AS (
      SELECT
        type,
        jsonb_array_length(retry_errors) as retry_event_count,
        (
          SELECT COUNT(*)
          FROM jsonb_array_elements(retry_errors) as err
          WHERE err->>'action' = 'manual_retry'
        ) as manual_retry_count
      FROM task_queue
      WHERE status = 'completed'
        AND jsonb_array_length(retry_errors) > 0
    )
    SELECT
      type,
      COUNT(*) as retry_pattern_count,
      ROUND(AVG(manual_retry_count)::numeric, 2) as avg_manual_retries,
      ROUND((COUNT(*) * AVG(manual_retry_count) * 0.25)::numeric, 2) as estimated_manual_hours
    FROM retry_events
    WHERE manual_retry_count > 0
    GROUP BY type
    ORDER BY estimated_manual_hours DESC
  `);

  console.log("\nHigh ROI: Manual Retry Patterns (Auto-resolution Candidates):");
  console.table(manualRetryPatterns);

  // 5.3 병렬화 가능한 태스크 그룹 (순차 실행 중이지만 의존성 없음)
  const parallelizationOpportunities = await query<{
    concurrency_group: string;
    avg_task_duration_seconds: string;
    tasks_per_day: string;
    potential_speedup_factor: string;
    estimated_time_saved_hours_per_day: string;
  }>(`
    SELECT
      concurrency_group,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 2) as avg_task_duration_seconds,
      ROUND((COUNT(*) / NULLIF(EXTRACT(DAY FROM (NOW() - MIN(created_at))), 0))::numeric, 2) as tasks_per_day,
      ROUND((cc.max_concurrent::float / 3)::numeric, 2) as potential_speedup_factor,
      ROUND(((AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) * COUNT(*) / NULLIF(EXTRACT(DAY FROM (NOW() - MIN(created_at))), 0)) * (1 - (3.0 / cc.max_concurrent)) / 3600)::numeric, 2) as estimated_time_saved_hours_per_day
    FROM task_queue
    JOIN concurrency_config cc ON task_queue.concurrency_group = cc.concurrency_group
    WHERE status = 'completed'
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND cc.max_concurrent = 3
    GROUP BY concurrency_group, cc.max_concurrent
    HAVING COUNT(*) >= 10
    ORDER BY estimated_time_saved_hours_per_day DESC
  `);

  console.log("\nHigh ROI: Parallelization Opportunities (Increase Concurrency):");
  console.table(parallelizationOpportunities);

  // 5.4 메시지 자동 처리 기회 (높은 unread rate + 반복 패턴)
  const messageAutomationOpportunities = await query<{
    from_to_pair: string;
    total_messages: string;
    unread_count: string;
    unread_rate: string;
    potential_automation_score: string;
  }>(`
    SELECT
      from_id || ' → ' || to_id as from_to_pair,
      COUNT(*) as total_messages,
      COUNT(*) FILTER (WHERE NOT read) as unread_count,
      ROUND((COUNT(*) FILTER (WHERE NOT read)::float / NULLIF(COUNT(*), 0) * 100)::numeric, 2) as unread_rate,
      ROUND((COUNT(*) * (COUNT(*) FILTER (WHERE NOT read)::float / NULLIF(COUNT(*), 0)))::numeric, 2) as potential_automation_score
    FROM messages
    GROUP BY from_id, to_id
    HAVING COUNT(*) >= 5 AND COUNT(*) FILTER (WHERE NOT read) > 0
    ORDER BY potential_automation_score DESC
    LIMIT 10
  `);

  console.log("\nHigh ROI: Message Auto-processing Opportunities:");
  console.table(messageAutomationOpportunities);

  const insights: string[] = [];
  const recommendations: string[] = [];

  // ROI 계산 및 우선순위 결정
  let totalPotentialTimeSaved = 0;

  if (repetitiveFailures.length > 0) {
    const topFailure = repetitiveFailures[0];
    totalPotentialTimeSaved += parseFloat(topFailure.potential_time_saved_hours || "0");
    insights.push(`🔁 Top repetitive failure: "${topFailure.type}" (${topFailure.failure_count} failures)`);
    recommendations.push(`#1 HIGHEST ROI: Implement auto-recovery for "${topFailure.type}" tasks (Est. ${topFailure.potential_time_saved_hours}h saved)`);
  }

  if (manualRetryPatterns.length > 0) {
    const topManual = manualRetryPatterns[0];
    totalPotentialTimeSaved += parseFloat(topManual.estimated_manual_hours || "0");
    insights.push(`👤 Top manual intervention: "${topManual.type}" (${topManual.avg_manual_retries} avg manual retries)`);
    recommendations.push(`#2 HIGH ROI: Auto-resolve "${topManual.type}" failures (Est. ${topManual.estimated_manual_hours}h saved)`);
  }

  if (parallelizationOpportunities.length > 0) {
    const topParallel = parallelizationOpportunities[0];
    const dailySavings = parseFloat(topParallel.estimated_time_saved_hours_per_day || "0");
    totalPotentialTimeSaved += dailySavings * 30; // Monthly projection
    insights.push(`⚡ Top parallelization opportunity: "${topParallel.concurrency_group}" (${topParallel.tasks_per_day} tasks/day)`);
    recommendations.push(`#3 MEDIUM ROI: Increase concurrency for "${topParallel.concurrency_group}" (Est. ${topParallel.estimated_time_saved_hours_per_day}h/day saved)`);
  }

  if (messageAutomationOpportunities.length > 0) {
    const topMessage = messageAutomationOpportunities[0];
    insights.push(`📬 Top message automation opportunity: ${topMessage.from_to_pair} (${topMessage.unread_rate}% unread)`);
    recommendations.push(`#4 MEDIUM ROI: Implement auto-processing for ${topMessage.from_to_pair} message flow`);
  }

  insights.push(`💰 Total estimated time savings: ${totalPotentialTimeSaved.toFixed(2)} hours/month`);

  results.push({
    section: "5. Automation ROI",
    title: "자동화 시 ROI가 높은 작업 우선순위",
    data: {
      repetitiveFailures,
      manualRetryPatterns,
      parallelizationOpportunities,
      messageAutomationOpportunities
    },
    insights,
    recommendations,
  });
}

// ─── 메인 실행 ─────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Life Dashboard - Usage Pattern & Bottleneck Analysis     ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  try {
    await analyzeAgentTaskPerformance();
    await analyzeMessagingPatterns();
    await analyzeUserInterventionPoints();
    await analyzeGatewayStability();
    await calculateAutomationROI();

    // 최종 요약 리포트 생성
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    EXECUTIVE SUMMARY                       ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    for (const result of results) {
      console.log(`\n━━━ ${result.section}: ${result.title} ━━━\n`);

      if (result.insights.length > 0) {
        console.log("📊 KEY INSIGHTS:");
        result.insights.forEach(insight => console.log(`   ${insight}`));
      }

      if (result.recommendations.length > 0) {
        console.log("\n💡 RECOMMENDATIONS:");
        result.recommendations.forEach(rec => console.log(`   ${rec}`));
      }
    }

    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║                    PRIORITIZED ACTION ITEMS                ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    const allRecommendations = results.flatMap(r => r.recommendations);
    const prioritized = allRecommendations
      .filter(rec => rec.match(/#\d+/))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/#(\d+)/)?.[1] || "999");
        const bNum = parseInt(b.match(/#(\d+)/)?.[1] || "999");
        return aNum - bNum;
      });

    prioritized.forEach(rec => console.log(`   ${rec}`));

    console.log("\n✅ Analysis complete. Review recommendations above for optimization opportunities.\n");

  } catch (error) {
    console.error("❌ Error during analysis:", error);
    process.exit(1);
  }

  process.exit(0);
}

main();
