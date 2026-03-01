/**
 * LRU Cache Tests (TDD)
 *
 * Tests for in-process LRU cache with TTL support.
 * Covers: basic ops, TTL expiry, LRU eviction, concurrency dedup.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LRUCache, withCache } from "../lru-cache";

describe("LRUCache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Construction", () => {
    it("creates cache with given max capacity", () => {
      const cache = new LRUCache<string>(10);
      expect(cache.size).toBe(0);
    });
  });

  describe("get / set", () => {
    it("returns undefined for missing key", () => {
      const cache = new LRUCache<string>(10);
      expect(cache.get("missing")).toBeUndefined();
    });

    it("stores and retrieves value", () => {
      const cache = new LRUCache<string>(10);
      cache.set("key1", "value1", 60_000);
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined after TTL expires", () => {
      const cache = new LRUCache<number>(10);
      cache.set("key1", 42, 1_000); // 1 second TTL
      vi.advanceTimersByTime(1_001);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("returns value just before TTL expires", () => {
      const cache = new LRUCache<number>(10);
      cache.set("key1", 42, 1_000);
      vi.advanceTimersByTime(999);
      expect(cache.get("key1")).toBe(42);
    });
  });

  describe("LRU eviction", () => {
    it("evicts least-recently-used entry when over maxSize", () => {
      const cache = new LRUCache<string>(3);
      cache.set("a", "A", 60_000);
      cache.set("b", "B", 60_000);
      cache.set("c", "C", 60_000);
      // Adding 4th entry should evict "a" (LRU)
      cache.set("d", "D", 60_000);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("B");
      expect(cache.get("c")).toBe("C");
      expect(cache.get("d")).toBe("D");
    });

    it("get refreshes entry position (moves to most-recently-used)", () => {
      const cache = new LRUCache<string>(3);
      cache.set("a", "A", 60_000);
      cache.set("b", "B", 60_000);
      cache.set("c", "C", 60_000);
      // Access "a" so it becomes MRU; LRU is now "b"
      cache.get("a");
      cache.set("d", "D", 60_000);
      expect(cache.get("b")).toBeUndefined(); // "b" was evicted
      expect(cache.get("a")).toBe("A");
      expect(cache.get("c")).toBe("C");
      expect(cache.get("d")).toBe("D");
    });
  });

  describe("delete", () => {
    it("removes a specific entry and returns true", () => {
      const cache = new LRUCache<string>(10);
      cache.set("key1", "value1", 60_000);
      const deleted = cache.delete("key1");
      expect(deleted).toBe(true);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("returns false when key does not exist", () => {
      const cache = new LRUCache<string>(10);
      expect(cache.delete("nonexistent")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      const cache = new LRUCache<string>(10);
      cache.set("a", "A", 60_000);
      cache.set("b", "B", 60_000);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
    });
  });

  describe("size", () => {
    it("returns current entry count", () => {
      const cache = new LRUCache<string>(10);
      expect(cache.size).toBe(0);
      cache.set("a", "A", 60_000);
      expect(cache.size).toBe(1);
      cache.set("b", "B", 60_000);
      expect(cache.size).toBe(2);
      cache.delete("a");
      expect(cache.size).toBe(1);
    });
  });

  describe("has", () => {
    it("returns true for existing non-expired key", () => {
      const cache = new LRUCache<string>(10);
      cache.set("key1", "value1", 60_000);
      expect(cache.has("key1")).toBe(true);
    });

    it("returns false for missing key", () => {
      const cache = new LRUCache<string>(10);
      expect(cache.has("missing")).toBe(false);
    });

    it("returns false for expired key", () => {
      const cache = new LRUCache<string>(10);
      cache.set("key1", "value1", 500);
      vi.advanceTimersByTime(501);
      expect(cache.has("key1")).toBe(false);
    });

    it("does not affect LRU order", () => {
      const cache = new LRUCache<string>(2);
      cache.set("a", "A", 60_000);
      cache.set("b", "B", 60_000);
      // has("a") should NOT move "a" to MRU
      cache.has("a");
      // Adding "c" should evict LRU which should still be "a"
      cache.set("c", "C", 60_000);
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("B");
      expect(cache.get("c")).toBe("C");
    });
  });
});

describe("withCache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cached value when fresh", async () => {
    const cache = new LRUCache<string>(10);
    const fetchFn = vi.fn().mockResolvedValue("fetched");

    const result1 = await withCache(cache, "key1", 60_000, fetchFn);
    const result2 = await withCache(cache, "key1", 60_000, fetchFn);

    expect(result1).toBe("fetched");
    expect(result2).toBe("fetched");
    expect(fetchFn).toHaveBeenCalledTimes(1); // Only called once
  });

  it("calls fetchFn when cache is stale/missing", async () => {
    const cache = new LRUCache<string>(10);
    const fetchFn = vi.fn().mockResolvedValue("fresh");

    await withCache(cache, "key1", 500, fetchFn);
    vi.advanceTimersByTime(501);
    await withCache(cache, "key1", 500, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent calls to same key (only one fetchFn invocation)", async () => {
    const cache = new LRUCache<string>(10);
    let resolveFetch!: (value: string) => void;
    const slowFetch = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        })
    );

    // Start 3 concurrent calls before the first resolves
    const [p1, p2, p3] = [
      withCache(cache, "key1", 60_000, slowFetch),
      withCache(cache, "key1", 60_000, slowFetch),
      withCache(cache, "key1", 60_000, slowFetch),
    ];

    resolveFetch("shared-value");

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe("shared-value");
    expect(r2).toBe("shared-value");
    expect(r3).toBe("shared-value");
    expect(slowFetch).toHaveBeenCalledTimes(1);
  });
});
