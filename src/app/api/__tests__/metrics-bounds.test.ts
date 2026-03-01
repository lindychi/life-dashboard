/**
 * Fix 2: Unbounded Query Params in Metrics APIs
 *
 * Tests that days and limit params are clamped to reasonable maximums.
 * - days: max 365
 * - limit: max 1000
 *
 * Note: history routes already have proper clamping (Math.min(500, ...)).
 * This test covers the metrics routes which were missing bounds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock pg
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Capture query params passed to DB
let capturedParams: unknown[] = [];

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (_sql: string, params: unknown[] = []) => {
    capturedParams = params;
    return [];
  }),
  queryOne: vi.fn(async () => null),
  isDbConnectionError: vi.fn(() => false),
}));

describe("Metrics API - Unbounded Query Params", () => {
  beforeEach(() => {
    capturedParams = [];
  });

  describe("GET /api/metrics", () => {
    it("should clamp days to max 365", async () => {
      const { GET } = await import("@/app/api/metrics/route");
      const request = new NextRequest("http://localhost/api/metrics?view=raw&days=999999");
      await GET(request);

      // First param is days
      expect(capturedParams[0]).toBeLessThanOrEqual(365);
    });

    it("should clamp limit to max 1000", async () => {
      const { GET } = await import("@/app/api/metrics/route");
      const request = new NextRequest("http://localhost/api/metrics?view=raw&limit=999999");
      await GET(request);

      // Last param is limit
      const lastParam = capturedParams[capturedParams.length - 1];
      expect(lastParam).toBeLessThanOrEqual(1000);
    });

    it("should accept normal values unchanged", async () => {
      const { GET } = await import("@/app/api/metrics/route");
      const request = new NextRequest("http://localhost/api/metrics?view=raw&days=30&limit=50");
      await GET(request);

      expect(capturedParams[0]).toBe(30);
      const lastParam = capturedParams[capturedParams.length - 1];
      expect(lastParam).toBe(50);
    });
  });

  describe("GET /api/metrics/summary", () => {
    it("should clamp days to max 365", async () => {
      const { GET } = await import("@/app/api/metrics/summary/route");
      const request = new NextRequest("http://localhost/api/metrics/summary?days=999999");
      await GET(request);

      // First param of first query is days
      expect(capturedParams[0]).toBeLessThanOrEqual(365);
    });

    it("should accept normal days value unchanged", async () => {
      const { GET } = await import("@/app/api/metrics/summary/route");
      const request = new NextRequest("http://localhost/api/metrics/summary?days=14");
      await GET(request);

      expect(capturedParams[0]).toBe(14);
    });
  });
});
