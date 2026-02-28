/**
 * 대화 세션 메트릭 API 엔드포인트
 *
 * GET /api/metrics/conversations - 최신 메트릭 조회
 * GET /api/metrics/conversations?format=prometheus - Prometheus 형식
 * GET /api/metrics/conversations/history?hours=24 - 히스토리 조회
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  collectConversationMetrics,
  getLatestMetrics,
  getMetricsHistory,
} from '@/lib/conversation-metrics';

/**
 * Prometheus 메트릭 형식으로 변환
 */
function toPrometheusFormat(metrics: Awaited<ReturnType<typeof collectConversationMetrics>>): string {
  const lines: string[] = [];

  // 세션 메트릭
  lines.push('# HELP conversations_total Total number of conversations');
  lines.push('# TYPE conversations_total gauge');
  lines.push(`conversations_total ${metrics.sessions.total}`);
  lines.push('');

  lines.push('# HELP conversations_active Active conversations');
  lines.push('# TYPE conversations_active gauge');
  lines.push(`conversations_active ${metrics.sessions.active}`);
  lines.push('');

  lines.push('# HELP conversations_archived Archived conversations');
  lines.push('# TYPE conversations_archived gauge');
  lines.push(`conversations_archived ${metrics.sessions.archived}`);
  lines.push('');

  lines.push('# HELP conversations_completed Completed conversations');
  lines.push('# TYPE conversations_completed gauge');
  lines.push(`conversations_completed ${metrics.sessions.completed}`);
  lines.push('');

  lines.push('# HELP conversation_completion_rate Conversation completion rate');
  lines.push('# TYPE conversation_completion_rate gauge');
  lines.push(`conversation_completion_rate ${metrics.sessions.completionRate}`);
  lines.push('');

  lines.push('# HELP conversation_avg_duration_hours Average conversation duration');
  lines.push('# TYPE conversation_avg_duration_hours gauge');
  lines.push(`conversation_avg_duration_hours ${metrics.sessions.avgDurationHours}`);
  lines.push('');

  // 메시지 메트릭
  lines.push('# HELP conversation_messages_total Total messages');
  lines.push('# TYPE conversation_messages_total gauge');
  lines.push(`conversation_messages_total ${metrics.messages.total}`);
  lines.push('');

  lines.push('# HELP conversation_messages_per_session Messages per session');
  lines.push('# TYPE conversation_messages_per_session gauge');
  lines.push(`conversation_messages_per_session ${metrics.messages.perSession}`);
  lines.push('');

  lines.push('# HELP conversation_unread_messages Unread messages count');
  lines.push('# TYPE conversation_unread_messages gauge');
  lines.push(`conversation_unread_messages ${metrics.messages.unreadCount}`);
  lines.push('');

  lines.push('# HELP conversation_unread_rate Unread message rate');
  lines.push('# TYPE conversation_unread_rate gauge');
  lines.push(`conversation_unread_rate ${metrics.messages.unreadRate}`);
  lines.push('');

  lines.push('# HELP conversation_insertion_rate_per_hour Message insertion rate per hour');
  lines.push('# TYPE conversation_insertion_rate_per_hour gauge');
  lines.push(`conversation_insertion_rate_per_hour ${metrics.messages.insertionRatePerHour}`);
  lines.push('');

  lines.push('# HELP conversation_avg_message_length Average message length');
  lines.push('# TYPE conversation_avg_message_length gauge');
  lines.push(`conversation_avg_message_length ${metrics.messages.avgLength}`);
  lines.push('');

  // 성능 메트릭
  lines.push('# HELP conversation_table_size_mb Conversation table size in MB');
  lines.push('# TYPE conversation_table_size_mb gauge');
  lines.push(`conversation_table_size_mb ${metrics.performance.tableSizeMb}`);
  lines.push('');

  lines.push('# HELP conversation_index_size_mb Index size in MB');
  lines.push('# TYPE conversation_index_size_mb gauge');
  lines.push(`conversation_index_size_mb ${metrics.performance.indexSizeMb}`);
  lines.push('');

  lines.push('# HELP conversation_dead_tuples Dead tuples count');
  lines.push('# TYPE conversation_dead_tuples gauge');
  lines.push(`conversation_dead_tuples ${metrics.performance.deadTuplesCount}`);
  lines.push('');

  // 건강 상태
  lines.push('# HELP conversation_health_status Health status (1=healthy, 0=unhealthy)');
  lines.push('# TYPE conversation_health_status gauge');
  lines.push(`conversation_health_status ${metrics.health.isHealthy ? 1 : 0}`);
  lines.push('');

  lines.push('# HELP conversation_warnings_count Warning count');
  lines.push('# TYPE conversation_warnings_count gauge');
  lines.push(`conversation_warnings_count ${metrics.health.warnings.length}`);
  lines.push('');

  lines.push('# HELP conversation_critical_issues_count Critical issues count');
  lines.push('# TYPE conversation_critical_issues_count gauge');
  lines.push(`conversation_critical_issues_count ${metrics.health.criticalIssues.length}`);

  return lines.join('\n');
}

/**
 * GET /api/metrics/conversations
 * 최신 메트릭 조회
 */
export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get('format');

    if (format === 'prometheus') {
      const metrics = await collectConversationMetrics();
      const prometheusText = toPrometheusFormat(metrics);

      return new NextResponse(prometheusText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      });
    }

    // JSON 형식 (기본)
    const metrics = await getLatestMetrics();

    if (!metrics) {
      // 메트릭이 없으면 현재 수집
      const currentMetrics = await collectConversationMetrics();
      return NextResponse.json(currentMetrics);
    }

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Failed to get conversation metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to retrieve metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/metrics/conversations/collect
 * 메트릭 수동 수집 (관리자용)
 */
export async function POST(request: NextRequest) {
  try {
    // 간단한 인증 (실제로는 더 강력한 인증 필요)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const metrics = await collectConversationMetrics();
    return NextResponse.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to collect metrics:', error);
    return NextResponse.json(
      {
        error: 'Failed to collect metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
