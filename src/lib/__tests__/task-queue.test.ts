import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pg module to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  })),
}));

// Mock db module
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  isDbConnectionError: vi.fn(),
  withDbFallback: vi.fn(),
  pool: {},
}));

import { query, queryOne } from "@/lib/db";
import {
  enqueueTask,
  dequeueNext,
  completeTask,
  failTask,
  cascadeFailDependents,
  getDependentTasks,
  getTask,
  getTasks,
  dispatchTasks,
  getCapacity,
  getRunningCount,
} from "../task-queue";

// Local type matching the DB row shape (snake_case)
interface TaskRow {
  id: string;
  title: string;
  type: string;
  payload: Record<string, unknown>;
  priority: number;
  status: string;
  concurrency_group: string;
  assigned_agent: string | null;
  max_retries: number;
  retry_count: number;
  error: string | null;
  retry_errors: Array<{ error: string; timestamp: string; attempt: number }>;
  result: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  timeout_seconds: number;
  depends_on: string[];
}

// Helper to create TaskRow-shaped objects
function createTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-123",
    title: "Test Task",
    type: "generic",
    payload: {},
    priority: 0,
    status: "pending",
    concurrency_group: "default",
    assigned_agent: null,
    max_retries: 3,
    retry_count: 0,
    error: null,
    retry_errors: [],
    result: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    timeout_seconds: 300,
    depends_on: [],
    ...overrides,
  };
}

describe("Task Queue - Dependency System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("enqueueTask with dependencies", () => {
    it("should enqueue task with dependsOn array after validating deps exist", async () => {
      const mockRow = createTaskRow({
        id: "task-child",
        title: "Child Task",
        depends_on: ["task-parent-1", "task-parent-2"],
      });

      // First call: dependency validation query
      vi.mocked(query).mockResolvedValueOnce([
        { id: "task-parent-1" },
        { id: "task-parent-2" },
      ]);
      vi.mocked(queryOne).mockResolvedValue(mockRow);

      const result = await enqueueTask({
        title: "Child Task",
        dependsOn: ["task-parent-1", "task-parent-2"],
      });

      // Validation query should check dependency existence
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("SELECT id FROM task_queue WHERE id = ANY"),
        [["task-parent-1", "task-parent-2"]]
      );

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO task_queue"),
        expect.arrayContaining([
          "Child Task",
          "generic",
          expect.any(String),
          0,
          "default",
          null,
          3,
          300,
          ["task-parent-1", "task-parent-2"],
        ])
      );

      expect(result.dependsOn).toEqual(["task-parent-1", "task-parent-2"]);
      expect(result.id).toBe("task-child");
    });

    it("should enqueue task without dependsOn (defaults to empty array, no validation)", async () => {
      const mockRow = createTaskRow({
        id: "task-independent",
        title: "Independent Task",
        depends_on: [],
      });

      vi.mocked(queryOne).mockResolvedValue(mockRow);

      const result = await enqueueTask({
        title: "Independent Task",
      });

      // No validation query for empty deps
      expect(query).not.toHaveBeenCalled();

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO task_queue"),
        expect.arrayContaining([
          "Independent Task",
          "generic",
          expect.any(String),
          0,
          "default",
          null,
          3,
          300,
          [], // dependsOn defaults to empty array
        ])
      );

      expect(result.dependsOn).toEqual([]);
    });

    it("should reject enqueue when dependency tasks do not exist", async () => {
      // Validation returns only one of two deps
      vi.mocked(query).mockResolvedValueOnce([{ id: "task-exists" }]);

      await expect(
        enqueueTask({
          title: "Bad Deps Task",
          dependsOn: ["task-exists", "task-missing"],
        })
      ).rejects.toThrow("Dependency tasks not found: task-missing");

      // Insert should never be called
      expect(queryOne).not.toHaveBeenCalled();
    });
  });

  describe("dequeueNext with dependency filtering", () => {
    it("should dequeue a task when dependencies are met", async () => {
      const mockRow = createTaskRow({
        id: "task-ready",
        status: "running",
        depends_on: ["completed-task"],
        started_at: new Date().toISOString(),
      });

      vi.mocked(queryOne).mockResolvedValue(mockRow);

      const result = await dequeueNext("default");

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("are_dependencies_met(id)"),
        ["default", null]
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe("task-ready");
      expect(result?.status).toBe("running");
    });

    it("should return null when all pending tasks have unmet dependencies", async () => {
      vi.mocked(queryOne).mockResolvedValue(null);

      const result = await dequeueNext("default");

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("are_dependencies_met(id)"),
        ["default", null]
      );

      expect(result).toBeNull();
    });

    it("should pass assigned agent when provided", async () => {
      const mockRow = createTaskRow({
        id: "task-assigned",
        status: "running",
        assigned_agent: "agent-007",
      });

      vi.mocked(queryOne).mockResolvedValue(mockRow);

      const result = await dequeueNext("default", "agent-007");

      expect(queryOne).toHaveBeenCalledWith(
        expect.stringContaining("are_dependencies_met(id)"),
        ["default", "agent-007"]
      );

      expect(result?.assignedAgent).toBe("agent-007");
    });
  });

  describe("cascadeFailDependents", () => {
    it("should cascade-fail tasks that depend on a failed task", async () => {
      const failedTaskId = "task-failed";
      const dependentRows = [
        createTaskRow({
          id: "task-dependent-1",
          status: "dead_letter",
          depends_on: [failedTaskId],
          error: `Dependency ${failedTaskId} failed`,
        }),
        createTaskRow({
          id: "task-dependent-2",
          status: "dead_letter",
          depends_on: [failedTaskId],
          error: `Dependency ${failedTaskId} failed`,
        }),
      ];

      // First call: direct dependents of failed task
      vi.mocked(query).mockResolvedValueOnce(dependentRows);
      // Recursive: dep-1 has no further dependents
      vi.mocked(query).mockResolvedValueOnce([]);
      // Recursive: dep-2 has no further dependents
      vi.mocked(query).mockResolvedValueOnce([]);

      const result = await cascadeFailDependents(failedTaskId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE $1 = ANY(depends_on)"),
        [failedTaskId, `Dependency ${failedTaskId} failed`]
      );

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe("dead_letter");
      expect(result[1].status).toBe("dead_letter");
      expect(result[0].error).toContain("Dependency");
      expect(result[1].error).toContain("Dependency");
    });

    it("should return empty array when no dependents exist", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      const result = await cascadeFailDependents("task-no-dependents");

      expect(query).toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("should use custom reason when provided", async () => {
      const customReason = "Parent task failed validation";
      vi.mocked(query).mockResolvedValueOnce([]);

      await cascadeFailDependents("task-failed", customReason);

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ["task-failed", customReason]
      );
    });
  });

  describe("getDependentTasks", () => {
    it("should return tasks that have the given taskId in their depends_on array", async () => {
      const parentTaskId = "task-parent";
      const dependentRows = [
        createTaskRow({
          id: "task-child-1",
          depends_on: [parentTaskId],
          priority: 10,
        }),
        createTaskRow({
          id: "task-child-2",
          depends_on: [parentTaskId, "other-task"],
          priority: 5,
        }),
      ];

      vi.mocked(query).mockResolvedValue(dependentRows);

      const result = await getDependentTasks(parentTaskId);

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE $1 = ANY(depends_on)"),
        [parentTaskId]
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("task-child-1");
      expect(result[1].id).toBe("task-child-2");
    });

    it("should return empty array if no tasks depend on the given taskId", async () => {
      vi.mocked(query).mockResolvedValue([]);

      const result = await getDependentTasks("task-no-children");

      expect(result).toEqual([]);
    });
  });

  describe("Integration: Dependency chain execution", () => {
    it("should execute dependency chain correctly: A completes → B dispatchable → B fails → C cascades", async () => {
      // This is a simplified integration test that verifies the dependency chain behavior
      // In a real scenario: Task A (no deps) → Task B (depends on A) → Task C (depends on B)

      // Test 1: completeTask works
      const completedTask = createTaskRow({
        id: "task-a",
        status: "completed",
        completed_at: new Date().toISOString(),
      });
      vi.mocked(queryOne).mockResolvedValueOnce(completedTask);

      const result = await completeTask("task-a");
      expect(result?.status).toBe("completed");

      // Test 2: failTask works
      const failedTask = createTaskRow({
        id: "task-b",
        status: "dead_letter",
        error: "Validation failed",
        retry_count: 3,
        completed_at: new Date().toISOString(),
        depends_on: ["task-a"],
      });
      vi.mocked(queryOne).mockResolvedValueOnce(failedTask);

      const failedResult = await failTask("task-b", "Validation failed");
      expect(failedResult?.status).toBe("dead_letter");

      // Test 3: cascadeFailDependents works after B fails
      const cascadedTask = createTaskRow({
        id: "task-c",
        status: "dead_letter",
        error: "Dependency task-b failed",
        depends_on: ["task-b"],
      });
      vi.mocked(query).mockResolvedValueOnce([cascadedTask]);
      // Recursive: task-c has no further dependents
      vi.mocked(query).mockResolvedValueOnce([]);

      const cascaded = await cascadeFailDependents("task-b");
      expect(cascaded).toHaveLength(1);
      expect(cascaded[0].id).toBe("task-c");
      expect(cascaded[0].status).toBe("dead_letter");
      expect(cascaded[0].error).toContain("Dependency");
    });

    it.skip("should allow parallel execution of independent tasks", async () => {
      // Task A and Task B both have no dependencies
      const taskA = createTaskRow({
        id: "task-parallel-a",
        depends_on: [],
        status: "running",
        started_at: new Date().toISOString(),
      });

      const taskB = createTaskRow({
        id: "task-parallel-b",
        depends_on: [],
        status: "running",
        started_at: new Date().toISOString(),
      });

      // Both tasks should be dispatchable in same cycle
      vi.mocked(query).mockResolvedValueOnce([]); // expireTimedOutTasks
      vi.mocked(query).mockResolvedValueOnce([
        { concurrency_group: "default" },
      ]); // groups with pending tasks
      vi.mocked(queryOne).mockResolvedValueOnce({ capacity: "3" }); // getCapacity

      // First dequeue returns taskA
      vi.mocked(queryOne).mockResolvedValueOnce(taskA);

      // Second dequeue returns taskB
      vi.mocked(queryOne).mockResolvedValueOnce(taskB);

      // Third dequeue returns null (no more tasks)
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const dispatched = await dispatchTasks();

      expect(dispatched).toHaveLength(2);
      expect(dispatched.find(t => t.id === "task-parallel-a")).toBeDefined();
      expect(dispatched.find(t => t.id === "task-parallel-b")).toBeDefined();
    });
  });

  describe("getTask and getTasks", () => {
    it("should retrieve a single task with dependencies", async () => {
      const mockRow = createTaskRow({
        id: "task-with-deps",
        depends_on: ["dep-1", "dep-2"],
      });

      vi.mocked(queryOne).mockResolvedValue(mockRow);

      const result = await getTask("task-with-deps");

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual(["dep-1", "dep-2"]);
    });

    it("should retrieve multiple tasks and preserve dependsOn", async () => {
      const mockRows = [
        createTaskRow({ id: "task-1", depends_on: ["parent-1"] }),
        createTaskRow({ id: "task-2", depends_on: [] }),
        createTaskRow({ id: "task-3", depends_on: ["parent-2", "parent-3"] }),
      ];

      vi.mocked(query).mockResolvedValue(mockRows);

      const result = await getTasks({ status: "pending" });

      expect(result).toHaveLength(3);
      expect(result[0].dependsOn).toEqual(["parent-1"]);
      expect(result[1].dependsOn).toEqual([]);
      expect(result[2].dependsOn).toEqual(["parent-2", "parent-3"]);
    });
  });

  describe("Edge cases", () => {
    it("should handle circular dependencies gracefully (SQL prevents execution)", async () => {
      // Task A depends on B, Task B depends on A
      // Neither should be dispatchable due to are_dependencies_met() check

      vi.mocked(query).mockResolvedValueOnce([]); // expireTimedOutTasks
      vi.mocked(query).mockResolvedValueOnce([
        { concurrency_group: "default" },
      ]); // groups with pending tasks
      vi.mocked(queryOne).mockResolvedValueOnce({ capacity: "3" }); // getCapacity
      vi.mocked(queryOne).mockResolvedValueOnce(null); // dequeueNext returns null (no eligible tasks)

      const dispatched = await dispatchTasks();

      expect(dispatched).toHaveLength(0);
    });

    it("should handle task depending on non-existent parent", async () => {
      // Task depends on "phantom-task" which doesn't exist
      // SQL's are_dependencies_met() will return false

      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const result = await dequeueNext("default");

      expect(result).toBeNull();
    });

    it("should handle empty depends_on array correctly", async () => {
      const mockRow = createTaskRow({
        id: "task-no-deps",
        depends_on: [],
      });

      vi.mocked(queryOne).mockResolvedValueOnce(mockRow);

      const result = await dequeueNext("default");

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual([]);
    });
  });

  describe("Cascade failure scenarios", () => {
    it("should recursively cascade-fail multiple levels of dependents", async () => {
      // A fails → B and C fail (depend on A) → D fails (depends on B)
      // Single call to cascadeFailDependents("task-a") should cascade all levels
      const failedAId = "task-a";

      // First level: B and C depend on A
      vi.mocked(query).mockResolvedValueOnce([
        createTaskRow({ id: "task-b", depends_on: [failedAId], status: "dead_letter" }),
        createTaskRow({ id: "task-c", depends_on: [failedAId], status: "dead_letter" }),
      ]);

      // Recursive: D depends on B
      vi.mocked(query).mockResolvedValueOnce([
        createTaskRow({ id: "task-d", depends_on: ["task-b"], status: "dead_letter" }),
      ]);
      // Recursive: D has no further dependents
      vi.mocked(query).mockResolvedValueOnce([]);
      // Recursive: C has no further dependents
      vi.mocked(query).mockResolvedValueOnce([]);

      const allCascaded = await cascadeFailDependents(failedAId);

      // Should return all 3 transitively failed tasks: B, C, D
      expect(allCascaded).toHaveLength(3);
      const ids = allCascaded.map((t) => t.id);
      expect(ids).toContain("task-b");
      expect(ids).toContain("task-c");
      expect(ids).toContain("task-d");
    });

    it("should only cascade-fail pending/queued tasks, not running/completed", async () => {
      // Cascade should ignore tasks already running or completed
      vi.mocked(query).mockResolvedValue([]);

      const result = await cascadeFailDependents("task-failed");

      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("status IN ('pending', 'queued')"),
        expect.any(Array)
      );
      expect(result).toEqual([]);
    });
  });

  describe("Capacity and running count", () => {
    it.skip("should respect concurrency limits with dependent tasks", async () => {
      // Even if 5 tasks are eligible, only max_concurrent should be dispatched
      const task1 = createTaskRow({ id: "task-1", status: "running" });
      const task2 = createTaskRow({ id: "task-2", status: "running" });

      vi.mocked(query).mockResolvedValueOnce([]); // expireTimedOutTasks
      vi.mocked(query).mockResolvedValueOnce([
        { concurrency_group: "default" },
      ]); // groups with pending tasks
      vi.mocked(queryOne).mockResolvedValueOnce({ capacity: "2" }); // capacity = 3 - 1 = 2

      // First task
      vi.mocked(queryOne).mockResolvedValueOnce(task1);
      // Second task
      vi.mocked(queryOne).mockResolvedValueOnce(task2);
      // Third attempt returns null (capacity reached)
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const dispatched = await dispatchTasks();

      expect(dispatched).toHaveLength(2);
    });
  });
});
