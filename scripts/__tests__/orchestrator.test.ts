import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock claude-executor before importing orchestrator
vi.mock("../claude-executor", () => ({
  executeClaudeTask: vi.fn(),
}));

import { executeClaudeTask } from "../claude-executor";
import {
  createPlan,
  executePlan,
  summarizeResults,
  orchestrate,
  type AgentInfo,
  type OrchestrationPlan,
  type SubTask,
  type SubTaskResult,
  type ProgressEvent,
} from "../orchestrator";

const mockAgents: AgentInfo[] = [
  {
    id: "architect",
    name: "Architect",
    role: "System design and planning",
    systemPrompt: "You are an expert software architect.",
  },
  {
    id: "executor",
    name: "Executor",
    role: "Code implementation",
    systemPrompt: "You are a senior software engineer.",
  },
  {
    id: "tester",
    name: "QA Tester",
    role: "Testing and quality assurance",
    systemPrompt: "You are a QA specialist.",
  },
];

describe("orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPlan", () => {
    it("should return valid plan with subtasks array and reasoning", async () => {
      const mockPlan = {
        subtasks: [
          { agentId: "architect", task: "Design system", priority: 1 },
          { agentId: "executor", task: "Implement feature", priority: 2 },
        ],
        reasoning: "First design, then implement",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Build a REST API", mockAgents);

      expect(result).toBeDefined();
      expect(result.subtasks).toBeInstanceOf(Array);
      expect(result.subtasks).toHaveLength(2);
      expect(result.reasoning).toBe("First design, then implement");
    });

    it("should have each subtask with valid agentId from provided agents", async () => {
      const mockPlan = {
        subtasks: [
          { agentId: "architect", task: "Design", priority: 1 },
          { agentId: "executor", task: "Code", priority: 2 },
          { agentId: "tester", task: "Test", priority: 3 },
        ],
        reasoning: "Design, code, test workflow",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Build feature", mockAgents);

      const validAgentIds = mockAgents.map((a) => a.id);
      result.subtasks.forEach((subtask) => {
        expect(validAgentIds).toContain(subtask.agentId);
      });
    });

    it("should have each subtask with task string and priority number", async () => {
      const mockPlan = {
        subtasks: [
          { agentId: "architect", task: "Design API", priority: 1 },
          { agentId: "executor", task: "Implement endpoints", priority: 2 },
        ],
        reasoning: "Sequential execution",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Create API", mockAgents);

      result.subtasks.forEach((subtask) => {
        expect(typeof subtask.task).toBe("string");
        expect(subtask.task).toBeTruthy();
        expect(typeof subtask.priority).toBe("number");
        expect(subtask.priority).toBeGreaterThan(0);
      });
    });

    it("should handle empty agent list gracefully", async () => {
      const mockPlan = {
        subtasks: [],
        reasoning: "No agents available",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Some task", []);

      expect(result.subtasks).toEqual([]);
      expect(result.reasoning).toBeTruthy();
    });

    it("should handle very long task strings", async () => {
      const longTask = "Build ".repeat(1000) + "a complex system";
      const mockPlan = {
        subtasks: [{ agentId: "architect", task: "Analyze", priority: 1 }],
        reasoning: "Complex task requires analysis",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan(longTask, mockAgents);

      expect(result.subtasks).toBeDefined();
      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.stringContaining("Build"),
        })
      );
    });

    it("should throw error when Claude execution fails", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: false,
        error: "Claude CLI not found",
        exitCode: 1,
      });

      await expect(createPlan("Task", mockAgents)).rejects.toThrow();
    });

    it("should throw error when output is not valid JSON", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: "Invalid JSON {{{",
        exitCode: 0,
      });

      await expect(createPlan("Task", mockAgents)).rejects.toThrow();
    });

    it("should prioritize subtasks correctly (1=highest)", async () => {
      const mockPlan = {
        subtasks: [
          { agentId: "tester", task: "Test", priority: 3 },
          { agentId: "architect", task: "Design", priority: 1 },
          { agentId: "executor", task: "Code", priority: 2 },
        ],
        reasoning: "Priority order test",
      };

      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Task", mockAgents);

      expect(result.subtasks[0].priority).toBe(3);
      expect(result.subtasks[1].priority).toBe(1);
      expect(result.subtasks[2].priority).toBe(2);
    });
  });

  describe("executePlan", () => {
    const mockPlan: OrchestrationPlan = {
      subtasks: [
        { agentId: "architect", task: "Design system", priority: 1 },
        { agentId: "executor", task: "Implement", priority: 2 },
      ],
      reasoning: "Design then implement",
    };

    it("should execute all subtasks via the executor function", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        success: true,
        output: "Completed",
      });

      await executePlan(mockPlan, mockExecutor);

      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it("should return results for each subtask", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        success: true,
        output: "Done",
      });

      const results = await executePlan(mockPlan, mockExecutor);

      expect(results).toHaveLength(2);
      expect(results[0].agentId).toBe("architect");
      expect(results[0].task).toBe("Design system");
      expect(results[1].agentId).toBe("executor");
      expect(results[1].task).toBe("Implement");
    });

    it("should handle executor failures gracefully", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        success: false,
        error: "Execution failed",
      });

      const results = await executePlan(mockPlan, mockExecutor);

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result.success).toBe(false);
        expect(result.error).toBe("Execution failed");
      });
    });

    it("should handle mixed success and failure results", async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({ success: true, output: "Success" })
        .mockResolvedValueOnce({ success: false, error: "Failed" });

      const results = await executePlan(mockPlan, mockExecutor);

      expect(results[0].success).toBe(true);
      expect(results[0].output).toBe("Success");
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe("Failed");
    });

    it("should call executor with correct agentId and task", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({ success: true });

      await executePlan(mockPlan, mockExecutor);

      expect(mockExecutor).toHaveBeenNthCalledWith(1, "architect", "Design system", undefined);
      expect(mockExecutor).toHaveBeenNthCalledWith(2, "executor", "Implement", undefined);
    });

    it("should pass empty plan and return empty results", async () => {
      const emptyPlan: OrchestrationPlan = {
        subtasks: [],
        reasoning: "No work needed",
      };
      const mockExecutor = vi.fn();

      const results = await executePlan(emptyPlan, mockExecutor);

      expect(results).toEqual([]);
      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it("should execute subtasks in priority order (1=highest first)", async () => {
      const unorderedPlan: OrchestrationPlan = {
        subtasks: [
          { agentId: "tester", task: "Test", priority: 3 },
          { agentId: "architect", task: "Design", priority: 1 },
          { agentId: "executor", task: "Code", priority: 2 },
        ],
        reasoning: "Test priority ordering",
      };

      const executionOrder: string[] = [];
      const mockExecutor = vi.fn().mockImplementation((agentId: string) => {
        executionOrder.push(agentId);
        return Promise.resolve({ success: true });
      });

      await executePlan(unorderedPlan, mockExecutor);

      expect(executionOrder).toEqual(["architect", "executor", "tester"]);
    });

    it("should handle executor throwing exception", async () => {
      const mockExecutor = vi
        .fn()
        .mockRejectedValue(new Error("Executor crashed"));

      const results = await executePlan(mockPlan, mockExecutor);

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result.success).toBe(false);
        expect(result.error).toContain("Executor crashed");
      });
    });

    it("should execute same-priority subtasks in parallel", async () => {
      const parallelPlan: OrchestrationPlan = {
        subtasks: [
          { agentId: "architect", task: "Design A", priority: 1 },
          { agentId: "executor", task: "Design B", priority: 1 },
          { agentId: "tester", task: "Design C", priority: 1 },
        ],
        reasoning: "All same priority - should run in parallel",
      };

      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      const mockExecutor = vi.fn().mockImplementation((agentId: string) => {
        startTimes[agentId] = Date.now();
        return new Promise((resolve) =>
          setTimeout(() => {
            endTimes[agentId] = Date.now();
            resolve({ success: true, output: `${agentId} done` });
          }, 100)
        );
      });

      const start = Date.now();
      const results = await executePlan(parallelPlan, mockExecutor);
      const totalElapsed = Date.now() - start;

      expect(results).toHaveLength(3);
      results.forEach((r) => expect(r.success).toBe(true));

      // If sequential: ~300ms. If parallel: ~100ms.
      // Allow generous margin but should be significantly less than sequential.
      expect(totalElapsed).toBeLessThan(250);
    });

    it("should execute different-priority groups sequentially", async () => {
      const mixedPlan: OrchestrationPlan = {
        subtasks: [
          { agentId: "architect", task: "Phase 1", priority: 1 },
          { agentId: "executor", task: "Phase 2", priority: 2 },
        ],
        reasoning: "Different priorities - sequential groups",
      };

      const executionOrder: string[] = [];
      const mockExecutor = vi.fn().mockImplementation((agentId: string) => {
        executionOrder.push(`start:${agentId}`);
        return new Promise((resolve) =>
          setTimeout(() => {
            executionOrder.push(`end:${agentId}`);
            resolve({ success: true });
          }, 50)
        );
      });

      await executePlan(mixedPlan, mockExecutor);

      // Priority 1 should complete before priority 2 starts
      expect(executionOrder.indexOf("end:architect")).toBeLessThan(
        executionOrder.indexOf("start:executor")
      );
    });

    it("should fire all subtask_starting events for a parallel batch before any completion", async () => {
      const parallelPlan: OrchestrationPlan = {
        subtasks: [
          { agentId: "architect", task: "Task A", priority: 1 },
          { agentId: "executor", task: "Task B", priority: 1 },
        ],
        reasoning: "Parallel batch",
      };

      const mockExecutor = vi.fn().mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ success: true, output: "done" }), 50)
        )
      );

      const onProgress = vi.fn();
      await executePlan(parallelPlan, mockExecutor, onProgress);

      const phases = onProgress.mock.calls.map((call) => call[0].phase);

      // Both starting events should come before any completed events
      const firstCompleted = phases.indexOf("subtask_completed");
      const startingEvents = phases.filter((p: string) => p === "subtask_starting");
      expect(startingEvents).toHaveLength(2);
      expect(phases[0]).toBe("subtask_starting");
      expect(phases[1]).toBe("subtask_starting");
      expect(firstCompleted).toBeGreaterThanOrEqual(2);
    });
  });

  describe("summarizeResults", () => {
    const mockResults: SubTaskResult[] = [
      {
        agentId: "architect",
        task: "Design API",
        success: true,
        output: "Design completed",
      },
      {
        agentId: "executor",
        task: "Implement endpoints",
        success: true,
        output: "Implementation done",
      },
    ];

    it("should return a non-empty summary string", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: "Summary of the orchestration results",
        exitCode: 0,
      });

      const summary = await summarizeResults("Build REST API", mockResults);

      expect(typeof summary).toBe("string");
      expect(summary.length).toBeGreaterThan(0);
    });

    it("should mention the original task in summary", async () => {
      const summaryText = "Built REST API with 2 successful subtasks";
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: summaryText,
        exitCode: 0,
      });

      const summary = await summarizeResults("Build REST API", mockResults);

      expect(summary).toContain("REST API");
    });

    it("should include info about successes and failures", async () => {
      const mixedResults: SubTaskResult[] = [
        { agentId: "architect", task: "Design", success: true },
        { agentId: "executor", task: "Code", success: false, error: "Failed" },
        { agentId: "tester", task: "Test", success: true },
      ];

      const summaryText = "2 successes, 1 failure";
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: summaryText,
        exitCode: 0,
      });

      const summary = await summarizeResults("Task", mixedResults);

      expect(summary).toMatch(/success/i);
      expect(summary).toMatch(/failure|fail/i);
    });

    it("should handle empty results array", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: "No subtasks were executed",
        exitCode: 0,
      });

      const summary = await summarizeResults("Task", []);

      expect(summary).toBeTruthy();
    });

    it("should return fallback summary when Claude execution fails", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: false,
        error: "Failed to generate summary",
        exitCode: 1,
      });

      const summary = await summarizeResults("Task", mockResults);
      expect(summary).toContain("Task \"Task\" completed");
      expect(summary).toContain("success(es)");
    });

    it("should pass task and results to Claude executor", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValue({
        success: true,
        output: "Summary",
        exitCode: 0,
      });

      await summarizeResults("Build API", mockResults);

      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.stringContaining("Build API"),
        })
      );
    });
  });

  describe("orchestrate (integration)", () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      success: true,
      output: "Completed",
    });

    beforeEach(() => {
      mockExecutor.mockClear();
    });

    it("should call createPlan, executePlan, summarizeResults in order", async () => {
      const mockPlan = {
        subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
        reasoning: "Simple design task",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "Orchestration completed successfully",
          exitCode: 0,
        });

      await orchestrate("Build feature", mockAgents, mockExecutor);

      expect(executeClaudeTask).toHaveBeenCalledTimes(2);
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it("should return complete OrchestrationResult", async () => {
      const mockPlan = {
        subtasks: [
          { agentId: "architect", task: "Design", priority: 1 },
          { agentId: "executor", task: "Code", priority: 2 },
        ],
        reasoning: "Design then code",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "All tasks completed",
          exitCode: 0,
        });

      const result = await orchestrate("Build", mockAgents, mockExecutor);

      expect(result).toBeDefined();
      expect(result.plan).toBeDefined();
      expect(result.plan.subtasks).toHaveLength(2);
      expect(result.results).toHaveLength(2);
      expect(result.summary).toBe("All tasks completed");
      expect(result.totalTime).toBeDefined();
    });

    it("should have totalTime as a positive number", async () => {
      const mockPlan = {
        subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
        reasoning: "Quick task",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "Done",
          exitCode: 0,
        });

      const result = await orchestrate("Task", mockAgents, mockExecutor);

      expect(typeof result.totalTime).toBe("number");
      expect(result.totalTime).toBeGreaterThan(0);
    });

    it("should handle plan creation failure", async () => {
      vi.mocked(executeClaudeTask).mockResolvedValueOnce({
        success: false,
        error: "Plan creation failed",
        exitCode: 1,
      });

      await expect(
        orchestrate("Task", mockAgents, mockExecutor)
      ).rejects.toThrow();

      expect(mockExecutor).not.toHaveBeenCalled();
    });

    it("should handle execution failures but still summarize", async () => {
      const mockPlan = {
        subtasks: [{ agentId: "executor", task: "Code", priority: 1 }],
        reasoning: "Simple code task",
      };

      mockExecutor.mockResolvedValue({
        success: false,
        error: "Execution failed",
      });

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "1 failure occurred",
          exitCode: 0,
        });

      const result = await orchestrate("Task", mockAgents, mockExecutor);

      expect(result.results[0].success).toBe(false);
      expect(result.summary).toBe("1 failure occurred");
    });

    it("should measure execution time accurately", async () => {
      const mockPlan = {
        subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
        reasoning: "Timed task",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "Summary",
          exitCode: 0,
        });

      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ success: true }), 100)
          )
      );

      const result = await orchestrate("Task", mockAgents, mockExecutor);

      expect(result.totalTime).toBeGreaterThanOrEqual(100);
    });

    it("should pass all agents to createPlan", async () => {
      const mockPlan = {
        subtasks: [],
        reasoning: "No work needed",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "Empty plan",
          exitCode: 0,
        });

      await orchestrate("Task", mockAgents, mockExecutor);

      expect(executeClaudeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.stringContaining("architect"),
        })
      );
    });

    it("should include plan in final result", async () => {
      const mockPlan = {
        subtasks: [{ agentId: "tester", task: "Test", priority: 1 }],
        reasoning: "Testing phase",
      };

      vi.mocked(executeClaudeTask)
        .mockResolvedValueOnce({
          success: true,
          output: JSON.stringify(mockPlan),
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          success: true,
          output: "Summary",
          exitCode: 0,
        });

      const result = await orchestrate("Task", mockAgents, mockExecutor);

      expect(result.plan).toEqual(mockPlan);
      expect(result.plan.reasoning).toBe("Testing phase");
    });
  });

  describe("onProgress callbacks", () => {
    describe("executePlan onProgress tests", () => {
      it("should call onProgress with subtask_starting before each subtask", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [
            { agentId: "architect", task: "Design", priority: 1 },
            { agentId: "executor", task: "Code", priority: 2 },
          ],
          reasoning: "Design then code",
        };

        const mockExecutor = vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
        });

        const onProgress = vi.fn();

        await executePlan(mockPlan, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "subtask_starting",
            agentId: "architect",
            task: "Design",
            subtaskIndex: 0,
            totalSubtasks: 2,
          })
        );

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "subtask_starting",
            agentId: "executor",
            task: "Code",
            subtaskIndex: 1,
            totalSubtasks: 2,
          })
        );
      });

      it("should call onProgress with subtask_completed for successful subtasks", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple design",
        };

        const mockExecutor = vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
        });

        const onProgress = vi.fn();

        await executePlan(mockPlan, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "subtask_completed",
            agentId: "architect",
            detail: "Done",
            subtaskIndex: 0,
            totalSubtasks: 1,
          })
        );
      });

      it("should call onProgress with subtask_failed for failed subtasks", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [{ agentId: "executor", task: "Code", priority: 1 }],
          reasoning: "Code task",
        };

        const mockExecutor = vi.fn().mockResolvedValue({
          success: false,
          error: "Broken",
        });

        const onProgress = vi.fn();

        await executePlan(mockPlan, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "subtask_failed",
            detail: "Broken",
            subtaskIndex: 0,
            totalSubtasks: 1,
          })
        );
      });

      it("should call onProgress with subtask_failed when executor throws", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [{ agentId: "executor", task: "Code", priority: 1 }],
          reasoning: "Code task",
        };

        const mockExecutor = vi.fn().mockRejectedValue(new Error("Crashed"));

        const onProgress = vi.fn();

        await executePlan(mockPlan, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "subtask_failed",
            detail: "Crashed",
            subtaskIndex: 0,
            totalSubtasks: 1,
          })
        );
      });

      it("should call onProgress in correct order: starting, completed/failed for each subtask", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [
            { agentId: "architect", task: "Design", priority: 1 },
            { agentId: "executor", task: "Code", priority: 2 },
          ],
          reasoning: "Design then code",
        };

        const mockExecutor = vi
          .fn()
          .mockResolvedValueOnce({ success: true, output: "Success" })
          .mockResolvedValueOnce({ success: false, error: "Failed" });

        const onProgress = vi.fn();

        await executePlan(mockPlan, mockExecutor, onProgress);

        const calls = onProgress.mock.calls.map((call) => call[0]);

        expect(calls[0]).toMatchObject({ phase: "subtask_starting", agentId: "architect" });
        expect(calls[1]).toMatchObject({ phase: "subtask_completed", agentId: "architect" });
        expect(calls[2]).toMatchObject({ phase: "subtask_starting", agentId: "executor" });
        expect(calls[3]).toMatchObject({ phase: "subtask_failed", agentId: "executor" });
      });

      it("should work without onProgress (backward compatible)", async () => {
        const mockPlan: OrchestrationPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple design",
        };

        const mockExecutor = vi.fn().mockResolvedValue({
          success: true,
          output: "Done",
        });

        const results = await executePlan(mockPlan, mockExecutor);

        expect(results).toHaveLength(1);
        expect(results[0].success).toBe(true);
      });
    });

    describe("orchestrate onProgress tests", () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        success: true,
        output: "Completed",
      });

      beforeEach(() => {
        mockExecutor.mockClear();
      });

      it("should call onProgress with plan_creating first", async () => {
        const mockPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple design task",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const onProgress = vi.fn();

        await orchestrate("Build feature", mockAgents, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenNthCalledWith(1, { phase: "plan_creating" });
      });

      it("should call onProgress with plan_created after plan is made", async () => {
        const mockPlan = {
          subtasks: [
            { agentId: "architect", task: "Design", priority: 1 },
            { agentId: "executor", task: "Code", priority: 2 },
          ],
          reasoning: "Design then code",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const onProgress = vi.fn();

        await orchestrate("Build feature", mockAgents, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            phase: "plan_created",
            totalSubtasks: 2,
            detail: "Design then code",
          })
        );
      });

      it("should call onProgress with summarizing before summary", async () => {
        const mockPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple task",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const onProgress = vi.fn();

        await orchestrate("Build feature", mockAgents, mockExecutor, onProgress);

        expect(onProgress).toHaveBeenCalledWith({ phase: "summarizing" });
      });

      it("should call onProgress with completed at the end", async () => {
        const mockPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple task",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const onProgress = vi.fn();

        await orchestrate("Build feature", mockAgents, mockExecutor, onProgress);

        const calls = onProgress.mock.calls;
        const lastCall = calls[calls.length - 1][0];
        expect(lastCall).toMatchObject({ phase: "completed" });
      });

      it("should fire all progress events in correct order", async () => {
        const mockPlan = {
          subtasks: [
            { agentId: "architect", task: "Design", priority: 1 },
            { agentId: "executor", task: "Code", priority: 2 },
          ],
          reasoning: "Design then code",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const onProgress = vi.fn();

        await orchestrate("Build feature", mockAgents, mockExecutor, onProgress);

        const phases = onProgress.mock.calls.map((call) => call[0].phase);

        expect(phases).toEqual([
          "plan_creating",
          "plan_created",
          "subtask_starting",
          "subtask_completed",
          "subtask_starting",
          "subtask_completed",
          "summarizing",
          "completed",
        ]);
      });

      it("should work without onProgress (backward compatible)", async () => {
        const mockPlan = {
          subtasks: [{ agentId: "architect", task: "Design", priority: 1 }],
          reasoning: "Simple task",
        };

        vi.mocked(executeClaudeTask)
          .mockResolvedValueOnce({
            success: true,
            output: JSON.stringify(mockPlan),
            exitCode: 0,
          })
          .mockResolvedValueOnce({
            success: true,
            output: "Summary",
            exitCode: 0,
          });

        const result = await orchestrate("Build feature", mockAgents, mockExecutor);

        expect(result).toBeDefined();
        expect(result.plan).toBeDefined();
        expect(result.summary).toBe("Summary");
      });
    });
  });
});
