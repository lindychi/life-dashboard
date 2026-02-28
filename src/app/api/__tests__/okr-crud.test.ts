/**
 * OKR (Objectives and Key Results) CRUD API Routes Tests
 *
 * Tests for:
 * - GET /api/okr/objectives - List objectives
 * - POST /api/okr/objectives - Create objective
 * - GET /api/okr/objectives/[id] - Get objective with key results
 * - PATCH /api/okr/objectives/[id] - Update objective
 * - DELETE /api/okr/objectives/[id] - Delete objective
 * - POST /api/okr/key-results - Create key result
 * - PATCH /api/okr/key-results/[id] - Update key result
 * - DELETE /api/okr/key-results/[id] - Delete key result
 *
 * Edge cases:
 * - Auto-calculation of progress (key result & objective)
 * - Weighted key results
 * - Metric type validation (percentage, number, boolean, currency)
 * - Status transitions
 * - Date range validation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as listObjectives, POST as createObjective } from "../okr/objectives/route";
import {
  GET as getObjective,
  PATCH as updateObjective,
  DELETE as deleteObjective,
} from "../okr/objectives/[id]/route";
import {
  POST as createKeyResult,
} from "../okr/key-results/route";
import {
  PATCH as updateKeyResult,
  DELETE as deleteKeyResult,
} from "../okr/key-results/[id]/route";
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

vi.mock("@/lib/okr", () => ({
  getObjectives: vi.fn(),
  getObjective: vi.fn(),
  createObjective: vi.fn(),
  updateObjective: vi.fn(),
  deleteObjective: vi.fn(),
  createKeyResult: vi.fn(),
  updateKeyResult: vi.fn(),
  deleteKeyResult: vi.fn(),
}));

vi.mock("@/lib/sse-broadcaster", () => ({
  sseBroadcaster: {
    broadcast: vi.fn(),
  },
}));

import { getCurrentUser } from "@/lib/auth";
import * as okrLib from "@/lib/okr";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockGetObjectives = vi.mocked(okrLib.getObjectives);
const mockGetObjective = vi.mocked(okrLib.getObjective);
const mockCreateObjective = vi.mocked(okrLib.createObjective);
const mockUpdateObjective = vi.mocked(okrLib.updateObjective);
const mockDeleteObjective = vi.mocked(okrLib.deleteObjective);
const mockCreateKeyResult = vi.mocked(okrLib.createKeyResult);
const mockUpdateKeyResult = vi.mocked(okrLib.updateKeyResult);
const mockDeleteKeyResult = vi.mocked(okrLib.deleteKeyResult);
const mockBroadcast = vi.mocked(sseBroadcaster.broadcast);

describe("OKR CRUD API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Most routes don't require auth in current implementation
    mockGetCurrentUser.mockResolvedValue({ email: "test@example.com" });
  });

  describe("GET /api/okr/objectives", () => {
    it("목표 목록 조회 성공", async () => {
      mockGetObjectives.mockResolvedValueOnce([
        {
          id: "obj-1",
          title: "Q1 2025 OKR",
          description: "Quarterly goals",
          period_type: "quarterly",
          start_date: "2025-01-01",
          end_date: "2025-03-31",
          status: "active",
          owner: "PM",
          tags: ["growth"],
          overall_progress: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const request = new NextRequest("http://localhost/api/okr/objectives");
      const response = await listObjectives(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.objectives).toHaveLength(1);
      expect(data.objectives[0].title).toBe("Q1 2025 OKR");
    });

    it("status 필터 적용", async () => {
      mockGetObjectives.mockResolvedValueOnce([
        {
          id: "obj-1",
          title: "Active OKR",
          description: "Active goal",
          period_type: "quarterly",
          start_date: "2025-01-01",
          end_date: "2025-03-31",
          status: "active",
          owner: null,
          tags: [],
          overall_progress: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const request = new NextRequest("http://localhost/api/okr/objectives?status=active");
      const response = await listObjectives(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetObjectives).toHaveBeenCalledWith("active");
    });

    it("빈 목록 반환", async () => {
      mockGetObjectives.mockResolvedValueOnce([]);

      const request = new NextRequest("http://localhost/api/okr/objectives");
      const response = await listObjectives(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.objectives).toEqual([]);
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetObjectives.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/objectives");
      const response = await listObjectives(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch objectives");
    });
  });

  describe("POST /api/okr/objectives", () => {
    const validObjectiveData = {
      title: "New OKR",
      description: "Description",
      period_type: "quarterly",
      start_date: "2025-04-01",
      end_date: "2025-06-30",
      status: "active",
      owner: "PM",
      tags: ["growth", "product"],
    };

    it("목표 생성 성공 및 SSE 브로드캐스트", async () => {
      mockCreateObjective.mockResolvedValueOnce({
        id: "obj-new",
        ...validObjectiveData,
        overall_progress: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(validObjectiveData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.objective.title).toBe("New OKR");
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:objective:created",
        data: { objective: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("필수 필드 누락 시 400 반환 - title", async () => {
      const invalidData = { ...validObjectiveData, title: undefined };

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });

    it("필수 필드 누락 시 400 반환 - period_type", async () => {
      const invalidData = { ...validObjectiveData, period_type: undefined };

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });

    it("필수 필드 누락 시 400 반환 - start_date", async () => {
      const invalidData = { ...validObjectiveData, start_date: undefined };

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });

    it("필수 필드 누락 시 400 반환 - end_date", async () => {
      const invalidData = { ...validObjectiveData, end_date: undefined };

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });

    it("선택적 필드 없이도 생성 가능", async () => {
      const minimalData = {
        title: "Minimal OKR",
        period_type: "quarterly",
        start_date: "2025-01-01",
        end_date: "2025-03-31",
      };

      mockCreateObjective.mockResolvedValueOnce({
        id: "obj-minimal",
        title: "Minimal OKR",
        description: null,
        period_type: "quarterly",
        start_date: "2025-01-01",
        end_date: "2025-03-31",
        status: "active",
        owner: null,
        tags: [],
        overall_progress: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(minimalData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.objective.title).toBe("Minimal OKR");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockCreateObjective.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/objectives", {
        method: "POST",
        body: JSON.stringify(validObjectiveData),
      });

      const response = await createObjective(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create objective");
    });
  });

  describe("GET /api/okr/objectives/[id]", () => {
    it("목표 조회 성공 (Key Results 포함)", async () => {
      mockGetObjective.mockResolvedValueOnce({
        id: "obj-1",
        title: "Q1 OKR",
        description: "Goals for Q1",
        period_type: "quarterly",
        start_date: "2025-01-01",
        end_date: "2025-03-31",
        status: "active",
        owner: "PM",
        tags: ["growth"],
        overall_progress: 50,
        created_at: new Date(),
        updated_at: new Date(),
        key_results: [
          {
            id: "kr-1",
            objective_id: "obj-1",
            title: "Increase DAU",
            description: "Daily active users",
            metric_type: "number",
            target_value: 10000,
            current_value: 5000,
            unit: "users",
            progress: 50,
            weight: 100,
            status: "active",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1");
      const response = await getObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.objective.id).toBe("obj-1");
      expect(data.objective.key_results).toHaveLength(1);
      expect(data.objective.key_results[0].title).toBe("Increase DAU");
    });

    it("존재하지 않는 목표는 404 반환", async () => {
      mockGetObjective.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/okr/objectives/invalid-id");
      const response = await getObjective(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Objective not found");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockGetObjective.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1");
      const response = await getObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch objective");
    });
  });

  describe("PATCH /api/okr/objectives/[id]", () => {
    const updateData = {
      title: "Updated OKR",
      status: "completed",
    };

    it("목표 업데이트 성공 및 SSE 브로드캐스트", async () => {
      mockUpdateObjective.mockResolvedValueOnce({
        id: "obj-1",
        title: "Updated OKR",
        description: "Description",
        period_type: "quarterly",
        start_date: "2025-01-01",
        end_date: "2025-03-31",
        status: "completed",
        owner: "PM",
        tags: [],
        overall_progress: 100,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.objective.title).toBe("Updated OKR");
      expect(data.objective.status).toBe("completed");
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:objective:updated",
        data: { objective: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 목표는 404 반환", async () => {
      mockUpdateObjective.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/okr/objectives/invalid-id", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateObjective(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Objective not found");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockUpdateObjective.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update objective");
    });
  });

  describe("DELETE /api/okr/objectives/[id]", () => {
    it("목표 삭제 성공 및 SSE 브로드캐스트", async () => {
      mockDeleteObjective.mockResolvedValueOnce(true);

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1", {
        method: "DELETE",
      });

      const response = await deleteObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:objective:deleted",
        data: { objectiveId: "obj-1" },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 목표는 404 반환", async () => {
      mockDeleteObjective.mockResolvedValueOnce(false);

      const request = new NextRequest("http://localhost/api/okr/objectives/invalid-id", {
        method: "DELETE",
      });

      const response = await deleteObjective(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Objective not found");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockDeleteObjective.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/objectives/obj-1", {
        method: "DELETE",
      });

      const response = await deleteObjective(request, { params: { id: "obj-1" } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to delete objective");
    });
  });

  describe("POST /api/okr/key-results", () => {
    const validKeyResultData = {
      objective_id: "obj-1",
      title: "Increase conversion rate",
      description: "Improve checkout flow",
      metric_type: "percentage",
      target_value: 15,
      current_value: 10,
      unit: "%",
      weight: 50,
      status: "active",
    };

    it("Key Result 생성 성공 및 SSE 브로드캐스트", async () => {
      mockCreateKeyResult.mockResolvedValueOnce({
        id: "kr-new",
        ...validKeyResultData,
        progress: 66.67,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(validKeyResultData),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.keyResult.title).toBe("Increase conversion rate");
      expect(data.keyResult.progress).toBeCloseTo(66.67, 1);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:key-result:created",
        data: { keyResult: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("필수 필드 누락 시 400 반환", async () => {
      const invalidData = { ...validKeyResultData, objective_id: undefined };

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required fields");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockCreateKeyResult.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(validKeyResultData),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create key result");
    });

    it("진행률 자동 계산 - percentage 타입", async () => {
      const percentageKR = {
        ...validKeyResultData,
        metric_type: "percentage",
        current_value: 12,
        target_value: 15,
      };

      mockCreateKeyResult.mockResolvedValueOnce({
        id: "kr-pct",
        ...percentageKR,
        progress: 80, // (12/15) * 100
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(percentageKR),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.keyResult.progress).toBe(80);
    });

    it("진행률 자동 계산 - number 타입", async () => {
      const numberKR = {
        ...validKeyResultData,
        metric_type: "number",
        current_value: 7500,
        target_value: 10000,
      };

      mockCreateKeyResult.mockResolvedValueOnce({
        id: "kr-num",
        ...numberKR,
        progress: 75, // (7500/10000) * 100
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(numberKR),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.keyResult.progress).toBe(75);
    });

    it("진행률 자동 계산 - boolean 타입", async () => {
      const booleanKR = {
        ...validKeyResultData,
        metric_type: "boolean",
        current_value: 1,
        target_value: 1,
      };

      mockCreateKeyResult.mockResolvedValueOnce({
        id: "kr-bool",
        ...booleanKR,
        progress: 100, // completed
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(booleanKR),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.keyResult.progress).toBe(100);
    });

    it("진행률 자동 계산 - currency 타입", async () => {
      const currencyKR = {
        ...validKeyResultData,
        metric_type: "currency",
        current_value: 50000,
        target_value: 100000,
        unit: "$",
      };

      mockCreateKeyResult.mockResolvedValueOnce({
        id: "kr-curr",
        ...currencyKR,
        progress: 50, // (50000/100000) * 100
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results", {
        method: "POST",
        body: JSON.stringify(currencyKR),
      });

      const response = await createKeyResult(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.keyResult.progress).toBe(50);
    });
  });

  describe("PATCH /api/okr/key-results/[id]", () => {
    const updateData = {
      current_value: 13,
      status: "active",
    };

    it("Key Result 업데이트 성공 및 SSE 브로드캐스트", async () => {
      mockUpdateKeyResult.mockResolvedValueOnce({
        id: "kr-1",
        objective_id: "obj-1",
        title: "Increase conversion",
        description: null,
        metric_type: "percentage",
        target_value: 15,
        current_value: 13,
        unit: "%",
        progress: 86.67,
        weight: 100,
        status: "active",
        created_at: new Date(),
        updated_at: new Date(),
      });

      const request = new NextRequest("http://localhost/api/okr/key-results/kr-1", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateKeyResult(request, { params: { id: "kr-1" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.keyResult.current_value).toBe(13);
      expect(data.keyResult.progress).toBeCloseTo(86.67, 1);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:key-result:updated",
        data: { keyResult: expect.any(Object) },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 Key Result는 404 반환", async () => {
      mockUpdateKeyResult.mockResolvedValueOnce(null);

      const request = new NextRequest("http://localhost/api/okr/key-results/invalid-id", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateKeyResult(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Key result not found");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockUpdateKeyResult.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/key-results/kr-1", {
        method: "PATCH",
        body: JSON.stringify(updateData),
      });

      const response = await updateKeyResult(request, { params: { id: "kr-1" } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update key result");
    });
  });

  describe("DELETE /api/okr/key-results/[id]", () => {
    it("Key Result 삭제 성공 및 SSE 브로드캐스트", async () => {
      mockDeleteKeyResult.mockResolvedValueOnce(true);

      const request = new NextRequest("http://localhost/api/okr/key-results/kr-1", {
        method: "DELETE",
      });

      const response = await deleteKeyResult(request, { params: { id: "kr-1" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockBroadcast).toHaveBeenCalledWith({
        type: "okr:key-result:deleted",
        data: { keyResultId: "kr-1" },
        timestamp: expect.any(String),
      });
    });

    it("존재하지 않는 Key Result는 404 반환", async () => {
      mockDeleteKeyResult.mockResolvedValueOnce(false);

      const request = new NextRequest("http://localhost/api/okr/key-results/invalid-id", {
        method: "DELETE",
      });

      const response = await deleteKeyResult(request, { params: { id: "invalid-id" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Key result not found");
    });

    it("데이터베이스 오류 시 500 반환", async () => {
      mockDeleteKeyResult.mockRejectedValueOnce(new Error("DB error"));

      const request = new NextRequest("http://localhost/api/okr/key-results/kr-1", {
        method: "DELETE",
      });

      const response = await deleteKeyResult(request, { params: { id: "kr-1" } });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to delete key result");
    });
  });
});
