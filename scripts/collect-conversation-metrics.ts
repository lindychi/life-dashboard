#!/usr/bin/env node

/**
 * 대화 세션 메트릭 수집 스케줄러
 *
 * 주기적으로 세션 사용 메트릭을 수집하고 DB에 저장
 * - 매 5분: 메트릭 수집
 * - 매일 자정: 일간 리포트 생성
 * - 매주 월요일: 주간 리포트 생성
 */

import { CronJob } from 'croner';
import {
  collectConversationMetrics,
  saveMetricsSnapshot,
  generateDailyReport,
  cleanupOldMetrics,
} from '@/lib/conversation-metrics';

const isDryRun = process.argv.includes('--dry-run');

/**
 * 메트릭 수집 작업
 */
async function collectMetricsJob() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📊 Collecting conversation metrics...`);

  try {
    const metrics = await collectConversationMetrics();

    if (isDryRun) {
      console.log('✓ [DRY RUN] Metrics collected:', {
        sessions: metrics.sessions,
        messages: metrics.messages,
        health: metrics.health,
      });
      return;
    }

    const snapshotId = await saveMetricsSnapshot(metrics);
    console.log(
      `✓ Metrics saved (ID: ${snapshotId.substring(0, 8)}...)`,
      {
        totalSessions: metrics.sessions.total,
        activeSessions: metrics.sessions.active,
        totalMessages: metrics.messages.total,
        health: metrics.health.isHealthy ? '✓ Healthy' : '⚠ Warning',
        warnings: metrics.health.warnings.length,
        criticalIssues: metrics.health.criticalIssues.length,
      }
    );

    // 경고가 있으면 로그
    if (metrics.health.warnings.length > 0) {
      console.warn('⚠ Warnings:', metrics.health.warnings);
    }

    if (metrics.health.criticalIssues.length > 0) {
      console.error('🚨 Critical Issues:', metrics.health.criticalIssues);
    }
  } catch (error) {
    console.error(
      `✗ Failed to collect metrics:`,
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

/**
 * 일간 리포트 생성 작업
 */
async function generateDailyReportJob() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 📋 Generating daily report...`);

  try {
    const report = await generateDailyReport();

    if (isDryRun) {
      console.log('✓ [DRY RUN] Daily report generated:', {
        date: report.date,
        summary: report.summary,
        totalSessions: report.metrics.sessions.total,
        totalMessages: report.metrics.messages.total,
      });
      return;
    }

    console.log('✓ Daily report generated:', {
      date: report.date,
      summary: report.summary,
      metrics: {
        sessions: report.metrics.sessions.total,
        active: report.metrics.sessions.active,
        completionRate: `${report.metrics.sessions.completionRate}%`,
        messages: report.metrics.messages.total,
        unreadRate: `${report.metrics.messages.unreadRate}%`,
      },
      changes: {
        sessionsChange: report.compareToPreviousDay.sessionsChange > 0
          ? `+${report.compareToPreviousDay.sessionsChange}`
          : report.compareToPreviousDay.sessionsChange,
        messagesChange: report.compareToPreviousDay.messagesChange > 0
          ? `+${report.compareToPreviousDay.messagesChange}`
          : report.compareToPreviousDay.messagesChange,
        completionRateChange: report.compareToPreviousDay.completionRateChange > 0
          ? `+${report.compareToPreviousDay.completionRateChange.toFixed(2)}%`
          : `${report.compareToPreviousDay.completionRateChange.toFixed(2)}%`,
      },
    });

    // 여기에 이메일/Slack 전송 로직 추가 가능
    // await notifyDailyReport(report);
  } catch (error) {
    console.error(
      `✗ Failed to generate daily report:`,
      error instanceof Error ? error.message : error
    );
    // 리포트 생성 실패는 메트릭 수집 자체를 실패시키지 않음
  }
}

/**
 * 오래된 메트릭 정리 작업 (주간)
 */
async function cleanupMetricsJob() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🧹 Cleaning up old metrics...`);

  try {
    const deletedCount = await cleanupOldMetrics(90);

    if (isDryRun) {
      console.log(`✓ [DRY RUN] Would delete ${deletedCount} old metrics`);
      return;
    }

    console.log(`✓ Deleted ${deletedCount} metrics older than 90 days`);
  } catch (error) {
    console.error(
      `✗ Failed to cleanup metrics:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * 크론 작업 등록
 */
function startScheduler() {
  console.log('🚀 Starting Conversation Metrics Scheduler');
  console.log(`   Mode: ${isDryRun ? 'DRY RUN' : 'PRODUCTION'}`);
  console.log('');

  // 매 5분마다 메트릭 수집 (UTC 기준)
  const collectJob = CronJob.pattern('*/5 * * * *', collectMetricsJob, {
    name: 'collect-metrics',
  });

  // 매일 자정(UTC)에 일간 리포트 생성
  const dailyReportJob = CronJob.pattern('0 0 * * *', generateDailyReportJob, {
    name: 'daily-report',
  });

  // 매주 일요일 자정(UTC)에 오래된 메트릭 정리
  const cleanupJob = CronJob.pattern('0 0 ? * SUN', cleanupMetricsJob, {
    name: 'cleanup-metrics',
  });

  console.log('✓ Scheduled jobs:');
  console.log('  - Collect metrics:     every 5 minutes');
  console.log('  - Generate daily report: every day at 00:00 UTC');
  console.log('  - Cleanup old metrics:   every Sunday at 00:00 UTC');
  console.log('');

  return { collectJob, dailyReportJob, cleanupJob };
}

/**
 * 수동 메트릭 수집 (테스트용)
 */
async function runOnce() {
  console.log('🔄 Running metrics collection once...\n');

  try {
    await collectMetricsJob();
    console.log('\n✓ Metrics collection completed');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Metrics collection failed:', error);
    process.exit(1);
  }
}

// ===== 메인 실행 =====

const args = process.argv.slice(2);

if (args.includes('--once')) {
  // 한 번만 실행하고 종료
  runOnce();
} else {
  // 스케줄러 시작
  startScheduler();

  // 프로세스 종료 시 정리
  process.on('SIGINT', () => {
    console.log('\n📍 Shutting down metrics scheduler...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n📍 Metrics scheduler terminated');
    process.exit(0);
  });
}
