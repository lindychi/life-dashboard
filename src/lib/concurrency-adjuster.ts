// Concurrency dynamic adjustment based on time of day (KST timezone)
// Adjusts task concurrency limits for the "default" concurrency group

import { getConcurrencyConfig, setConcurrencyLimit } from "./task-queue";

/** Peak hours in KST (Asia/Seoul, UTC+9) where higher concurrency is preferred */
export const PEAK_HOURS: readonly number[] = [12, 13, 14, 20, 21, 22];

/** Max concurrent tasks during peak hours */
export const PEAK_CONCURRENCY = 5;

/** Max concurrent tasks during off-peak hours */
export const DEFAULT_CONCURRENCY = 3;

/** Absolute maximum concurrent tasks (safety cap) */
export const MAX_CONCURRENCY = 8;

/** Absolute minimum concurrent tasks */
export const MIN_CONCURRENCY = 2;

/** The concurrency group name managed by this adjuster */
const MANAGED_GROUP = "default";

/**
 * Returns the current hour (0–23) in Asia/Seoul timezone (KST, UTC+9).
 */
export function getCurrentKSTHour(): number {
  const now = new Date();
  // Intl.DateTimeFormat gives us the local hour in the target timezone
  const kstHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  // Intl may return 24 for midnight in some environments; normalise to 0
  return kstHour === 24 ? 0 : kstHour;
}

/**
 * Returns the optimal max_concurrent value for a given KST hour.
 * Always clamped between MIN_CONCURRENCY and MAX_CONCURRENCY.
 *
 * @param kstHour - hour of day in KST (0–23)
 */
export function getOptimalConcurrency(kstHour: number): number {
  const optimal = (PEAK_HOURS as number[]).includes(kstHour)
    ? PEAK_CONCURRENCY
    : DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, optimal));
}

export interface AdjustConcurrencyResult {
  changed: boolean;
  oldValue: number;
  newValue: number;
}

/**
 * Checks the current concurrency config for the "default" group and updates
 * it if the optimal value differs from the current value.
 *
 * @returns whether the value was changed, and the old/new values
 */
export async function adjustConcurrency(): Promise<AdjustConcurrencyResult> {
  const kstHour = getCurrentKSTHour();
  const optimal = getOptimalConcurrency(kstHour);

  const current = await getConcurrencyConfig(MANAGED_GROUP);
  const currentValue = current?.maxConcurrent ?? null;

  if (currentValue === optimal) {
    return { changed: false, oldValue: optimal, newValue: optimal };
  }

  const oldValue = currentValue ?? optimal;
  await setConcurrencyLimit(MANAGED_GROUP, optimal);

  return { changed: true, oldValue, newValue: optimal };
}
