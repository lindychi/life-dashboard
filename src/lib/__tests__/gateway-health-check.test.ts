/**
 * TDD: Gateway Health Check Enhancement
 *
 * GREEN Phase: Tests for GatewayHealthChecker implementation
 * Feature: Enhanced health checks with heartbeat + TCP connection validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GatewayHealthChecker } from "@/lib/gateway-health-checker";

describe("Gateway Health Check (P0)", () => {
  let checker: GatewayHealthChecker;

  beforeEach(() => {
    checker = new GatewayHealthChecker(30000);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("checkHealth", () => {
    it("should return healthy if heartbeat within threshold", async () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 10000); // 10 seconds ago

      const result = await checker.checkHealth(recentHeartbeat);
      expect(result.isHealthy).toBe(true);
      expect(result.lastHeartbeatMs).toBeLessThan(30000);
    });

    it("should return unhealthy if heartbeat timeout exceeded", async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 60000); // 60 seconds ago (> 30s threshold)

      const result = await checker.checkHealth(staleHeartbeat);
      expect(result.isHealthy).toBe(false);
      expect(result.lastHeartbeatMs).toBeGreaterThan(30000);
    });

    it("should include reason for unhealthy status", async () => {
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 60000);

      const result = await checker.checkHealth(staleHeartbeat);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("heartbeat");
    });

    it("should check TCP connection if checker provided", async () => {
      const mockTcpChecker = vi.fn().mockResolvedValue(true);
      const checkerWithTcp = new GatewayHealthChecker(30000, mockTcpChecker);

      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 10000);

      await checkerWithTcp.checkHealth(recentHeartbeat);
      // Should have called TCP checker if heartbeat is fresh
      expect(mockTcpChecker).toHaveBeenCalled();
    });

    it("should mark unhealthy if TCP connection unavailable despite fresh heartbeat", async () => {
      const mockTcpChecker = vi.fn().mockResolvedValue(false);
      const checkerWithTcp = new GatewayHealthChecker(30000, mockTcpChecker);

      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 10000);

      const result = await checkerWithTcp.checkHealth(recentHeartbeat);
      expect(result.hasTcpConnection).toBe(false);
    });

    it("should not call TCP checker if heartbeat is stale", async () => {
      const mockTcpChecker = vi.fn().mockResolvedValue(true);
      const checkerWithTcp = new GatewayHealthChecker(30000, mockTcpChecker);

      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 60000);

      await checkerWithTcp.checkHealth(staleHeartbeat);
      // Should NOT call TCP checker if heartbeat is already stale
      expect(mockTcpChecker).not.toHaveBeenCalled();
    });
  });

  describe("isZombie", () => {
    it("should return false for gateways with recent heartbeat", () => {
      const now = new Date();
      const recentHeartbeat = new Date(now.getTime() - 60000); // 1 minute ago

      const isZombie = checker.isZombie(recentHeartbeat);
      expect(isZombie).toBe(false);
    });

    it("should return true for gateways inactive 7+ days", () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const isZombie = checker.isZombie(sevenDaysAgo);
      expect(isZombie).toBe(true);
    });

    it("should return false at exactly 6 days 23 hours 59 minutes", () => {
      const now = new Date();
      const almostSevenDays = new Date(
        now.getTime() - (7 * 24 * 60 * 60 * 1000 - 60 * 1000)
      );

      const isZombie = checker.isZombie(almostSevenDays);
      expect(isZombie).toBe(false);
    });

    it("should return true at exactly 7 days", () => {
      const now = new Date();
      const exactlySevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const isZombie = checker.isZombie(exactlySevenDays);
      expect(isZombie).toBe(true);
    });
  });

  describe("checkMultiple", () => {
    it("should check multiple gateways in parallel", async () => {
      const gateways = [
        { id: "gateway-1", lastHeartbeat: new Date(Date.now() - 10000) },
        { id: "gateway-2", lastHeartbeat: new Date(Date.now() - 60000) },
        { id: "gateway-3", lastHeartbeat: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      ];

      const results = await checker.checkMultiple(gateways);
      expect(results).toHaveLength(3);
      expect(results[0].gatewayId).toBe("gateway-1");
      expect(results[1].gatewayId).toBe("gateway-2");
      expect(results[2].gatewayId).toBe("gateway-3");
    });

    it("should identify healthy gateways", async () => {
      const gateways = [
        { id: "gateway-1", lastHeartbeat: new Date(Date.now() - 10000) },
      ];

      const results = await checker.checkMultiple(gateways);
      expect(results[0].isHealthy).toBe(true);
    });

    it("should identify zombie gateways", async () => {
      const gateways = [
        {
          id: "gateway-zombie",
          lastHeartbeat: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      ];

      const results = await checker.checkMultiple(gateways);
      expect(results[0].isZombie).toBe(true);
    });

    it("should return empty array for empty input", async () => {
      const results = await checker.checkMultiple([]);
      expect(results).toHaveLength(0);
    });
  });
});
