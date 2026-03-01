/**
 * In-Process LRU Cache with TTL
 *
 * Doubly-linked list + Map for O(1) get/set/delete.
 * Entries expire after their individual TTL.
 * withCache() provides request-deduplication for concurrent callers.
 */

interface CacheNode<T> {
  key: string;
  value: T;
  expiresAt: number;
  prev: CacheNode<T> | null;
  next: CacheNode<T> | null;
}

export class LRUCache<T> {
  private readonly maxSize: number;
  private readonly map: Map<string, CacheNode<T>> = new Map();
  // Sentinel head (LRU end) and tail (MRU end)
  private readonly head: CacheNode<T>;
  private readonly tail: CacheNode<T>;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    // Use sentinels to avoid null-checks in hot paths
    this.head = { key: "", value: undefined as unknown as T, expiresAt: 0, prev: null, next: null };
    this.tail = { key: "", value: undefined as unknown as T, expiresAt: 0, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string): T | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    if (Date.now() >= node.expiresAt) {
      this._removeNode(node);
      this.map.delete(key);
      return undefined;
    }
    // Move to MRU (tail side)
    this._removeNode(node);
    this._insertBeforeTail(node);
    return node.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    const existing = this.map.get(key);
    if (existing) {
      this._removeNode(existing);
      this.map.delete(key);
    }

    const node: CacheNode<T> = {
      key,
      value,
      expiresAt: Date.now() + ttlMs,
      prev: null,
      next: null,
    };
    this._insertBeforeTail(node);
    this.map.set(key, node);

    // Evict LRU if over capacity
    if (this.map.size > this.maxSize) {
      const lru = this.head.next!;
      if (lru !== this.tail) {
        this._removeNode(lru);
        this.map.delete(lru.key);
      }
    }
  }

  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this._removeNode(node);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Check existence without affecting LRU order.
   * Returns false for expired entries.
   */
  has(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    if (Date.now() >= node.expiresAt) {
      this._removeNode(node);
      this.map.delete(key);
      return false;
    }
    return true;
  }

  private _removeNode(node: CacheNode<T>): void {
    const prev = node.prev!;
    const next = node.next!;
    prev.next = next;
    next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  private _insertBeforeTail(node: CacheNode<T>): void {
    const prev = this.tail.prev!;
    prev.next = node;
    node.prev = prev;
    node.next = this.tail;
    this.tail.prev = node;
  }
}

// In-flight promise dedup map: key -> pending Promise
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Helper for API route caching with request deduplication.
 * Concurrent calls to the same key share one in-flight fetchFn invocation.
 */
export async function withCache<T>(
  cache: LRUCache<T>,
  key: string,
  ttlMs: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  // Return cached value if still fresh
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Deduplicate concurrent callers
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fetchFn().then((value) => {
    cache.set(key, value, ttlMs);
    inFlight.delete(key);
    return value;
  }).catch((err) => {
    inFlight.delete(key);
    throw err;
  });

  inFlight.set(key, promise as Promise<unknown>);
  return promise;
}
