#!/usr/bin/env tsx
// 히스토리 데이터 패턴 분석 테스트 스크립트
// 실행: tsx scripts/test-analytics.ts

import { generateAnalyticsSummary } from "../src/lib/analytics";

async function main() {
  console.log("🔍 히스토리 데이터 패턴 분석 시작...\n");

  const days = parseInt(process.argv[2] || "30", 10);
  console.log(`📅 분석 기간: 최근 ${days}일\n`);

  try {
    const summary = await generateAnalyticsSummary({ days });

    // ─── 전체 개요 ───────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 전체 개요");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`총 태스크 수: ${summary.overview.totalTasks}`);
    console.log(`총 에이전트 수: ${summary.overview.totalAgents}`);
    console.log(`전체 완료율: ${summary.overview.overallCompletionRate}%`);
    console.log(`전체 실패율: ${summary.overview.overallFailureRate}%`);
    console.log(
      `평균 소요 시간: ${
        summary.overview.avgTaskDurationMinutes
          ? `${summary.overview.avgTaskDurationMinutes}분`
          : "N/A"
      }`
    );
    console.log();

    // ─── 에이전트별 성과 ──────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🤖 에이전트별 성과");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (summary.agentPerformance.length === 0) {
      console.log("(데이터 없음)");
    } else {
      summary.agentPerformance.forEach((agent, idx) => {
        console.log(`\n${idx + 1}. ${agent.agentId}`);
        console.log(
          `   총 태스크: ${agent.totalTasks} | 완료: ${agent.completedTasks} | 실패: ${agent.failedTasks} | 진행중: ${agent.inProgressTasks}`
        );
        console.log(
          `   완료율: ${agent.completionRate}% | 실패율: ${agent.failureRate}%`
        );
        console.log(
          `   평균 소요: ${
            agent.avgCompletionTimeMinutes ? `${agent.avgCompletionTimeMinutes}분` : "N/A"
          } | 중앙값: ${
            agent.medianCompletionTimeMinutes
              ? `${agent.medianCompletionTimeMinutes}분`
              : "N/A"
          }`
        );

        // 시각적 표시 (완료율 기준)
        const stars = "★".repeat(Math.floor(agent.completionRate / 20));
        const emptyStars = "☆".repeat(5 - Math.floor(agent.completionRate / 20));
        console.log(`   성능: ${stars}${emptyStars}`);
      });
    }
    console.log();

    // ─── 태스크 유형별 분석 ───────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 태스크 유형별 분석");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (summary.taskTypeAnalysis.length === 0) {
      console.log("(데이터 없음)");
    } else {
      summary.taskTypeAnalysis.forEach((taskType, idx) => {
        console.log(`\n${idx + 1}. ${taskType.taskType}`);
        console.log(
          `   총: ${taskType.totalCount} | 완료: ${taskType.completedCount} | 실패: ${taskType.failedCount} | 진행중: ${taskType.inProgressCount}`
        );
        console.log(`   성공률: ${taskType.successRate}%`);
        console.log(
          `   평균 소요: ${
            taskType.avgDurationMinutes ? `${taskType.avgDurationMinutes}분` : "N/A"
          } | 중앙값: ${
            taskType.medianDurationMinutes
              ? `${taskType.medianDurationMinutes}분`
              : "N/A"
          }`
        );
        console.log(
          `   주 담당 에이전트: ${taskType.mostFrequentAgent || "N/A"}`
        );
      });
    }
    console.log();

    // ─── 시간대별 패턴 ────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("⏰ 시간대별 패턴 (상위 10개)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (summary.timePatterns.length === 0) {
      console.log("(데이터 없음)");
    } else {
      const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
      const topPatterns = summary.timePatterns
        .sort((a, b) => b.taskCount - a.taskCount)
        .slice(0, 10);

      topPatterns.forEach((pattern, idx) => {
        const dayName = dayNames[pattern.dayOfWeek];
        console.log(
          `${idx + 1}. ${dayName}요일 ${pattern.hour}시: ${pattern.taskCount}개 태스크, 완료율 ${pattern.completionRate}%`
        );
      });
    }
    console.log();

    // ─── 실패 패턴 ────────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("❌ 실패 패턴 (빈도 순)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (summary.failurePatterns.length === 0) {
      console.log("(실패 데이터 없음)");
    } else {
      summary.failurePatterns.forEach((pattern, idx) => {
        console.log(`\n${idx + 1}. "${pattern.errorKeyword}"`);
        console.log(`   발생 횟수: ${pattern.occurrenceCount}회`);
        console.log(
          `   영향받은 에이전트: ${pattern.affectedAgents.join(", ") || "N/A"}`
        );
        console.log(
          `   첫 발생: ${new Date(pattern.firstSeen).toLocaleString("ko-KR")}`
        );
        console.log(
          `   마지막 발생: ${new Date(pattern.lastSeen).toLocaleString("ko-KR")}`
        );

        if (pattern.sampleErrors.length > 0) {
          console.log(`   샘플 에러:`);
          pattern.sampleErrors.forEach((err, errIdx) => {
            const truncated =
              err.length > 100 ? err.substring(0, 100) + "..." : err;
            console.log(`     ${errIdx + 1}) ${truncated}`);
          });
        }
      });
    }
    console.log();

    // ─── 개선 권장사항 ────────────────────────────────────
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("💡 개선 권장사항");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (summary.recommendations.length === 0) {
      console.log("✅ 특별한 문제점이 발견되지 않았습니다.");
    } else {
      summary.recommendations.forEach((rec, idx) => {
        console.log(`\n${idx + 1}. ${rec}`);
      });
    }
    console.log();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ 분석 완료");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } catch (error) {
    console.error("❌ 분석 중 오류 발생:", error);
    process.exit(1);
  }
}

main();
