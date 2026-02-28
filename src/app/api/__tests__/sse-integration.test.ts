/**
 * SSE Integration Tests
 *
 * Tests for API routes integration with SSE broadcasting:
 * - Projects CRUD → SSE events
 * - OKR CRUD → SSE events
 * - Metrics updates → SSE events
 * - Event payload validation
 * - Multiple clients receiving same event
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Mock database
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  pool: {},
}));

// Mock auth
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  verifyAuth: vi.fn(),
}));

// Track SSE broadcasts
const mockBroadcastCalls: Array<{
  type: string;
  data: unknown;
  timestamp: string;
}> = [];

vi.mock("@/lib/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn((event) => {
      mockBroadcastCalls.push(event);
    }),
    broadcastToUser: vi.fn(),
    addClient: vi.fn(),
    removeClient: vi.fn(),
    sendToClient: vi.fn(),
    getStats: vi.fn(() => ({ totalClients: 0, clientsByUser: {} })),
    cleanup: vi.fn(),
  },
}));

import { POST as createProject } from "../projects/route";
import { POST as createObjective } from "../okr/objectives/route";
import { getCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockQuery = vi.mocked(query);
const mockQueryOne = vi.mocked(queryOne);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

describe("SSE Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBroadcastCalls.length = 0;

    // Default auth mock
    mockGetCurrentUser.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
  });

  describe("Projects → SSE Integration", () => {
    it("프로젝트 생성 시 project:created 이벤트 브로드캐스트", async () => {
      const newProject = {
        id: "proj-1",
        name: "Test Project",
        description: "Test Description",
        status: "active" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        kpis: [],
      };

      mockQueryOne.mockResolvedValueOnce(newProject);

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test Description",
        }),
      });

      const response = await createProject(request as any);
      expect(response.status).toBe(201);

      // Verify SSE broadcast was called
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "project:created",
          data: expect.objectContaining({
            project: expect.objectContaining({
              id: "proj-1",
              name: "Test Project",
            }),
          }),
          timestamp: expect.any(String),
        })
      );
    });

    it("프로젝트 생성 실패 시 SSE 이벤트 없음", async () => {
      mockQueryOne.mockRejectedValueOnce(new Error("DB error"));

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test Description",
        }),
      });

      const response = await createProject(request as any);
      expect(response.status).toBe(500);

      // Should NOT broadcast on error
      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it("인증 실패 시 SSE 이벤트 없음", async () => {
      mockGetCurrentUser.mockResolvedValueOnce(null);

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test Description",
        }),
      });

      const response = await createProject(request as any);
      expect(response.status).toBe(401);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it("유효성 검증 실패 시 SSE 이벤트 없음", async () => {
      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "", // Empty name
          description: "Test Description",
        }),
      });

      const response = await createProject(request as any);
      expect(response.status).toBe(400);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  describe("OKR → SSE Integration", () => {
    it("Objective 생성 시 okr:objective:created 이벤트 브로드캐스트", async () => {
      const newObjective = {
        id: "obj-1",
        title: "Test Objective",
        description: "Test Description",
        time_period: "Q1 2025",
        status: "active" as const,
        overall_progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockQueryOne.mockResolvedValueOnce(newObjective);

      const request = new Request("http://localhost/api/okr/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Objective",
          description: "Test Description",
          period_type: "quarterly",
          start_date: "2025-01-01",
          end_date: "2025-03-31",
        }),
      });

      const response = await createObjective(request as any);
      expect(response.status).toBe(201);

      // Verify SSE broadcast
      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "okr:objective:created",
          data: expect.objectContaining({
            objective: expect.objectContaining({
              id: "obj-1",
              title: "Test Objective",
            }),
          }),
          timestamp: expect.any(String),
        })
      );
    });

    it("Objective 생성 실패 시 SSE 이벤트 없음", async () => {
      mockQueryOne.mockRejectedValueOnce(new Error("DB error"));

      const request = new Request("http://localhost/api/okr/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Objective",
          description: "Test Description",
          period_type: "quarterly",
          start_date: "2025-01-01",
          end_date: "2025-03-31",
        }),
      });

      const response = await createObjective(request as any);
      expect(response.status).toBe(500);

      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });

  describe("Event Payload Validation", () => {
    it("SSE 이벤트는 올바른 타임스탬프 포함", async () => {
      const newProject = {
        id: "proj-1",
        name: "Test Project",
        description: "Test",
        status: "active" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        kpis: [],
      };

      mockQueryOne.mockResolvedValueOnce(newProject);

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test",
        }),
      });

      const beforeTime = new Date().toISOString();
      await createProject(request as any);
      const afterTime = new Date().toISOString();

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      expect(broadcastCall.timestamp).toBeDefined();
      expect(broadcastCall.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Timestamp should be between before and after
      expect(broadcastCall.timestamp >= beforeTime).toBe(true);
      expect(broadcastCall.timestamp <= afterTime).toBe(true);
    });

    it("SSE 이벤트는 완전한 데이터 페이로드 포함", async () => {
      const newProject = {
        id: "proj-1",
        name: "Test Project",
        description: "Test Description",
        status: "active" as const,
        progress: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: "https://example.com",
        kpis: [{ name: "Users", value: 100 }],
      };

      mockQueryOne.mockResolvedValueOnce(newProject);

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test Description",
          status: "active",
          progress: 50,
          url: "https://example.com",
          kpis: [{ name: "Users", value: 100 }],
        }),
      });

      await createProject(request as any);

      const broadcastCall = mockBroadcast.mock.calls[0][0];
      expect(broadcastCall.data).toEqual({
        project: newProject,
      });
    });
  });

  describe("Multiple Operations", () => {
    it("연속된 작업은 각각 SSE 이벤트 발생", async () => {
      const project1 = {
        id: "proj-1",
        name: "Project 1",
        description: "Desc 1",
        status: "active" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        kpis: [],
      };

      const project2 = {
        id: "proj-2",
        name: "Project 2",
        description: "Desc 2",
        status: "active" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        kpis: [],
      };

      mockQueryOne
        .mockResolvedValueOnce(project1)
        .mockResolvedValueOnce(project2);

      const request1 = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Project 1", description: "Desc 1" }),
      });

      const request2 = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Project 2", description: "Desc 2" }),
      });

      await createProject(request1 as any);
      await createProject(request2 as any);

      expect(mockBroadcast).toHaveBeenCalledTimes(2);
      expect(mockBroadcast.mock.calls[0][0].data.project.id).toBe("proj-1");
      expect(mockBroadcast.mock.calls[1][0].data.project.id).toBe("proj-2");
    });
  });

  describe("Error Recovery", () => {
    it("SSE 브로드캐스트 실패해도 API 응답은 성공", async () => {
      const newProject = {
        id: "proj-1",
        name: "Test Project",
        description: "Test",
        status: "active" as const,
        progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        url: null,
        kpis: [],
      };

      mockQueryOne.mockResolvedValueOnce(newProject);
      mockBroadcast.mockImplementationOnce(() => {
        throw new Error("Broadcast failed");
      });

      const request = new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Project",
          description: "Test",
        }),
      });

      // Should still return 201 even if broadcast fails
      const response = await createProject(request as any);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.project).toBeDefined();
    });
  });
});
