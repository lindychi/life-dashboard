/**
 * Fix 1: Error Info Leakage in Metrics APIs
 *
 * Tests that error responses return generic "Server error" instead of actual error.message
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Track what query throws
let mockQueryError: Error | null = null;

vi.mock("@/lib/db", () => ({
  query: vi.fn(async () => {
    if (mockQueryError) throw mockQueryError;
    return [];
  }),
  queryOne: vi.fn(async () => null),
  isDbConnectionError: vi.fn(() => false),
}));

describe("Metrics API - Error Info Leakage", () => {
  beforeEach(() => {
    mockQueryError = null;
  });

  describe("GET /api/metrics", () => {
    it("should return generic 'Server error' instead of actual error message", async () => {
      mockQueryError = new Error("relation 'daily_agent_metrics' does not exist");

      const { GET } = await import("@/app/api/metrics/route");
      const request = new NextRequest("http://localhost/api/metrics?view=daily_agent");
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Server error");
      // Must NOT contain the actual DB error
      expect(JSON.stringify(body)).not.toContain("relation");
      expect(JSON.stringify(body)).not.toContain("does not exist");
    });
  });

  describe("GET /api/metrics/summary", () => {
    it("should return generic 'Server error' instead of actual error message", async () => {
      mockQueryError = new Error("connection refused to database");

      const { GET } = await import("@/app/api/metrics/summary/route");
      const request = new NextRequest("http://localhost/api/metrics/summary");
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe("Server error");
      // Must NOT contain the actual DB error
      expect(JSON.stringify(body)).not.toContain("connection refused");
    });
  });
});
