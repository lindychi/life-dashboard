import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the pg module - use a proper constructor function
vi.mock("pg", () => {
  const mockQuery = vi.fn();
  return {
    Pool: function Pool(this: any) {
      this.query = mockQuery;
    },
    __mockQuery: mockQuery,
  };
});

// Import after mocking
import { query, queryOne, isDbConnectionError, withDbFallback } from "../db";

// Get the mock query function
const getMockQuery = async () => {
  const pg = vi.mocked(await import("pg")) as any;
  return pg.__mockQuery;
};

describe("db resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isDbConnectionError", () => {
    it("should return true for ECONNREFUSED error", () => {
      const error = new AggregateError(
        [Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })],
        "connect ECONNREFUSED"
      );
      expect(isDbConnectionError(error)).toBe(true);
    });

    it("should return true for error with ECONNREFUSED code", () => {
      const error = Object.assign(new Error("connection refused"), {
        code: "ECONNREFUSED",
      });
      expect(isDbConnectionError(error)).toBe(true);
    });

    it("should return true for ENOTFOUND (DNS failure)", () => {
      const error = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      });
      expect(isDbConnectionError(error)).toBe(true);
    });

    it("should return true for ECONNRESET", () => {
      const error = Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      });
      expect(isDbConnectionError(error)).toBe(true);
    });

    it("should return true for ETIMEDOUT", () => {
      const error = Object.assign(new Error("connection timed out"), {
        code: "ETIMEDOUT",
      });
      expect(isDbConnectionError(error)).toBe(true);
    });

    it("should return false for non-connection errors", () => {
      expect(isDbConnectionError(new Error("syntax error"))).toBe(false);
    });

    it("should return false for null/undefined", () => {
      expect(isDbConnectionError(null)).toBe(false);
      expect(isDbConnectionError(undefined)).toBe(false);
    });

    it("should detect nested errors in AggregateError", () => {
      const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      });
      const aggregate = new AggregateError([inner], "AggregateError");
      expect(isDbConnectionError(aggregate)).toBe(true);
    });
  });

  describe("withDbFallback", () => {
    it("should return the result when DB call succeeds", async () => {
      const result = await withDbFallback(async () => [{ id: 1 }], []);
      expect(result).toEqual([{ id: 1 }]);
    });

    it("should return fallback on ECONNREFUSED", async () => {
      const error = new AggregateError(
        [Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })],
        "connect ECONNREFUSED"
      );
      const result = await withDbFallback(async () => { throw error; }, []);
      expect(result).toEqual([]);
    });

    it("should return fallback on ENOTFOUND", async () => {
      const error = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      });
      const result = await withDbFallback(async () => { throw error; }, { data: "default" });
      expect(result).toEqual({ data: "default" });
    });

    it("should re-throw non-connection errors", async () => {
      const error = new Error("syntax error in SQL");
      await expect(
        withDbFallback(async () => { throw error; }, [])
      ).rejects.toThrow("syntax error in SQL");
    });

    it("should log connection errors with console.warn (not console.error)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" });

      await withDbFallback(async () => { throw error; }, []);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Database connection failed")
      );
      warnSpy.mockRestore();
    });
  });
});
