/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock claude-executor before importing orchestrator
vi.mock("../claude-executor", () => ({
  executeLlmTask: vi.fn(),
}));

import { executeLlmTask } from "../claude-executor";
import {
  createPlan,
  type SubTask,
  type AgentInfo,
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
];

describe("orchestrator modelTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SubTask interface modelTier field", () => {
    it("should accept modelTier field on SubTask objects", () => {
      // TypeScript compile-time check: SubTask should accept modelTier
      const task: SubTask = {
        agentId: "architect",
        task: "Design the system",
        priority: 1,
        modelTier: "high",
      };

      expect(task.modelTier).toBe("high");
    });

    it("should allow modelTier to be optional (undefined)", () => {
      const task: SubTask = {
        agentId: "executor",
        task: "Implement feature",
        priority: 2,
        // modelTier omitted — optional field
      };

      expect(task.modelTier).toBeUndefined();
    });

    it('should accept "low" as a valid modelTier value', () => {
      const task: SubTask = {
        agentId: "executor",
        task: "Check status",
        priority: 1,
        modelTier: "low",
      };

      expect(task.modelTier).toBe("low");
    });

    it('should accept "medium" as a valid modelTier value', () => {
      const task: SubTask = {
        agentId: "executor",
        task: "Implement feature",
        priority: 1,
        modelTier: "medium",
      };

      expect(task.modelTier).toBe("medium");
    });

    it('should accept "high" as a valid modelTier value', () => {
      const task: SubTask = {
        agentId: "architect",
        task: "Architecture review",
        priority: 1,
        modelTier: "high",
      };

      expect(task.modelTier).toBe("high");
    });

    it("should preserve modelTier through object spread", () => {
      const original: SubTask = {
        agentId: "architect",
        task: "Design",
        priority: 1,
        modelTier: "high",
      };

      const copy: SubTask = { ...original };
      expect(copy.modelTier).toBe("high");
    });
  });

  describe("createPlan prompt contains modelTier instructions", () => {
    it("should include 'modelTier' in the prompt sent to executeLlmTask", async () => {
      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify({
          subtasks: [
            {
              agentId: "architect",
              task: "Design",
              priority: 1,
              category: "standard",
              modelTier: "medium",
            },
          ],
          reasoning: "Test plan",
        }),
        exitCode: 0,
      });

      await createPlan("Build a REST API", mockAgents);

      expect(executeLlmTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.stringContaining("modelTier"),
        })
      );
    });

    it("should include modelTier tier descriptions in the prompt", async () => {
      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify({
          subtasks: [],
          reasoning: "No tasks",
        }),
        exitCode: 0,
      });

      await createPlan("Simple task", mockAgents);

      const callArgs = vi.mocked(executeLlmTask).mock.calls[0][0];
      const prompt = callArgs.task as string;

      // The prompt should describe the three tiers
      expect(prompt).toContain("low");
      expect(prompt).toContain("medium");
      expect(prompt).toContain("high");
    });

    it("should include cost/model descriptions for tiers in prompt", async () => {
      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify({ subtasks: [], reasoning: "test" }),
        exitCode: 0,
      });

      await createPlan("Analyze system", mockAgents);

      const prompt = vi.mocked(executeLlmTask).mock.calls[0][0].task as string;

      // Should mention haiku for low tier
      expect(prompt).toContain("haiku");
      // Should mention sonnet for medium tier
      expect(prompt).toContain("sonnet");
      // Should mention opus for high tier
      expect(prompt).toContain("opus");
    });

    it("should include modelTier in the JSON example structure", async () => {
      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify({ subtasks: [], reasoning: "test" }),
        exitCode: 0,
      });

      await createPlan("Build feature", mockAgents);

      const prompt = vi.mocked(executeLlmTask).mock.calls[0][0].task as string;

      // The JSON example should show modelTier field
      expect(prompt).toMatch(/"modelTier"/);
    });
  });

  describe("createPlan result parses modelTier field", () => {
    it("should preserve modelTier in parsed subtasks", async () => {
      const mockPlan = {
        subtasks: [
          {
            agentId: "architect",
            task: "Design system architecture",
            priority: 1,
            category: "ultrabrain",
            modelTier: "high",
          },
          {
            agentId: "executor",
            task: "Implement endpoints",
            priority: 2,
            category: "standard",
            modelTier: "medium",
          },
        ],
        reasoning: "High-level design first, then implementation",
      };

      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Build REST API", mockAgents);

      expect(result.subtasks[0].modelTier).toBe("high");
      expect(result.subtasks[1].modelTier).toBe("medium");
    });

    it("should handle subtasks without modelTier (backward compatible)", async () => {
      const mockPlan = {
        subtasks: [
          {
            agentId: "architect",
            task: "Design",
            priority: 1,
            category: "standard",
            // no modelTier field
          },
        ],
        reasoning: "Simple task",
      };

      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Build feature", mockAgents);

      // Should not throw; modelTier is simply undefined
      expect(result.subtasks[0].modelTier).toBeUndefined();
      expect(result.subtasks[0].agentId).toBe("architect");
    });

    it("should parse all three modelTier values from plan output", async () => {
      const mockPlan = {
        subtasks: [
          {
            agentId: "architect",
            task: "Status check",
            priority: 1,
            category: "quick",
            modelTier: "low",
          },
          {
            agentId: "executor",
            task: "Code review",
            priority: 2,
            category: "standard",
            modelTier: "medium",
          },
          {
            agentId: "architect",
            task: "Security analysis",
            priority: 3,
            category: "ultrabrain",
            modelTier: "high",
          },
        ],
        reasoning: "Mixed tier tasks",
      };

      vi.mocked(executeLlmTask).mockResolvedValue({
        success: true,
        output: JSON.stringify(mockPlan),
        exitCode: 0,
      });

      const result = await createPlan("Complex project", mockAgents);

      const tiers = result.subtasks.map((s) => s.modelTier);
      expect(tiers).toContain("low");
      expect(tiers).toContain("medium");
      expect(tiers).toContain("high");
    });
  });
});
