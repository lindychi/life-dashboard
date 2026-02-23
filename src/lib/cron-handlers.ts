// Cron Handler Registry
// 각 cron job의 실행 로직을 등록/조회하는 패턴

// ─── 타입 정의 ────────────────────────────────────────────

export interface CronHandlerContext {
  /** cron job ID */
  jobId: string;
  /** cron job 이름 */
  jobName: string;
  /** handler_config에 저장된 설정 */
  config: Record<string, unknown>;
}

export interface CronHandlerResult {
  /** 실행 결과 요약 */
  message?: string;
  /** 추가 데이터 */
  data?: Record<string, unknown>;
}

export type CronHandler = (
  context: CronHandlerContext
) => Promise<CronHandlerResult>;

// ─── Registry ─────────────────────────────────────────────

const handlers = new Map<string, CronHandler>();

/**
 * cron handler 등록
 * @param type - handler_type (cron_jobs 테이블의 handler_type과 매칭)
 * @param handler - 실행 함수
 */
export function registerCronHandler(
  type: string,
  handler: CronHandler
): void {
  if (handlers.has(type)) {
    console.warn(`[cron-handlers] Overwriting handler for type: ${type}`);
  }
  handlers.set(type, handler);
  console.log(`[cron-handlers] Registered handler: ${type}`);
}

/**
 * 등록된 cron handler 조회
 */
export function getCronHandler(type: string): CronHandler | undefined {
  return handlers.get(type);
}

/**
 * handler 등록 여부 확인
 */
export function hasCronHandler(type: string): boolean {
  return handlers.has(type);
}

/**
 * 등록된 모든 handler type 목록
 */
export function getRegisteredHandlerTypes(): string[] {
  return Array.from(handlers.keys());
}

/**
 * handler 등록 해제
 */
export function unregisterCronHandler(type: string): boolean {
  return handlers.delete(type);
}

// ─── 내장 핸들러 ──────────────────────────────────────────

/**
 * noop: 테스트/디버그용 핸들러
 */
registerCronHandler("noop", async (ctx) => {
  return {
    message: `noop handler executed for job: ${ctx.jobName}`,
    data: { config: ctx.config },
  };
});

/**
 * log: 로깅 전용 핸들러
 */
registerCronHandler("log", async (ctx) => {
  const logMessage =
    (ctx.config.message as string) || `Cron job ${ctx.jobName} executed`;
  console.log(`[cron:log] ${logMessage}`);
  return { message: logMessage };
});
