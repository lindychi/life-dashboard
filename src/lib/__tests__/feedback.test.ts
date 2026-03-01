/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Feedback Library Tests
 *
 * Tests for:
 * - submitFeedback — Insert feedback record
 * - getFeedback — List with filters
 * - getFeedbackSummary — Aggregate stats
 * - getFeedbackTrends — Weekly time-series
 * - getUnratedTasks — Tasks without feedback
 * - getLearnedPreferences — List active preferences
 * - updatePreference — Update preference fields
 * - deletePreference — Soft-delete preference
 * - getImprovementActions — List improvements
 * - getImprovementById — Get single improvement
 * - approveImprovement — Approve improvement
 * - applyImprovement — Apply improvement
 * - rejectImprovement — Reject improvement
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

import { query, queryOne } from "@/lib/db";
import {
  submitFeedback,
  getFeedback,
  getFeedbackSummary,
  getFeedbackTrends,
  getUnratedTasks,
  getLearnedPreferences,
  updatePreference,
  deletePreference,
  getImprovementActions,
  getImprovementById,
  approveImprovement,
  applyImprovement,
  rejectImprovement,
} from "../feedback";

const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);

describe("Feedback Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── submitFeedback ──────────────────────────────────────────────

  describe("submitFeedback", () => {
    it("should insert feedback and return mapped result", async () => {
      const dbRow = {
        id: "fb-1",
        task_execution_id: "exec-1",
        command_id: null,
        history_entry_id: null,
        rated_by: "user",
        overall_rating: 4,
        categories: { accuracy: 5, speed: 3 },
        comment: "Good work",
        tags: ["fast"],
        agent_id: "agent-1",
        task_type: "code",
        model_used: "sonnet",
        task_category: "development",
        created_at: "2025-01-01T00:00:00Z",
      };

      mockQueryOne.mockResolvedValueOnce(dbRow);

      const result = await submitFeedback({
        taskExecutionId: "exec-1",
        overallRating: 4,
        categories: { accuracy: 5, speed: 3 },
        comment: "Good work",
        tags: ["fast"],
        agentId: "agent-1",
        taskType: "code",
        modelUsed: "sonnet",
        taskCategory: "development",
      });

      expect(result.id).toBe("fb-1");
      expect(result.overallRating).toBe(4);
      expect(result.agentId).toBe("agent-1");
      expect(result.categories).toEqual({ accuracy: 5, speed: 3 });
      expect(result.taskExecutionId).toBe("exec-1");
      expect(result.comment).toBe("Good work");
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
    });

    it("should throw if insert returns null", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(
        submitFeedback({ overallRating: 3, agentId: "agent-1" })
      ).rejects.toThrow("Failed to submit feedback");
    });

    it("should use default values for optional fields", async () => {
      const dbRow = {
        id: "fb-2",
        task_execution_id: null,
        command_id: null,
        history_entry_id: null,
        rated_by: "user",
        overall_rating: 3,
        categories: {},
        comment: null,
        tags: [],
        agent_id: "agent-1",
        task_type: null,
        model_used: null,
        task_category: null,
        created_at: "2025-01-01T00:00:00Z",
      };

      mockQueryOne.mockResolvedValueOnce(dbRow);

      const result = await submitFeedback({
        overallRating: 3,
        agentId: "agent-1",
      });

      expect(result.ratedBy).toBe("user");
      expect(result.taskExecutionId).toBeUndefined();
      expect(result.comment).toBeUndefined();
      expect(result.tags).toEqual([]);
    });
  });

  // ─── getFeedback ─────────────────────────────────────────────────

  describe("getFeedback", () => {
    it("should return mapped feedback list", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: "fb-1",
          task_execution_id: null,
          command_id: null,
          history_entry_id: null,
          rated_by: "user",
          overall_rating: 5,
          categories: {},
          comment: null,
          tags: [],
          agent_id: "agent-1",
          task_type: null,
          model_used: null,
          task_category: null,
          created_at: "2025-01-01T00:00:00Z",
        },
      ]);

      const result = await getFeedback();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("fb-1");
      expect(result[0].overallRating).toBe(5);
    });

    it("should pass agentId filter", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getFeedback({ agentId: "agent-1" });

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("agent_id = $1");
      expect(mockQuery.mock.calls[0][1]).toContain("agent-1");
    });

    it("should apply limit and offset defaults", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getFeedback();

      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toContain(50); // default limit
      expect(params).toContain(0);  // default offset
    });

    it("should return empty array when no feedback found", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getFeedback({ agentId: "nonexistent" });
      expect(result).toEqual([]);
    });
  });

  // ─── getFeedbackSummary ──────────────────────────────────────────

  describe("getFeedbackSummary", () => {
    it("should return parsed summary", async () => {
      mockQueryOne.mockResolvedValueOnce({
        total_count: "10",
        avg_rating: "4.2",
        avg_accuracy: "4.5",
        avg_completeness: "3.8",
        avg_speed: null,
        avg_style: null,
        avg_usefulness: "4.0",
        positive_count: "7",
        negative_count: "1",
      });

      const result = await getFeedbackSummary({ days: 30 });

      expect(result.totalCount).toBe(10);
      expect(result.avgRating).toBe(4.2);
      expect(result.avgAccuracy).toBe(4.5);
      expect(result.avgCompleteness).toBe(3.8);
      expect(result.avgSpeed).toBeNull();
      expect(result.avgStyle).toBeNull();
      expect(result.avgUsefulness).toBe(4.0);
      expect(result.positiveCount).toBe(7);
      expect(result.negativeCount).toBe(1);
    });

    it("should return zeroed summary when no data", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getFeedbackSummary();

      expect(result.totalCount).toBe(0);
      expect(result.avgRating).toBe(0);
      expect(result.positiveCount).toBe(0);
    });

    it("should pass agentId filter", async () => {
      mockQueryOne.mockResolvedValueOnce({
        total_count: "0",
        avg_rating: null,
        avg_accuracy: null,
        avg_completeness: null,
        avg_speed: null,
        avg_style: null,
        avg_usefulness: null,
        positive_count: "0",
        negative_count: "0",
      });

      await getFeedbackSummary({ agentId: "agent-1" });

      const sql = mockQueryOne.mock.calls[0][0] as string;
      expect(sql).toContain("agent_id = $1");
    });
  });

  // ─── getFeedbackTrends ──────────────────────────────────────────

  describe("getFeedbackTrends", () => {
    it("should return parsed trends", async () => {
      mockQuery.mockResolvedValueOnce([
        { week: "2025-01-06", count: "5", avg_rating: "4.0" },
        { week: "2025-01-13", count: "3", avg_rating: "3.5" },
      ]);

      const result = await getFeedbackTrends({ weeks: 4 });

      expect(result).toHaveLength(2);
      expect(result[0].week).toBe("2025-01-06");
      expect(result[0].count).toBe(5);
      expect(result[0].avgRating).toBe(4.0);
    });

    it("should return empty array when no data", async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getFeedbackTrends();
      expect(result).toEqual([]);
    });
  });

  // ─── getUnratedTasks ────────────────────────────────────────────

  describe("getUnratedTasks", () => {
    it("should return tasks without feedback", async () => {
      mockQuery.mockResolvedValueOnce([
        { id: "task-1", agent_id: "agent-1", action: "test", status: "completed", created_at: "2025-01-01" },
      ]);

      const result = await getUnratedTasks(10);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("task-1");
      expect(mockQuery.mock.calls[0][1]).toEqual([10]);
    });

    it("should use default limit of 20", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getUnratedTasks();

      expect(mockQuery.mock.calls[0][1]).toEqual([20]);
    });
  });

  // ─── getLearnedPreferences ──────────────────────────────────────

  describe("getLearnedPreferences", () => {
    it("should return mapped preferences", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: "pref-1",
          scope: "agent:agent-1",
          preference_key: "model_selection",
          preference_value: { preferred: "sonnet" },
          derived_from: ["fb-1"],
          confidence: 0.8,
          status: "active",
          created_at: "2025-01-01",
          updated_at: "2025-01-01",
        },
      ]);

      const result = await getLearnedPreferences();

      expect(result).toHaveLength(1);
      expect(result[0].preferenceKey).toBe("model_selection");
      expect(result[0].confidence).toBe(0.8);
    });

    it("should filter by scope", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getLearnedPreferences("global");

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("scope = $1");
      expect(mockQuery.mock.calls[0][1]).toContain("global");
    });
  });

  // ─── updatePreference ───────────────────────────────────────────

  describe("updatePreference", () => {
    it("should update and return mapped preference", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "pref-1",
        scope: "global",
        preference_key: "style",
        preference_value: { verbose: true },
        derived_from: [],
        confidence: 0.9,
        status: "active",
        created_at: "2025-01-01",
        updated_at: "2025-01-02",
      });

      const result = await updatePreference("pref-1", {
        confidence: 0.9,
      });

      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(0.9);
    });

    it("should return null when not found", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await updatePreference("nonexistent", {
        confidence: 0.5,
      });

      expect(result).toBeNull();
    });
  });

  // ─── deletePreference ───────────────────────────────────────────

  describe("deletePreference", () => {
    it("should return true on successful soft-delete", async () => {
      mockQueryOne.mockResolvedValueOnce({ id: "pref-1" });

      const result = await deletePreference("pref-1");
      expect(result).toBe(true);
    });

    it("should return false when not found", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await deletePreference("nonexistent");
      expect(result).toBe(false);
    });
  });

  // ─── getImprovementActions ──────────────────────────────────────

  describe("getImprovementActions", () => {
    it("should return mapped improvements", async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: "imp-1",
          report_id: null,
          feedback_ids: ["fb-1"],
          action_type: "prompt_update",
          description: "Update system prompt",
          before_value: { prompt: "old" },
          after_value: { prompt: "new" },
          status: "proposed",
          approved_by: null,
          approved_at: null,
          applied_at: null,
          impact_metrics: null,
          created_at: "2025-01-01",
        },
      ]);

      const result = await getImprovementActions();

      expect(result).toHaveLength(1);
      expect(result[0].actionType).toBe("prompt_update");
      expect(result[0].feedbackIds).toEqual(["fb-1"]);
    });

    it("should filter by status", async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getImprovementActions("approved");

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("status = $1");
      expect(mockQuery.mock.calls[0][1]).toContain("approved");
    });
  });

  // ─── getImprovementById ─────────────────────────────────────────

  describe("getImprovementById", () => {
    it("should return mapped improvement", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "imp-1",
        report_id: null,
        feedback_ids: [],
        action_type: "config_change",
        description: "Change config",
        before_value: null,
        after_value: null,
        status: "proposed",
        approved_by: null,
        approved_at: null,
        applied_at: null,
        impact_metrics: null,
        created_at: "2025-01-01",
      });

      const result = await getImprovementById("imp-1");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("imp-1");
    });

    it("should return null when not found", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getImprovementById("nonexistent");
      expect(result).toBeNull();
    });
  });

  // ─── approveImprovement ─────────────────────────────────────────

  describe("approveImprovement", () => {
    it("should approve and return mapped result", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "imp-1",
        report_id: null,
        feedback_ids: [],
        action_type: "config_change",
        description: "Change config",
        before_value: null,
        after_value: null,
        status: "approved",
        approved_by: "admin",
        approved_at: "2025-01-02",
        applied_at: null,
        impact_metrics: null,
        created_at: "2025-01-01",
      });

      const result = await approveImprovement("imp-1", "admin");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("approved");
      expect(result!.approvedBy).toBe("admin");
    });

    it("should return null when not in proposed status", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await approveImprovement("imp-1");
      expect(result).toBeNull();
    });
  });

  // ─── applyImprovement ──────────────────────────────────────────

  describe("applyImprovement", () => {
    it("should apply and return mapped result", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "imp-1",
        report_id: null,
        feedback_ids: [],
        action_type: "config_change",
        description: "Change config",
        before_value: null,
        after_value: null,
        status: "applied",
        approved_by: "admin",
        approved_at: "2025-01-02",
        applied_at: "2025-01-03",
        impact_metrics: null,
        created_at: "2025-01-01",
      });

      const result = await applyImprovement("imp-1");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("applied");
      expect(result!.appliedAt).toBe("2025-01-03");
    });

    it("should return null when not in approved status", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await applyImprovement("imp-1");
      expect(result).toBeNull();
    });
  });

  // ─── rejectImprovement ──────────────────────────────────────────

  describe("rejectImprovement", () => {
    it("should reject and return mapped result", async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: "imp-1",
        report_id: null,
        feedback_ids: [],
        action_type: "config_change",
        description: "Change config",
        before_value: null,
        after_value: null,
        status: "rejected",
        approved_by: null,
        approved_at: null,
        applied_at: null,
        impact_metrics: null,
        created_at: "2025-01-01",
      });

      const result = await rejectImprovement("imp-1");

      expect(result).not.toBeNull();
      expect(result!.status).toBe("rejected");
    });

    it("should return null when not in proposed/approved status", async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await rejectImprovement("imp-already-applied");
      expect(result).toBeNull();
    });
  });
});
