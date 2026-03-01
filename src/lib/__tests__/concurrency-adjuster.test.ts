import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock pg and db before importing the module under test
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn(),
  withDbFallback: vi.fn(),
  pool: {},
}));

// Mock task-queue setConcurrencyLimit and getConcurrencyConfig
vi.mock("../task-queue", () => ({
  setConcurrencyLimit: vi.fn(),
  getConcurrencyConfig: vi.fn(),
}));

import { setConcurrencyLimit, getConcurrencyConfig } from "../task-queue";
import {
  PEAK_HOURS,
  PEAK_CONCURRENCY,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  MIN_CONCURRENCY,
  getCurrentKSTHour,
  getOptimalConcurrency,
  adjustConcurrency,
} from "../concurrency-adjuster";

describe("Concurrency Adjuster - Constants", () => {
  it("PEAK_HOURS includes 12, 13, 14 (midday KST)", () => {
    expect(PEAK_HOURS).toContain(12);
    expect(PEAK_HOURS).toContain(13);
    expect(PEAK_HOURS).toContain(14);
  });

  it("PEAK_HOURS includes 20, 21, 22 (evening KST)", () => {
    expect(PEAK_HOURS).toContain(20);
    expect(PEAK_HOURS).toContain(21);
    expect(PEAK_HOURS).toContain(22);
  });

  it("PEAK_CONCURRENCY is 5", () => {
    expect(PEAK_CONCURRENCY).toBe(5);
  });

  it("DEFAULT_CONCURRENCY is 3", () => {
    expect(DEFAULT_CONCURRENCY).toBe(3);
  });

  it("MAX_CONCURRENCY is 8", () => {
    expect(MAX_CONCURRENCY).toBe(8);
  });

  it("MIN_CONCURRENCY is 2", () => {
    expect(MIN_CONCURRENCY).toBe(2);
  });
});

describe("Concurrency Adjuster - getOptimalConcurrency", () => {
  it("returns PEAK_CONCURRENCY during peak hour 12 (midday)", () => {
    expect(getOptimalConcurrency(12)).toBe(PEAK_CONCURRENCY);
  });

  it("returns PEAK_CONCURRENCY during peak hour 13", () => {
    expect(getOptimalConcurrency(13)).toBe(PEAK_CONCURRENCY);
  });

  it("returns PEAK_CONCURRENCY during peak hour 14", () => {
    expect(getOptimalConcurrency(14)).toBe(PEAK_CONCURRENCY);
  });

  it("returns PEAK_CONCURRENCY during peak hour 20 (evening)", () => {
    expect(getOptimalConcurrency(20)).toBe(PEAK_CONCURRENCY);
  });

  it("returns PEAK_CONCURRENCY during peak hour 21", () => {
    expect(getOptimalConcurrency(21)).toBe(PEAK_CONCURRENCY);
  });

  it("returns PEAK_CONCURRENCY during peak hour 22", () => {
    expect(getOptimalConcurrency(22)).toBe(PEAK_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY during off-peak hour 3 (early morning)", () => {
    expect(getOptimalConcurrency(3)).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY during off-peak hour 9 (morning)", () => {
    expect(getOptimalConcurrency(9)).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY during off-peak hour 18 (early evening)", () => {
    expect(getOptimalConcurrency(18)).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY during off-peak hour 23 (late night)", () => {
    expect(getOptimalConcurrency(23)).toBe(DEFAULT_CONCURRENCY);
  });

  it("returns DEFAULT_CONCURRENCY for hour 0 (midnight)", () => {
    expect(getOptimalConcurrency(0)).toBe(DEFAULT_CONCURRENCY);
  });

  it("never exceeds MAX_CONCURRENCY (8) for any hour", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(getOptimalConcurrency(hour)).toBeLessThanOrEqual(MAX_CONCURRENCY);
    }
  });

  it("never goes below MIN_CONCURRENCY (2) for any hour", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(getOptimalConcurrency(hour)).toBeGreaterThanOrEqual(MIN_CONCURRENCY);
    }
  });
});

describe("Concurrency Adjuster - getCurrentKSTHour", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a number between 0 and 23", () => {
    const hour = getCurrentKSTHour();
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("returns an integer", () => {
    const hour = getCurrentKSTHour();
    expect(Number.isInteger(hour)).toBe(true);
  });

  it("returns correct KST hour when UTC is known (UTC 15:00 = KST 00:00)", () => {
    // UTC 15:00 → KST 00:00 (UTC+9)
    const utcMidnight = new Date("2025-01-01T15:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(utcMidnight);

    const hour = getCurrentKSTHour();
    expect(hour).toBe(0);
  });

  it("returns correct KST hour when UTC is 03:00 (KST 12:00)", () => {
    // UTC 03:00 → KST 12:00 (UTC+9)
    const utc3 = new Date("2025-01-01T03:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(utc3);

    const hour = getCurrentKSTHour();
    expect(hour).toBe(12);
  });

  it("returns correct KST hour when UTC is 11:00 (KST 20:00)", () => {
    // UTC 11:00 → KST 20:00 (UTC+9)
    const utc11 = new Date("2025-01-01T11:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(utc11);

    const hour = getCurrentKSTHour();
    expect(hour).toBe(20);
  });
});

describe("Concurrency Adjuster - adjustConcurrency", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates concurrency when current config differs from optimal", async () => {
    // Simulate peak hour (12:00 KST = 03:00 UTC)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T03:00:00Z")); // KST 12:00

    // Current config has value 3, but optimal is 5 (peak hour)
    vi.mocked(getConcurrencyConfig).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: 3,
      updatedAt: new Date().toISOString(),
    });

    vi.mocked(setConcurrencyLimit).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: 5,
      updatedAt: new Date().toISOString(),
    });

    const result = await adjustConcurrency();

    expect(result.changed).toBe(true);
    expect(result.oldValue).toBe(3);
    expect(result.newValue).toBe(5);
    expect(setConcurrencyLimit).toHaveBeenCalledWith("default", 5);
  });

  it("does NOT update concurrency when current value already matches optimal", async () => {
    // Simulate off-peak hour (04:00 KST = 19:00 UTC previous day or similar)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T19:00:00Z")); // KST 04:00 (off-peak)

    // Current config already has the optimal value (3 for off-peak)
    vi.mocked(getConcurrencyConfig).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: 3,
      updatedAt: new Date().toISOString(),
    });

    const result = await adjustConcurrency();

    expect(result.changed).toBe(false);
    expect(result.oldValue).toBe(3);
    expect(result.newValue).toBe(3);
    expect(setConcurrencyLimit).not.toHaveBeenCalled();
  });

  it("sets config to DEFAULT_CONCURRENCY when no existing config found", async () => {
    // Off-peak hour
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T19:00:00Z")); // KST 04:00 (off-peak)

    vi.mocked(getConcurrencyConfig).mockResolvedValue(null);

    vi.mocked(setConcurrencyLimit).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: DEFAULT_CONCURRENCY,
      updatedAt: new Date().toISOString(),
    });

    const result = await adjustConcurrency();

    expect(result.changed).toBe(true);
    expect(setConcurrencyLimit).toHaveBeenCalledWith(
      "default",
      DEFAULT_CONCURRENCY
    );
  });

  it("sets config to PEAK_CONCURRENCY when no existing config and peak hour", async () => {
    // Peak hour: KST 12:00 = UTC 03:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T03:00:00Z")); // KST 12:00 (peak)

    vi.mocked(getConcurrencyConfig).mockResolvedValue(null);

    vi.mocked(setConcurrencyLimit).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: PEAK_CONCURRENCY,
      updatedAt: new Date().toISOString(),
    });

    const result = await adjustConcurrency();

    expect(result.changed).toBe(true);
    expect(setConcurrencyLimit).toHaveBeenCalledWith(
      "default",
      PEAK_CONCURRENCY
    );
  });

  it("returns changed=false when current value already matches peak concurrency during peak hours", async () => {
    // Peak hour: KST 20:00 = UTC 11:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T11:00:00Z")); // KST 20:00 (peak)

    vi.mocked(getConcurrencyConfig).mockResolvedValue({
      concurrencyGroup: "default",
      maxConcurrent: PEAK_CONCURRENCY, // already at 5
      updatedAt: new Date().toISOString(),
    });

    const result = await adjustConcurrency();

    expect(result.changed).toBe(false);
    expect(result.oldValue).toBe(PEAK_CONCURRENCY);
    expect(result.newValue).toBe(PEAK_CONCURRENCY);
    expect(setConcurrencyLimit).not.toHaveBeenCalled();
  });
});
