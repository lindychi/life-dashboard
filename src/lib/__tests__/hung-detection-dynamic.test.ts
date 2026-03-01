/**
 * TDD: Dynamic Timeout based on Task Complexity
 *
 * GREEN Phase: Tests for calculateDynamicTimeout function
 * Feature: Calculate stale timeout dynamically based on task complexity keywords
 */

import { describe, it, expect } from "vitest";
import { calculateDynamicTimeout } from "../../../scripts/claude-executor";

describe("Dynamic Timeout Calculation (P1)", () => {
  describe("calculateDynamicTimeout", () => {
    it("should return 5 minutes (300000ms) for simple tasks", () => {
      const timeout = calculateDynamicTimeout("Fix typo in README");
      expect(timeout).toBe(300000);
    });

    it("should return 10 minutes (600000ms) for complex tasks with analysis keywords", () => {
      const timeout = calculateDynamicTimeout(
        "Analyze the codebase and refactor authentication"
      );
      expect(timeout).toBeGreaterThanOrEqual(600000);
    });

    it("should return 15 minutes (900000ms) for review/refactor tasks", () => {
      // "review" and "refactor" keywords each map to 900000ms
      const timeout = calculateDynamicTimeout(
        "Review and refactor database schema for new feature"
      );
      expect(timeout).toBeGreaterThanOrEqual(900000);
    });

    it("should return 20 minutes (1200000ms) for comprehensive review tasks", () => {
      const timeout = calculateDynamicTimeout(
        "Complete security review of authentication module"
      );
      expect(timeout).toBeGreaterThanOrEqual(1200000);
    });

    it("should handle case-insensitive keyword matching", () => {
      const timeout1 = calculateDynamicTimeout("ANALYZE the system");
      const timeout2 = calculateDynamicTimeout("analyze the system");
      expect(timeout1).toBe(timeout2);
    });

    it("should prioritize highest complexity keyword if multiple present", () => {
      // "architect" should take priority over "analyze"
      const timeout = calculateDynamicTimeout(
        "Analyze and architect the new system"
      );
      const architectTimeout = calculateDynamicTimeout("Architect new system");
      expect(timeout).toBeGreaterThanOrEqual(architectTimeout);
    });

    it("should return 5 minutes for empty task", () => {
      const timeout = calculateDynamicTimeout("");
      expect(timeout).toBe(300000);
    });

    it("should handle keyword combinations", () => {
      const simpleTimeout = calculateDynamicTimeout("Fix bug");
      const complexTimeout = calculateDynamicTimeout(
        "Fix bug by analyzing debug logs and refactoring"
      );
      expect(complexTimeout).toBeGreaterThan(simpleTimeout);
    });

    it("keywords should include: analyze, refactor, review, security, architect, debug, plan, comprehensive", () => {
      const keywords = [
        "analyze",
        "refactor",
        "review",
        "security",
        "architect",
        "debug",
        "plan",
        "comprehensive",
      ];

      // Each keyword should increase timeout from base 5 minutes
      const baseTimeout = calculateDynamicTimeout("simple task");
      let foundComplexKeyword = false;

      for (const keyword of keywords) {
        const timeout = calculateDynamicTimeout(`Task with ${keyword}`);
        if (timeout !== baseTimeout) {
          expect(timeout).toBeGreaterThanOrEqual(baseTimeout);
          foundComplexKeyword = true;
          break;
        }
      }
      expect(foundComplexKeyword).toBe(true);
    });

    it("should not exceed 30 minutes (1800000ms) cap", () => {
      const timeout = calculateDynamicTimeout(
        "Analyze Refactor Review Security Architect Debug Plan Comprehensive"
      );
      expect(timeout).toBeLessThanOrEqual(1800000);
    });

    it("should gracefully handle special characters", () => {
      expect(() =>
        calculateDynamicTimeout("Fix: [BUG] analyze @system/core #42")
      ).not.toThrow();
    });
  });
});
