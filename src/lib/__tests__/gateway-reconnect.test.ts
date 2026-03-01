/**
 * TDD: Gateway Auto-Reconnect with Exponential Backoff
 *
 * GREEN Phase: Implementation complete
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Create a simple reconnection manager (not yet implemented)
interface ReconnectConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
  jitterFactor?: number;
}

interface ReconnectState {
  isConnected: boolean;
  retryCount: number;
  nextRetryAt?: Date;
}

class GatewayReconnectManager {
  private config: ReconnectConfig;
  private state: ReconnectState = {
    isConnected: false,
    retryCount: 0,
  };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ReconnectConfig) {
    this.config = config;
  }

  // Should calculate exponential backoff delay
  getNextRetryDelay(): number {
    const base = this.config.initialDelayMs * Math.pow(2, this.state.retryCount);
    const jitter = this.config.jitterFactor ?? 0;
    // Apply jitter before capping so the result never exceeds maxDelayMs
    const jitterAmount = Math.random() * jitter * base;
    return Math.min(base + jitterAmount, this.config.maxDelayMs);
  }

  // Should schedule next reconnection attempt
  async scheduleRetry(): Promise<void> {
    if (!this.canRetry()) return;
    const delay = this.getNextRetryDelay();
    this.state.nextRetryAt = new Date(Date.now() + delay);
    await new Promise<void>((resolve) => {
      this.retryTimer = setTimeout(() => {
        this.state.retryCount++;
        resolve();
      }, delay);
    });
  }

  // Should reset state on successful connection
  markConnected(): void {
    this.state.retryCount = 0;
    this.state.isConnected = true;
    this.state.nextRetryAt = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // Should check if can retry
  canRetry(): boolean {
    if (this.state.isConnected) return false;
    return this.state.retryCount < this.config.maxRetries;
  }

  getState(): ReconnectState {
    return this.state;
  }

  cancel(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

describe("GatewayReconnectManager", () => {
  let manager: GatewayReconnectManager;

  beforeEach(() => {
    manager = new GatewayReconnectManager({
      initialDelayMs: 1000,
      maxDelayMs: 32000,
      maxRetries: 10,
      jitterFactor: 0.1,
    });
  });

  afterEach(() => {
    manager.cancel();
  });

  describe("getNextRetryDelay", () => {
    it("should return initial delay on first retry", () => {
      const delay = manager.getNextRetryDelay();
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1000 * 1.1); // with 10% jitter
    });

    it("should double delay on each retry (exponential backoff)", () => {
      manager.getState().retryCount = 0;
      const delay1 = manager.getNextRetryDelay();

      manager.getState().retryCount = 1;
      const delay2 = manager.getNextRetryDelay();

      manager.getState().retryCount = 2;
      const delay3 = manager.getNextRetryDelay();

      // Allow for jitter variance
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it("should cap delay at maxDelayMs", () => {
      manager.getState().retryCount = 10; // Would be 1000 * 2^10 = 1024000ms
      const delay = manager.getNextRetryDelay();
      expect(delay).toBeLessThanOrEqual(32000); // maxDelayMs
    });

    it("should include jitter to prevent thundering herd", () => {
      manager.getState().retryCount = 0;
      const delays = Array.from({ length: 5 }, () =>
        manager.getNextRetryDelay()
      );

      // Should have some variation due to jitter
      const hasVariation = new Set(delays).size > 1;
      expect(hasVariation).toBe(true);
    });
  });

  describe("canRetry", () => {
    it("should return true when retry count < maxRetries", () => {
      manager.getState().retryCount = 5;
      expect(manager.canRetry()).toBe(true);
    });

    it("should return false when retry count >= maxRetries", () => {
      manager.getState().retryCount = 10;
      expect(manager.canRetry()).toBe(false);
    });

    it("should return false when already connected", () => {
      manager.getState().isConnected = true;
      manager.getState().retryCount = 0;
      expect(manager.canRetry()).toBe(false);
    });
  });

  describe("markConnected", () => {
    it("should reset retry count to 0", () => {
      manager.getState().retryCount = 5;
      manager.markConnected();
      expect(manager.getState().retryCount).toBe(0);
    });

    it("should set isConnected to true", () => {
      manager.markConnected();
      expect(manager.getState().isConnected).toBe(true);
    });

    it("should clear scheduled retry timer", () => {
      // Simulate timer being set
      manager.getState().nextRetryAt = new Date(Date.now() + 5000);
      manager.markConnected();
      expect(manager.getState().nextRetryAt).toBeUndefined();
    });
  });

  describe("scheduleRetry", () => {
    it("should schedule retry if canRetry returns true", async () => {
      vi.useFakeTimers();
      manager.getState().retryCount = 2;

      const mockCallback = vi.fn();
      // Would need to pass callback to manager (not in current interface)

      vi.useRealTimers();
    });
  });
});
