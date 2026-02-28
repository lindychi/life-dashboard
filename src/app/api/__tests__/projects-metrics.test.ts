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
  getAllProjectsWithMetrics: vi.fn(),
  getProjectMetrics: vi.fn(),
  createMetricsSnapshot: vi.fn(),
  getMetricsHistory: vi.fn(),
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
const mockGetAllProjectsWithMetrics = vi.mocked(metricsLib.getAllProjectsWithMetrics);
const mockGetProjectMetrics = vi.mocked(metricsLib.getProjectMetrics);
const mockCreateMetricsSnapshot = vi.mocked(metricsLib.createMetricsSnapshot);
const mockGetMetricsHistory = vi.mocked(metricsLib.getMetricsHistory);
const mockLinkTaskToProject = vi.mocked(metricsLib.linkTaskToProject);
const mockGetProjectTasks = vi.mocked(metricsLib.getProjectTasks);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

describe("Projects Metrics/KPI API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/projects/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const response = await getProjectsMetrics();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("모든 프로젝트의 메트릭 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetAllProjectsWithMetrics.mockResolvedValueOnce([
        {
          id: "proj-1",
          name: "Project 1",
          description: "Description",
          status: "active",
          progress: 75,
          url: null,
          kpis: [],
          created_at: new Date(),
          updated_at: new Date(),
          metrics: {
            completion_rate: 75,
            success_rate: 90,
            total_tasks: 10,
            completed_tasks: 7,
            failed_tasks: 1,
            running_tasks: 2,
            avg_task_duration_seconds: 120,
          },
        },
      ]);

      const response = await getProjectsMetrics();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].metrics.completion_rate).toBe(75);
      expect(data.projects[0].metrics.success_rate).toBe(90);
    });

    it("메트릭이 없는 프로젝트도 정상 처리", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetAllProjectsWithMetrics.mockResolvedValueOnce([
        {
          id: "proj-new",
          name: "New Project",
          description: "No tasks yet",
          status: "active",
          progress: 0,
          url: null,
          kpis: [],
          created_at: new Date(),
          updated_at: new Date(),
          metrics: {
            completion_rate: 0,
            success_rate: 0,
            total_tasks: 0,
            completed_tasks: 0,
            failed_tasks: 0,
            running_tasks: 0,
            avg_task_duration_seconds: 0,
          },
        },
      ]);

      const response = await getProjectsMetrics();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.projects[0].metrics.total_tasks).toBe(0);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetAllProjectsWithMetrics.mockRejectedValueOnce(new Error("DB error"));

      const response = await getProjectsMetrics();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("메트릭 조회에 실패했습니다");
    });
  });

  describe("GET /api/projects/[id]/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 메트릭 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectMetrics.mockResolvedValueOnce({
        completion_rate: 80,
        success_rate: 95,
        total_tasks: 20,
        completed_tasks: 16,
        failed_tasks: 1,
        running_tasks: 3,
        avg_task_duration_seconds: 150,
      });

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.metrics.completion_rate).toBe(80);
      expect(data.metrics.total_tasks).toBe(20);
    });

    it("존재하지 않는 프로젝트는 404 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectMetrics.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/invalid-id/metrics");
      const response = await getProjectMetrics(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("프로젝트를 찾을 수 없습니다");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectMetrics.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics");
      const response = await getProjectMetrics(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("메트릭 조회에 실패했습니다");
    });
  });

  describe("POST /api/projects/[id]/metrics", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("메트릭 스냅샷 생성 성공 및 SSE 브로드캐스트", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      const snapshotData = {
        id: "snapshot-1",
        project_id: "proj-1",
        completion_rate: 85,
        success_rate: 92,
        total_tasks: 25,
        completed_tasks: 21,
        failed_tasks: 2,
        running_tasks: 2,
        avg_task_duration_seconds: 180,
        snapshot_at: new Date(),
      };
      mockCreateMetricsSnapshot.mockResolvedValueOnce(snapshotData);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.snapshot.completion_rate).toBe(85);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "project:metrics:updated",
        data: {
          projectId: "proj-1",
          metrics: expect.objectContaining({
            completion_rate: 85,
            success_rate: 92,
          }),
        },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 프로젝트는 404 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockCreateMetricsSnapshot.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/invalid-id/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("프로젝트를 찾을 수 없습니다");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockCreateMetricsSnapshot.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics", {
        method: "POST",
      });

      const response = await createMetricsSnapshot(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("메트릭 스냅샷 생성에 실패했습니다");
    });
  });

  describe("GET /api/projects/[id]/metrics/history", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("메트릭 히스토리 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetMetricsHistory.mockResolvedValueOnce([
        {
          id: "snapshot-1",
          project_id: "proj-1",
          completion_rate: 75,
          success_rate: 90,
          total_tasks: 10,
          completed_tasks: 7,
          failed_tasks: 1,
          running_tasks: 2,
          avg_task_duration_seconds: 120,
          snapshot_at: new Date("2025-01-01T00:00:00Z"),
        },
        {
          id: "snapshot-2",
          project_id: "proj-1",
          completion_rate: 85,
          success_rate: 92,
          total_tasks: 15,
          completed_tasks: 12,
          failed_tasks: 1,
          running_tasks: 2,
          avg_task_duration_seconds: 150,
          snapshot_at: new Date("2025-01-02T00:00:00Z"),
        },
      ]);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.history).toHaveLength(2);
      expect(data.history[0].completion_rate).toBe(75);
      expect(data.history[1].completion_rate).toBe(85);
    });

    it("limit 파라미터 적용", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetMetricsHistory.mockResolvedValueOnce([
        {
          id: "snapshot-1",
          project_id: "proj-1",
          completion_rate: 85,
          success_rate: 92,
          total_tasks: 15,
          completed_tasks: 12,
          failed_tasks: 1,
          running_tasks: 2,
          avg_task_duration_seconds: 150,
          snapshot_at: new Date(),
        },
      ]);

      const request = new NextRequest(
        "http://localhost/api/projects/proj-1/metrics/history?limit=1"
      );
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.history).toHaveLength(1);
      expect(mockGetMetricsHistory).toHaveBeenCalledWith("proj-1", 1);
    });

    it("빈 히스토리 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetMetricsHistory.mockResolvedValueOnce([]);

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.history).toEqual([]);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetMetricsHistory.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/projects/proj-1/metrics/history");
      const response = await getMetricsHistory(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("히스토리 조회에 실패했습니다");
    });
  });

  describe("GET /api/projects/[id]/tasks", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 태스크 조회 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectTasks.mockResolvedValueOnce([
        {
          id: "link-1",
          project_id: "proj-1",
          task_execution_id: "exec-1",
          task_queue_id: null,
          created_at: new Date(),
          metadata: {
            task_title: "Test Task",
            task_status: "completed",
            task_type: "dev",
          },
        },
      ]);

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].metadata.task_title).toBe("Test Task");
    });

    it("빈 태스크 목록 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectTasks.mockResolvedValueOnce([]);

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tasks).toEqual([]);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockGetProjectTasks.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks");
      const response = await getProjectTasks(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
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

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(linkData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("태스크 링크 생성 성공", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockLinkTaskToProject.mockResolvedValueOnce({
        id: "link-new",
        project_id: "proj-1",
        task_execution_id: "exec-1",
        task_queue_id: null,
        created_at: new Date(),
        metadata: linkData.metadata,
      });

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(linkData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.link.task_execution_id).toBe("exec-1");
      expect(data.link.metadata.task_title).toBe("New Task");
    });

    it("필수 필드 누락 시 400 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Either task_execution_id or task_queue_id");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetCurrentUser.mockResolvedValueOnce({ email: "test@example.com" });
      mockLinkTaskToProject.mockRejectedValueOnce(new Error("DB error"));

      const validData = {
        taskExecutionId: "task-exec-1",
      };

      const request = new NextRequest("http://localhost/api/projects/proj-1/tasks", {
        method: "POST",
        body: JSON.stringify(validData),
      });

      const response = await linkTaskToProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
    });
  });
});
