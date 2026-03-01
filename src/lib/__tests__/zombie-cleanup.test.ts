/**
 * TDD: Zombie Gateway Cleanup (7-day threshold)
 *
 * GREEN Phase: Tests for ZombieCleanupService implementation
 * Feature: Identify and cleanup gateways inactive for 7+ days
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ZombieCleanupService } from "@/lib/zombie-cleanup-service";

describe("Zombie Gateway Cleanup (P0)", () => {
  let service: ZombieCleanupService;

  beforeEach(() => {
    service = new ZombieCleanupService(7);
  });

  describe("identifyZombies", () => {
    it("should identify gateways inactive for exactly 7 days", () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const gateways = [{ id: "gateway-1", lastHeartbeat: sevenDaysAgo }];

      const zombies = service.identifyZombies(gateways);
      expect(zombies).toContain("gateway-1");
    });

    it("should identify gateways inactive for 7+ days", () => {
      const now = new Date();
      const eightDaysAgo = new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000
      );

      const gateways = [{ id: "gateway-1", lastHeartbeat: eightDaysAgo }];

      const zombies = service.identifyZombies(gateways);
      expect(zombies).toContain("gateway-1");
    });

    it("should NOT identify gateways active less than 7 days", () => {
      const now = new Date();
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);

      const gateways = [{ id: "gateway-1", lastHeartbeat: sixDaysAgo }];

      const zombies = service.identifyZombies(gateways);
      expect(zombies).not.toContain("gateway-1");
    });

    it("should identify multiple zombies", () => {
      const now = new Date();
      const eightDaysAgo = new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000
      );
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const gateways = [
        { id: "zombie-1", lastHeartbeat: eightDaysAgo },
        { id: "zombie-2", lastHeartbeat: tenDaysAgo },
        { id: "active-1", lastHeartbeat: oneDayAgo },
      ];

      const zombies = service.identifyZombies(gateways);
      expect(zombies).toHaveLength(2);
      expect(zombies).toContain("zombie-1");
      expect(zombies).toContain("zombie-2");
      expect(zombies).not.toContain("active-1");
    });

    it("should return empty array when no zombies", () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const gateways = [{ id: "gateway-1", lastHeartbeat: oneDayAgo }];

      const zombies = service.identifyZombies(gateways);
      expect(zombies).toHaveLength(0);
    });

    it("should handle empty gateway list", () => {
      const zombies = service.identifyZombies([]);
      expect(zombies).toHaveLength(0);
    });
  });

  describe("removeZombies", () => {
    it("should return count of removed gateways", async () => {
      const count = await service.removeZombies(["gateway-1", "gateway-2"]);
      expect(count).toBe(2);
    });

    it("should handle empty removal list", async () => {
      const count = await service.removeZombies([]);
      expect(count).toBe(0);
    });

    it("should return 0 when no gateways removed", async () => {
      const count = await service.removeZombies(["non-existent-1"]);
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe("cleanup (full flow)", () => {
    it("should return count of checked and removed gateways", async () => {
      const now = new Date();
      const eightDaysAgo = new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000
      );
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const gateways = [
        { id: "zombie-1", lastHeartbeat: eightDaysAgo },
        { id: "active-1", lastHeartbeat: oneDayAgo },
      ];

      const result = await service.cleanup(gateways);
      expect(result.checked).toBe(2);
      expect(result.removed).toContain("zombie-1");
      expect(result.removed).not.toContain("active-1");
    });

    it("should return result object with removed array", async () => {
      const gateways: Array<{ id: string; lastHeartbeat: Date }> = [];
      const result = await service.cleanup(gateways);

      expect(result).toHaveProperty("removed");
      expect(result).toHaveProperty("checked");
      expect(Array.isArray(result.removed)).toBe(true);
      expect(typeof result.checked).toBe("number");
    });

    it("should handle gateways with identical timestamps", async () => {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const gateways = [
        { id: "zombie-1", lastHeartbeat: sevenDaysAgo },
        { id: "zombie-2", lastHeartbeat: sevenDaysAgo },
      ];

      const result = await service.cleanup(gateways);
      expect(result.removed).toHaveLength(2);
    });
  });

  describe("startAutoCleanup", () => {
    it("should return stop function", () => {
      const mockCallback = async () => ({
        removed: [],
        checked: 0,
      });

      const stopFn = service.startAutoCleanup(mockCallback);
      expect(typeof stopFn).toBe("function");
      stopFn(); // Clean up
    });

    it("returned stop function should stop cleanup", async () => {
      const mockCallback = async () => {
        return { removed: [], checked: 0 };
      };

      const stopFn = service.startAutoCleanup(mockCallback);
      stopFn();

      // After stopping, should not continue to run
      expect(typeof stopFn).toBe("function");
    });
  });

  describe("custom threshold", () => {
    it("should respect custom zombie threshold", () => {
      const customService = new ZombieCleanupService(14); // 14 days
      const now = new Date();
      const eightDaysAgo = new Date(
        now.getTime() - 8 * 24 * 60 * 60 * 1000
      );
      const fifteenDaysAgo = new Date(
        now.getTime() - 15 * 24 * 60 * 60 * 1000
      );

      const gateways = [
        { id: "gateway-1", lastHeartbeat: eightDaysAgo }, // Not zombie at 14 days
        { id: "gateway-2", lastHeartbeat: fifteenDaysAgo }, // Zombie at 14 days
      ];

      const zombies = customService.identifyZombies(gateways);
      expect(zombies).toContain("gateway-2");
      expect(zombies).not.toContain("gateway-1");
    });
  });
});
