/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Feedback API Routes Tests
 *
 * Tests for:
 * - POST /api/feedback — Submit feedback
 * - GET /api/feedback — List feedback
 * - GET /api/feedback/summary — Aggregated summary
 * - GET /api/feedback/trends — Weekly trends
 * - GET /api/feedback/unrated — Tasks awaiting feedback
 * - GET /api/improvements — List improvements
 * - GET /api/improvements/[id] — Get single improvement
 * - PATCH /api/improvements/[id] — Update improvement status
 * - GET /api/preferences — List preferences
 * - PUT /api/preferences/[id] — Update preference
 * - DELETE /api/preferences/[id] — Delete preference
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/feedback", () => ({
  submitFeedback: vi.fn(),
  getFeedback: vi.fn(),
  getFeedbackSummary: vi.fn(),
  getFeedbackTrends: vi.fn(),
  getUnratedTasks: vi.fn(),
  getLearnedPreferences: vi.fn(),
  updatePreference: vi.fn(),
  deletePreference: vi.fn(),
  getImprovementActions: vi.fn(),
  getImprovementById: vi.fn(),
  approveImprovement: vi.fn(),
  applyImprovement: vi.fn(),
  rejectImprovement: vi.fn(),
}));

vi.mock("@/lib/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
  },
}));

import { authenticateRequest } from "@/lib/auth";
import * as feedbackLib from "@/lib/feedback";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

// Route handlers
import { GET as listFeedback, POST as submitFeedback } from "../feedback/route";
import { GET as getSummary } from "../feedback/summary/route";
import { GET as getTrends } from "../feedback/trends/route";
import { GET as getUnrated } from "../feedback/unrated/route";
import { GET as listImprovements } from "../improvements/route";
import {
  GET as getImprovement,
  PATCH as patchImprovement,
} from "../improvements/[id]/route";
import { GET as listPreferences } from "../preferences/route";
import {
  PUT as updatePreference,
  DELETE as deletePreference,
} from "../preferences/[id]/route";

const mockAuth = vi.mocked(authenticateRequest);
const mockSubmitFeedback = vi.mocked(feedbackLib.submitFeedback);
const mockGetFeedback = vi.mocked(feedbackLib.getFeedback);
const mockGetFeedbackSummary = vi.mocked(feedbackLib.getFeedbackSummary);
const mockGetFeedbackTrends = vi.mocked(feedbackLib.getFeedbackTrends);
const mockGetUnratedTasks = vi.mocked(feedbackLib.getUnratedTasks);
const mockGetLearnedPreferences = vi.mocked(feedbackLib.getLearnedPreferences);
const mockUpdatePreference = vi.mocked(feedbackLib.updatePreference);
const mockDeletePreference = vi.mocked(feedbackLib.deletePreference);
const mockGetImprovementActions = vi.mocked(feedbackLib.getImprovementActions);
const mockGetImprovementById = vi.mocked(feedbackLib.getImprovementById);
const mockApproveImprovement = vi.mocked(feedbackLib.approveImprovement);
const mockApplyImprovement = vi.mocked(feedbackLib.applyImprovement);
const mockRejectImprovement = vi.mocked(feedbackLib.rejectImprovement);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

describe("Feedback API Routes", () => {
  const makeRequest = (url: string, init?: RequestInit) =>
    new NextRequest(url, init);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── POST /api/feedback ──────────────────────────────────────────

  describe("POST /api/feedback", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuth.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "a", overallRating: 3 }),
      });

      const response = await submitFeedback(request);
      expect(response.status).toBe(401);
    });

    it("유효한 피드백 제출 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockSubmitFeedback.mockResolvedValueOnce({
        id: "fb-1",
        ratedBy: "user",
        overallRating: 4,
        categories: {},
        tags: [],
        agentId: "agent-1",
        createdAt: "2025-01-01",
      });

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "agent-1", overallRating: 4 }),
      });

      const response = await submitFeedback(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.feedback.id).toBe("fb-1");
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "feedback:submitted",
        data: { feedback: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("agentId 누락 시 400 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ overallRating: 3 }),
      });

      const response = await submitFeedback(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("agentId");
    });

    it("overallRating 범위 초과 시 400 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "a", overallRating: 6 }),
      });

      const response = await submitFeedback(request);
      expect(response.status).toBe(400);
    });

    it("overallRating 0 시 400 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "a", overallRating: 0 }),
      });

      const response = await submitFeedback(request);
      expect(response.status).toBe(400);
    });

    it("overallRating 소수점 시 400 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "a", overallRating: 3.5 }),
      });

      const response = await submitFeedback(request);
      expect(response.status).toBe(400);
    });

    it("DB 오류 시 500 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockSubmitFeedback.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/feedback", {
        method: "POST",
        body: JSON.stringify({ agentId: "a", overallRating: 3 }),
      });

      const response = await submitFeedback(request);
      expect(response.status).toBe(500);
    });
  });

  // ─── GET /api/feedback ───────────────────────────────────────────

  describe("GET /api/feedback", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuth.mockResolvedValueOnce(false);

      const response = await listFeedback(makeRequest("http://localhost/api/feedback"));
      expect(response.status).toBe(401);
    });

    it("피드백 목록 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetFeedback.mockResolvedValueOnce([
        {
          id: "fb-1",
          ratedBy: "user",
          overallRating: 4,
          categories: {},
          tags: [],
          agentId: "agent-1",
          createdAt: "2025-01-01",
        },
      ]);

      const response = await listFeedback(makeRequest("http://localhost/api/feedback"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.feedback).toHaveLength(1);
    });

    it("agentId 필터 적용", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetFeedback.mockResolvedValueOnce([]);

      await listFeedback(
        makeRequest("http://localhost/api/feedback?agentId=agent-1&limit=10&offset=5")
      );

      expect(mockGetFeedback).toHaveBeenCalledWith({
        agentId: "agent-1",
        limit: 10,
        offset: 5,
      });
    });
  });

  // ─── GET /api/feedback/summary ───────────────────────────────────

  describe("GET /api/feedback/summary", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuth.mockResolvedValueOnce(false);

      const response = await getSummary(
        makeRequest("http://localhost/api/feedback/summary")
      );
      expect(response.status).toBe(401);
    });

    it("요약 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetFeedbackSummary.mockResolvedValueOnce({
        totalCount: 10,
        avgRating: 4.2,
        avgAccuracy: null,
        avgCompleteness: null,
        avgSpeed: null,
        avgStyle: null,
        avgUsefulness: null,
        positiveCount: 7,
        negativeCount: 1,
      });

      const response = await getSummary(
        makeRequest("http://localhost/api/feedback/summary?agentId=agent-1&days=7")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.summary.totalCount).toBe(10);
      expect(mockGetFeedbackSummary).toHaveBeenCalledWith({
        agentId: "agent-1",
        days: 7,
      });
    });
  });

  // ─── GET /api/feedback/trends ────────────────────────────────────

  describe("GET /api/feedback/trends", () => {
    it("트렌드 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetFeedbackTrends.mockResolvedValueOnce([
        { week: "2025-01-06", count: 5, avgRating: 4.0 },
      ]);

      const response = await getTrends(
        makeRequest("http://localhost/api/feedback/trends?weeks=4")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.trends).toHaveLength(1);
    });
  });

  // ─── GET /api/feedback/unrated ───────────────────────────────────

  describe("GET /api/feedback/unrated", () => {
    it("미평가 태스크 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetUnratedTasks.mockResolvedValueOnce([
        { id: "task-1", agent_id: "a", action: "test", status: "completed" },
      ]);

      const response = await getUnrated(
        makeRequest("http://localhost/api/feedback/unrated?limit=5")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(1);
      expect(mockGetUnratedTasks).toHaveBeenCalledWith(5);
    });
  });

  // ─── GET /api/improvements ──────────────────────────────────────

  describe("GET /api/improvements", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuth.mockResolvedValueOnce(false);

      const response = await listImprovements(
        makeRequest("http://localhost/api/improvements")
      );
      expect(response.status).toBe(401);
    });

    it("개선 액션 목록 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetImprovementActions.mockResolvedValueOnce([
        {
          id: "imp-1",
          feedbackIds: [],
          actionType: "config",
          description: "test",
          status: "proposed",
          createdAt: "2025-01-01",
        },
      ]);

      const response = await listImprovements(
        makeRequest("http://localhost/api/improvements?status=proposed")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.actions).toHaveLength(1);
    });
  });

  // ─── GET /api/improvements/[id] ─────────────────────────────────

  describe("GET /api/improvements/[id]", () => {
    it("개선 액션 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetImprovementById.mockResolvedValueOnce({
        id: "imp-1",
        feedbackIds: [],
        actionType: "config",
        description: "test",
        status: "proposed",
        createdAt: "2025-01-01",
      });

      const response = await getImprovement(
        makeRequest("http://localhost/api/improvements/imp-1"),
        { params: Promise.resolve({ id: "imp-1" }) }
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.action.id).toBe("imp-1");
    });

    it("존재하지 않는 개선 액션은 404 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetImprovementById.mockResolvedValueOnce(null);

      const response = await getImprovement(
        makeRequest("http://localhost/api/improvements/nonexistent"),
        { params: Promise.resolve({ id: "nonexistent" }) }
      );
      expect(response.status).toBe(404);
    });
  });

  // ─── PATCH /api/improvements/[id] ───────────────────────────────

  describe("PATCH /api/improvements/[id]", () => {
    it("approve 액션 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockApproveImprovement.mockResolvedValueOnce({
        id: "imp-1",
        feedbackIds: [],
        actionType: "config",
        description: "test",
        status: "approved",
        approvedBy: "admin",
        createdAt: "2025-01-01",
      });

      const request = makeRequest("http://localhost/api/improvements/imp-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", approvedBy: "admin" }),
      });

      const response = await patchImprovement(request, {
        params: Promise.resolve({ id: "imp-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.action.status).toBe("approved");
    });

    it("apply 액션 성공 및 SSE broadcast", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockApplyImprovement.mockResolvedValueOnce({
        id: "imp-1",
        feedbackIds: [],
        actionType: "config",
        description: "test",
        status: "applied",
        createdAt: "2025-01-01",
      });

      const request = makeRequest("http://localhost/api/improvements/imp-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "apply" }),
      });

      const response = await patchImprovement(request, {
        params: Promise.resolve({ id: "imp-1" }),
      });

      expect(response.status).toBe(200);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "improvement:applied",
        data: { action: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("잘못된 action 값은 400 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/improvements/imp-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "invalid" }),
      });

      const response = await patchImprovement(request, {
        params: Promise.resolve({ id: "imp-1" }),
      });
      expect(response.status).toBe(400);
    });

    it("reject 액션 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockRejectImprovement.mockResolvedValueOnce({
        id: "imp-1",
        feedbackIds: [],
        actionType: "config",
        description: "test",
        status: "rejected",
        createdAt: "2025-01-01",
      });

      const request = makeRequest("http://localhost/api/improvements/imp-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "reject" }),
      });

      const response = await patchImprovement(request, {
        params: Promise.resolve({ id: "imp-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.action.status).toBe("rejected");
    });

    it("존재하지 않는 개선 액션은 404 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockApproveImprovement.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/improvements/imp-1", {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      });

      const response = await patchImprovement(request, {
        params: Promise.resolve({ id: "imp-1" }),
      });
      expect(response.status).toBe(404);
    });
  });

  // ─── GET /api/preferences ──────────────────────────────────────

  describe("GET /api/preferences", () => {
    it("선호도 목록 조회 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockGetLearnedPreferences.mockResolvedValueOnce([
        {
          id: "pref-1",
          scope: "global",
          preferenceKey: "style",
          preferenceValue: { verbose: true },
          derivedFrom: [],
          confidence: 0.8,
          status: "active",
          createdAt: "2025-01-01",
          updatedAt: "2025-01-01",
        },
      ]);

      const response = await listPreferences(
        makeRequest("http://localhost/api/preferences?scope=global")
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.preferences).toHaveLength(1);
    });
  });

  // ─── PUT /api/preferences/[id] ──────────────────────────────────

  describe("PUT /api/preferences/[id]", () => {
    it("선호도 업데이트 성공 및 SSE broadcast", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockUpdatePreference.mockResolvedValueOnce({
        id: "pref-1",
        scope: "global",
        preferenceKey: "style",
        preferenceValue: { verbose: false },
        derivedFrom: [],
        confidence: 0.9,
        status: "active",
        createdAt: "2025-01-01",
        updatedAt: "2025-01-02",
      });

      const request = makeRequest("http://localhost/api/preferences/pref-1", {
        method: "PUT",
        body: JSON.stringify({ confidence: 0.9 }),
      });

      const response = await updatePreference(request, {
        params: Promise.resolve({ id: "pref-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "preferences:updated",
        data: { preference: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 선호도는 404 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockUpdatePreference.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/preferences/nonexistent", {
        method: "PUT",
        body: JSON.stringify({ confidence: 0.5 }),
      });

      const response = await updatePreference(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      expect(response.status).toBe(404);
    });
  });

  // ─── DELETE /api/preferences/[id] ───────────────────────────────

  describe("DELETE /api/preferences/[id]", () => {
    it("선호도 삭제 성공", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockDeletePreference.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/preferences/pref-1", {
        method: "DELETE",
      });

      const response = await deletePreference(request, {
        params: Promise.resolve({ id: "pref-1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("존재하지 않는 선호도 삭제 시 404 반환", async () => {
      mockAuth.mockResolvedValueOnce(true);
      mockDeletePreference.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/preferences/nonexistent", {
        method: "DELETE",
      });

      const response = await deletePreference(request, {
        params: Promise.resolve({ id: "nonexistent" }),
      });
      expect(response.status).toBe(404);
    });
  });
});
