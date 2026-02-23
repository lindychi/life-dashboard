// Next.js Instrumentation Hook
// 서버 시작 시 오케스트레이터 + 크론 스케줄러를 부트스트랩합니다
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  // 서버 런타임에서만 시작 (Edge 런타임 제외)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOrchestrator, gracefulShutdown } = await import(
      "@/lib/orchestrator"
    );
    const { startCronScheduler, gracefulShutdownCron } = await import(
      "@/lib/cron-scheduler"
    );

    // 크론 핸들러 등록 (import 시 자동 등록)
    await import("@/lib/cron-handlers/daily-assistant");
    await import("@/lib/cron-handlers/agent-improvement");
    await import("@/lib/cron-handlers/cleanup-old-runs");

    // 오케스트레이터 시작 (advisory lock 포함)
    await startOrchestrator();

    // 크론 스케줄러 시작 (advisory lock 포함, 별도 lock key 사용)
    await startCronScheduler();

    // 그레이스풀 셧다운 핸들러 (Railway SIGTERM 대응)
    process.on("SIGTERM", () => {
      console.log("[instrumentation] SIGTERM received, shutting down...");
      gracefulShutdown();
      gracefulShutdownCron();
    });

    process.on("SIGINT", () => {
      console.log("[instrumentation] SIGINT received, shutting down...");
      gracefulShutdown();
      gracefulShutdownCron();
    });
  }
}
