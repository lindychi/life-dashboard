/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
/**
 * Projects CRUD API Routes Tests
 *
 * Tests for:
 * - GET /api/projects - List all projects
 * - POST /api/projects - Create new project
 * - GET /api/projects/[id] - Get single project
 * - PATCH /api/projects/[id] - Update project
 * - DELETE /api/projects/[id] - Delete project
 *
 * Edge cases:
 * - Authentication errors (401)
 * - Validation errors (400)
 * - Not found errors (404)
 * - Database errors (500)
 * - Invalid input types
 * - Boundary values (progress 0-100, empty strings, long strings)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as listProjects, POST as createProject } from "../projects/route";
import {
  GET as getProject,
  PUT as updateProject,
  DELETE as deleteProject,
} from "../projects/[id]/route";
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

vi.mock("@/lib/projects", () => ({
  getProjects: vi.fn(),
  getProjectById: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("@/lib/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
  },
}));

import { authenticateRequest } from "@/lib/auth";
import * as projectsLib from "@/lib/projects";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

const mockAuthenticateRequest = vi.mocked(authenticateRequest);
const mockGetProjects = vi.mocked(projectsLib.getProjects);
const mockGetProjectById = vi.mocked(projectsLib.getProjectById);
const mockCreateProject = vi.mocked(projectsLib.createProject);
const mockUpdateProject = vi.mocked(projectsLib.updateProject);
const mockDeleteProject = vi.mocked(projectsLib.deleteProject);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

describe("Projects CRUD API Routes", () => {
  const makeRequest = (url: string, init?: RequestInit) =>
    new NextRequest(url, init);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/projects", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(false);

      const response = await listProjects(makeRequest("http://localhost/api/projects"));
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
      expect(mockGetProjects).not.toHaveBeenCalled();
    });

    it("프로젝트 목록 조회 성공", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjects.mockResolvedValueOnce([
        {
          id: "proj-1",
          name: "Project 1",
          description: "Description 1",
          status: "active",
          progress: 50,
          url: "https://example.com",
          kpis: [],
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const response = await listProjects(makeRequest("http://localhost/api/projects"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].id).toBe("proj-1");
    });

    it("빈 프로젝트 목록 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjects.mockResolvedValueOnce([]);

      const response = await listProjects(makeRequest("http://localhost/api/projects"));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.projects).toEqual([]);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjects.mockRejectedValueOnce(new Error("DB connection failed"));

      const response = await listProjects(makeRequest("http://localhost/api/projects"));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("프로젝트 조회에 실패했습니다");
    });
  });

  describe("POST /api/projects", () => {
    const validProjectData = {
      name: "New Project",
      description: "Project description",
      status: "active",
      progress: 0,
      url: "https://example.com",
      kpis: [],
    };

    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(validProjectData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("유효한 데이터로 프로젝트 생성 성공", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockCreateProject.mockResolvedValueOnce({
        id: "proj-new",
        ...validProjectData,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(validProjectData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.project.name).toBe("New Project");
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "project:created",
        data: { project: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("필수 필드 누락 시 400 반환 - name 없음", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, name: "" };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("필수 필드가 누락되었습니다");
    });

    it("필수 필드 누락 시 400 반환 - description 없음", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, description: "" };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("필수 필드가 누락되었습니다");
    });

    it("progress 범위 초과 시 400 반환 - 음수", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, progress: -1 };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("progress는 0에서 100 사이의 숫자여야 합니다");
    });

    it("progress 범위 초과 시 400 반환 - 100 초과", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, progress: 101 };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("progress는 0에서 100 사이의 숫자여야 합니다");
    });

    it("progress가 NaN일 때 400 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, progress: "invalid" };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("progress는 0에서 100 사이의 숫자여야 합니다");
    });

    it("kpis가 배열이 아닐 때 400 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const invalidData = { ...validProjectData, kpis: "not-an-array" };
      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("kpis는 배열이어야 합니다");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockCreateProject.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(validProjectData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("프로젝트 생성에 실패했습니다");
    });

    it("경계값 테스트 - progress 0", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockCreateProject.mockResolvedValueOnce({
        id: "proj-new",
        ...validProjectData,
        progress: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ ...validProjectData, progress: 0 }),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.project.progress).toBe(0);
    });

    it("경계값 테스트 - progress 100", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockCreateProject.mockResolvedValueOnce({
        id: "proj-new",
        ...validProjectData,
        progress: 100,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({ ...validProjectData, progress: 100 }),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.project.progress).toBe(100);
    });

    it("선택적 필드 없이도 생성 가능", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockCreateProject.mockResolvedValueOnce({
        id: "proj-minimal",
        name: "Minimal",
        description: "Minimal project",
        status: "active",
        progress: 0,
        url: null,
        kpis: [],
        created_at: new Date(),
        updated_at: new Date(),
      });

      const minimalData = {
        name: "Minimal",
        description: "Minimal project",
      };

      const request = makeRequest("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify(minimalData),
      });

      const response = await createProject(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.project.name).toBe("Minimal");
    });
  });

  describe("GET /api/projects/[id]", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/projects/proj-1");
      const response = await getProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 조회 성공", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjectById.mockResolvedValueOnce({
        id: "proj-1",
        name: "Project 1",
        description: "Description",
        status: "active",
        progress: 75,
        url: "https://example.com",
        kpis: [],
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects/proj-1");
      const response = await getProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.project.id).toBe("proj-1");
      expect(data.project.name).toBe("Project 1");
    });

    it("존재하지 않는 프로젝트는 404 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjectById.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/invalid-id");
      const response = await getProject(request, { params: Promise.resolve({ id: "invalid-id" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("프로젝트를 찾을 수 없습니다");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockGetProjectById.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1");
      const response = await getProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("프로젝트 조회에 실패했습니다");
    });
  });

  // Route exports PUT (not PATCH)
  describe("PUT /api/projects/[id]", () => {
    const updateData = {
      name: "Updated Project",
      progress: 80,
    };

    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 업데이트 성공", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockUpdateProject.mockResolvedValueOnce({
        id: "proj-1",
        name: "Updated Project",
        description: "Description",
        status: "active",
        progress: 80,
        url: null,
        kpis: [],
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.project.name).toBe("Updated Project");
      expect(data.project.progress).toBe(80);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "project:updated",
        data: { project: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 프로젝트 업데이트 시 404 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockUpdateProject.mockResolvedValueOnce(null);

      const request = makeRequest("http://localhost/api/projects/invalid-id", {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "invalid-id" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("프로젝트를 찾을 수 없습니다");
    });

    it("progress 범위 초과 시 400 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "PUT",
        body: JSON.stringify({ progress: 150 }),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("progress는 0에서 100 사이의 숫자여야 합니다");
    });

    it("빈 객체로 업데이트 시에도 정상 처리", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockUpdateProject.mockResolvedValueOnce({
        id: "proj-1",
        name: "Existing Project",
        description: "Description",
        status: "active",
        progress: 50,
        url: null,
        kpis: [],
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "PUT",
        body: JSON.stringify({}),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.project).toBeDefined();
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockUpdateProject.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      const response = await updateProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("프로젝트 업데이트에 실패했습니다");
    });
  });

  describe("DELETE /api/projects/[id]", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "DELETE",
      });

      const response = await deleteProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("인증이 필요합니다");
    });

    it("프로젝트 삭제 성공", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockDeleteProject.mockResolvedValueOnce(true);

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "DELETE",
      });

      const response = await deleteProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "project:deleted",
        data: { projectId: "proj-1" },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 프로젝트 삭제 시 404 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockDeleteProject.mockResolvedValueOnce(false);

      const request = makeRequest("http://localhost/api/projects/invalid-id", {
        method: "DELETE",
      });

      const response = await deleteProject(request, { params: Promise.resolve({ id: "invalid-id" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("프로젝트를 찾을 수 없습니다");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockAuthenticateRequest.mockResolvedValueOnce(true);
      mockDeleteProject.mockRejectedValueOnce(new Error("DB error"));

      const request = makeRequest("http://localhost/api/projects/proj-1", {
        method: "DELETE",
      });

      const response = await deleteProject(request, { params: Promise.resolve({ id: "proj-1" }) });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("프로젝트 삭제에 실패했습니다");
    });
  });
});
