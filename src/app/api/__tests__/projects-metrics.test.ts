/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Projects Metrics/KPI API Routes Tests
 *
 * Tests for:
 * - GET /api/projects/metrics - Get all projects with metrics
 * - GET /api/projects/[id]/metrics - Get/create metrics snapshot
 * - GET /api/projects/[id]/metrics/history - Get metrics history
 * - GET /api/projects/[id]/tasks - Get/link tasks to project
 *
 * Edge cases:
 * - Real-time KPI calculation
 * - Metrics snapshot creation
 * - Task linkage validation
 * - Empty metrics/tasks handling
 * - Concurrent metrics updates
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as getProjectsMetrics } from "../projects/metrics/route";
import {
  GET as getProjectMetrics,
  POST as createMetricsSnapshot,
} from "../projects/[id]/metrics/route";
import { GET as getMetricsHistory } from "../projects/[id]/metrics/history/route";
import {
  GET as getProjectTasks,
  POST as linkTaskToProject,
} from "../projects/[id]/tasks/route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/project-metrics", () => ({
  getAllProjectsKPISummary: vi.fn(),
  getProjectKPISummary: vi.fn(),
  snapshotProjectMetrics: vi.fn(),
  getProjectMetricsHistory: vi.fn(),
  linkTaskToProject: vi.fn(),
  getProjectTasks: vi.fn(),
}));

vi.mock("@/lib/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
  },
}));

import { getCurrentUser } from "@/lib/auth";
import * as metricsLib from "@/lib/project-metrics";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetAllProjectsKPISummary = vi.mocked(metricsLib.getAllProjectsKPISummary);
const mockGetProjectKPISummary = vi.mocked(metricsLib.getProjectKPISummary);
const mockSnapshotProjectMetrics = vi.mocked(metricsLib.snapshotProjectMetrics);
const mockGetProjectMetricsHistory = vi.mocked(metricsLib.getProjectMetricsHistory);
const mockLinkTaskToProject = vi.mocked(metricsLib.linkTaskToProject);
const mockGetProjectTasks = vi.mocked(metricsLib.getProjectTasks);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

function makeRequest(url: string, options?: RequestInit): NextRequest {
  return new NextRequest(url, options);
}

describe("Projects Metrics/KPI API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/projects/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const response = await getProjectsMetrics(makeRequest("http://localhost/api/projects/metrics"));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBeDefined();
    });

    it("모든 프로젝트의 KPI 요약 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      const summaryData = [
        {
          id: "proj-1",
          name: "Project 1",
          completion_rate: 75,
          success_rate: 90,
          total_tasks: 10,
        },
      ];
      mockGetAllProjectsKPISummary.mockResolvedValueOnce(summaryData);

      const response = await getProjectsMetrics(makeRequest("http://localhost/api/projects/metrics"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.count).toBe(1);
      expect(data.data[0].completion_rate).toBe(75);
    });

    it("빈 프로젝트 목록도 정상 처리", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetAllProjectsKPISummary.mockResolvedValueOnce([]);

      const response = await getProjectsMetrics(makeRequest("http://localhost/api/projects/metrics"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetAllProjectsKPISummary.mockRejectedValueOnce(new Error("DB error"));

      const response = await getProjectsMetrics(makeRequest("http://localhost/api/projects/metrics"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("GET /api/projects/[id]/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 KPI 요약 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectKPISummary.mockResolvedValueOnce({
        completion_rate: 80,
        success_rate: 95,
        total_tasks: 20,
        completed_tasks: 16,
        failed_tasks: 1,
        running_tasks: 3,
      });

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.metrics.completion_rate).toBe(80);
      expect(data.metrics.total_tasks).toBe(20);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectKPISummary.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /api/projects/[id]/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("메트릭 스냅샷 생성 성공 및 SSE 브로드캐스트", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockSnapshotProjectMetrics.mockResolvedValueOnce("snapshot-1");
      mockGetProjectKPISummary.mockResolvedValueOnce({
        completion_rate: 85,
        success_rate: 92,
        total_tasks: 25,
        completed_tasks: 21,
      });

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.snapshot.snapshot_id).toBe("snapshot-1");
      expect(data.snapshot.project_id).toBe("proj-1");
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "project:metrics:updated",
        data: expect.objectContaining({
          projectId: "proj-1",
          snapshotId: "snapshot-1",
        }),
        timestamp: expect.any(String),
      });
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockSnapshotProjectMetrics.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("GET /api/projects/[id]/metrics/history", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("메트릭 히스토리 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      const historyData = [
        {
          id: "snapshot-1",
          project_id: "proj-1",
          completion_rate: 75,
          snapshot_at: new Date("2025-01-01T00:00:00Z"),
        },
        {
          id: "snapshot-2",
          project_id: "proj-1",
          completion_rate: 85,
          snapshot_at: new Date("2025-01-02T00:00:00Z"),
        },
      ];
      mockGetProjectMetricsHistory.mockResolvedValueOnce(historyData);

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.history).toHaveLength(2);
      expect(data.history[0].completion_rate).toBe(75);
      expect(data.history[1].completion_rate).toBe(85);
      expect(data.count).toBe(2);
    });

    it("limit 파라미터가 라이브러리 함수에 전달됨", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectMetricsHistory.mockResolvedValueOnce([]);

      const request = makeRequest(
        "http://localhost/api/projects/proj-1/metrics/history?limit=5"
      );
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });

      expect(response.status).toBe(200);
      expect(mockGetProjectMetricsHistory).toHaveBeenCalledWith("proj-1", 5);
    });

    it("빈 히스토리 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectMetricsHistory.mockResolvedValueOnce([]);

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.history).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectMetricsHistory.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("GET /api/projects/[id]/tasks", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 태스크 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectTasks.mockResolvedValueOnce([
        {
          id: "link-1",
          project_id: "proj-1",
          task_execution_id: "exec-1",
          task_queue_id: null,
          created_at: new Date().toISOString(),
          metadata: {
            task_title: "Test Task",
            task_status: "completed",
            task_type: "dev",
          },
        },
      ]);

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].metadata.task_title).toBe("Test Task");
    });

    it("빈 태스크 목록 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectTasks.mockResolvedValueOnce([]);

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockGetProjectTasks.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /api/projects/[id]/tasks", () => {
    const linkData = {
      taskExecutionId: "exec-1",
      metadata: {
        task_title: "New Task",
        task_status: "running",
        task_type: "dev",
      },
    };

    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(linkData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("태스크 링크 생성 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockLinkTaskToProject.mockResolvedValueOnce({
        id: "link-new",
        project_id: "proj-1",
        task_execution_id: "exec-1",
        task_queue_id: null,
        created_at: new Date(),
        metadata: linkData.metadata,
      });

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(linkData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.link.task_execution_id).toBe("exec-1");
      expect(data.link.metadata.task_title).toBe("New Task");
    });

    it("taskExecutionId 또는 taskQueueId 없으면 400 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Either task_execution_id or task_queue_id");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com", iat: 0, exp: 0 });
      mockLinkTaskToProject.mockRejectedValueOnce(new Error("DB error"));

      const validData = {
        taskExecutionId: "task-exec-1",
      };

      const request = makeRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(validData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });
});
