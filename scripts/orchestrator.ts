/**
 * Task Orchestrator
 *
 * Breaks down high-level tasks into subtasks and coordinates agent execution.
 */

import { executeLlmTask, type ClaudeExecutorOptions } from "./claude-executor";
import { getModelFlag, getModelStaleTimeout } from "./model-router";

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
}

/**
 * Delegation category determines model tier, temperature, and timeout.
 * - quick: status checks, lookups, simple reads (haiku, 2min)
 * - writing: docs, reports, content creation (sonnet, 5min)
 * - standard: code implementation, reviews, bug fixes (sonnet, 5min)
 * - visual: UI/UX work, styling, design (sonnet, 5min)
 * - ultrabrain: architecture, security analysis, complex debugging (opus, 10min)
 */
export type DelegationCategory = "quick" | "writing" | "standard" | "visual" | "ultrabrain";

export interface SubTask {
  agentId: string;
  task: string;
  priority: number;
  category?: DelegationCategory;
}

export interface OrchestrationPlan {
  subtasks: SubTask[];
  reasoning: string;
}

export interface SubTaskResult {
  agentId: string;
  task: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface OrchestrationResult {
  plan: OrchestrationPlan;
  results: SubTaskResult[];
  summary: string;
  totalTime: number;
}

export interface ProgressEvent {
  phase: "plan_creating" | "plan_created" | "subtask_starting" | "subtask_completed" | "subtask_failed" | "subtask_retrying" | "summarizing" | "completed";
  agentId?: string;
  task?: string;
  detail?: string;
  subtaskIndex?: number;
  totalSubtasks?: number;
}

/**
 * Helper function to extract JSON from mixed text
 */
function extractJson(text: string): string {
  // Try markdown fence first
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find JSON object in text
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

/**
 * Create an orchestration plan by asking Claude to break down the task
 */
export async function createPlan(
  task: string,
  agents: AgentInfo[]
): Promise<OrchestrationPlan> {
  const agentList = agents
    .map((a) => `- ${a.id} (${a.name}): ${a.role}`)
    .join("\n");

  const prompt = `Break down the following task into subtasks for the available agents.

Task: ${task}

Available agents:
${agentList}

Return a JSON object with this structure:
{
  "subtasks": [
    { "agentId": "architect", "task": "description", "priority": 1, "category": "standard" }
  ],
  "reasoning": "explanation of the plan"
}

Priority: 1 = highest priority (execute first), higher numbers = lower priority.

Category (required): classify each subtask's complexity for model selection:
- "quick": status checks, lookups, simple reads, summaries
- "writing": documentation, reports, content creation, blog posts
- "standard": code implementation, bug fixes, reviews, tests
- "visual": UI/UX work, styling, design, frontend components
- "ultrabrain": architecture design, security analysis, complex debugging, system optimization

Return ONLY valid JSON, no additional text.`;

  const systemPrompt = "You are a task planner. You MUST respond with ONLY a valid JSON object. No explanations, no markdown, no text before or after the JSON. Start your response with { and end with }.";

  const options: ClaudeExecutorOptions = {
    agentId: "planner",
    task: prompt,
    systemPrompt,
    disableTools: true, // Planner doesn't need file tools - prevents plan mode hanging
    model: getModelFlag("sonnet"), // Planner: sonnet is sufficient for JSON plan generation
    staleTimeout: getModelStaleTimeout("sonnet", 15), // disableTools=true is single API call; shorter timeout (sonnet medium complexity)
  };

  // Try up to 2 times
  let lastError: Error | null = null;
  let lastOutput = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await executeLlmTask(
      attempt === 0
        ? options
        : {
            ...options,
            task: `Your previous response was not valid JSON. You MUST respond with ONLY a JSON object.

Previous invalid response:
${lastOutput}

${prompt}`,
          }
    );

    if (!result.success) {
      throw new Error(result.error || "Failed to create plan");
    }

    lastOutput = result.output || "";

    try {
      const raw = extractJson(lastOutput);
      const plan = JSON.parse(raw);
      return plan as OrchestrationPlan;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // If this is the first attempt, retry; otherwise throw
      if (attempt === 1) {
        throw new Error(`Invalid JSON response after ${attempt + 1} attempts: ${lastError.message}`);
      }
    }
  }

  // Should not reach here, but TypeScript needs this
  throw lastError || new Error("Failed to create plan");
}

/**
 * Execute a plan by running each subtask via the executor function
 * Executor signature: (agentId, task, systemPrompt?, category?) => Promise<{success, output?, error?}>
 */
export async function executePlan(
  plan: OrchestrationPlan,
  executor: (
    agentId: string,
    task: string,
    systemPrompt?: string,
    category?: DelegationCategory
  ) => Promise<{ success: boolean; output?: string; error?: string }>,
  onProgress?: (event: ProgressEvent) => void,
  maxSubtaskRetries: number = 1
): Promise<SubTaskResult[]> {
  const sortedSubtasks = [...plan.subtasks].sort((a, b) => a.priority - b.priority);
  const totalSubtasks = sortedSubtasks.length;
  const results: SubTaskResult[] = [];

  // Group subtasks by priority for parallel execution within same priority
  const priorityGroups = new Map<number, Array<{ subtask: SubTask; index: number }>>();
  sortedSubtasks.forEach((subtask, index) => {
    const group = priorityGroups.get(subtask.priority) || [];
    group.push({ subtask, index });
    priorityGroups.set(subtask.priority, group);
  });

  // Execute each priority group: within a group, run in parallel
  // Context Persistence: accumulate previous group results for injection into next groups
  const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
  const previousGroupResults: SubTaskResult[] = [];

  for (const priority of sortedPriorities) {
    const group = priorityGroups.get(priority)!;

    // Build context summary from previous priority groups' successful results
    let contextPrefix = "";
    if (previousGroupResults.length > 0) {
      const contextSummary = previousGroupResults
        .filter(r => r.success && r.output)
        .map(r => `[${r.agentId}] ${r.output!.slice(-1500)}`)
        .join("\n---\n");
      if (contextSummary) {
        contextPrefix = `## 이전 단계 결과 (참고)\n${contextSummary}\n\n## 당신의 작업\n`;
      }
    }

    // Fire all subtask_starting events for this batch
    for (const { subtask, index } of group) {
      onProgress?.({
        phase: "subtask_starting",
        agentId: subtask.agentId,
        task: subtask.task,
        subtaskIndex: index,
        totalSubtasks,
      });
    }

    // Execute all subtasks in this priority group in parallel
    const promises = group.map(async ({ subtask, index }) => {
      let lastResult: SubTaskResult | null = null;

      for (let attempt = 0; attempt <= maxSubtaskRetries; attempt++) {
        try {
          const baseTask = contextPrefix ? `${contextPrefix}${subtask.task}` : subtask.task;
          const taskStr = attempt > 0
            ? `이전 시도가 시간 초과로 실패했습니다. 핵심 내용만 간결하게 처리해주세요.\n\n${baseTask}`
            : baseTask;

          const result = await executor(subtask.agentId, taskStr, undefined, subtask.category);

          if (result.success) {
            const subResult: SubTaskResult = {
              agentId: subtask.agentId,
              task: subtask.task,
              success: true,
              output: result.output,
            };

            onProgress?.({
              phase: "subtask_completed",
              agentId: subtask.agentId,
              task: subtask.task,
              subtaskIndex: index,
              totalSubtasks,
              detail: result.output,
            });

            return subResult;
          }

          lastResult = {
            agentId: subtask.agentId,
            task: subtask.task,
            success: false,
            error: result.error,
          };

          // Check if retryable (hung/timeout)
          const isHung =
            result.error?.includes("hung") ||
            result.error?.includes("응답 없음") ||
            (result as { exitCode?: number }).exitCode === -2;

          if (!isHung || attempt === maxSubtaskRetries) {
            onProgress?.({
              phase: "subtask_failed",
              agentId: subtask.agentId,
              task: subtask.task,
              subtaskIndex: index,
              totalSubtasks,
              detail: result.error,
            });
            return lastResult;
          }

          // Retry
          onProgress?.({
            phase: "subtask_retrying",
            agentId: subtask.agentId,
            task: subtask.task,
            subtaskIndex: index,
            totalSubtasks,
            detail: `Retry ${attempt + 1}/${maxSubtaskRetries}: previous attempt timed out`,
          });

          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const subResult: SubTaskResult = {
            agentId: subtask.agentId,
            task: subtask.task,
            success: false,
            error: errorMessage,
          };

          onProgress?.({
            phase: "subtask_failed",
            agentId: subtask.agentId,
            task: subtask.task,
            subtaskIndex: index,
            totalSubtasks,
            detail: errorMessage,
          });

          return subResult;
        }
      }

      return lastResult!;
    });

    const batchResults = await Promise.allSettled(promises);
    for (const settled of batchResults) {
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      }
    }
  }

  // Final retry pass: collect failed subtasks with hung/timeout indicators
  const failedHungIndices: number[] = [];
  results.forEach((result, index) => {
    if (
      !result.success &&
      (result.error?.includes("hung") || result.error?.includes("응답 없음"))
    ) {
      failedHungIndices.push(index);
    }
  });

  if (failedHungIndices.length > 0) {
    const retryPromises = failedHungIndices.map(async (resultIndex) => {
      const originalResult = results[resultIndex];
      const retriedTask = `이전 시도가 시간 초과로 실패했습니다. 핵심 내용만 간결하게 처리해주세요.\n\n${originalResult.task}`;

      onProgress?.({
        phase: "subtask_retrying",
        agentId: originalResult.agentId,
        task: originalResult.task,
        detail: "Final retry attempt for hung task",
      });

      try {
        const result = await executor(originalResult.agentId, retriedTask, undefined);

        if (result.success) {
          onProgress?.({
            phase: "subtask_completed",
            agentId: originalResult.agentId,
            task: originalResult.task,
            detail: result.output,
          });

          return {
            index: resultIndex,
            result: {
              agentId: originalResult.agentId,
              task: originalResult.task,
              success: true,
              output: result.output,
            },
          };
        }
      } catch (error) {
        // Keep original failure
      }

      return { index: resultIndex, result: null };
    });

    const retryResults = await Promise.allSettled(retryPromises);
    for (const settled of retryResults) {
      if (settled.status === "fulfilled" && settled.value.result) {
        results[settled.value.index] = settled.value.result;
      }
    }
  }

  return results;
}

/**
 * Generate a summary of orchestration results using Claude
 */
export async function summarizeResults(
  task: string,
  results: SubTaskResult[]
): Promise<string> {
  const resultsText = results
    .map((r) => {
      const status = r.success ? "SUCCESS" : "FAILURE";
      const details = r.success ? r.output : r.error;
      return `- ${r.agentId}: ${r.task} [${status}]${details ? `\n  ${details}` : ""}`;
    })
    .join("\n");

  const prompt = `Summarize the following orchestration results for the task: "${task}"

Results:
${resultsText}

Provide a concise summary mentioning the task, number of successes and failures, and overall outcome.`;

  const options: ClaudeExecutorOptions = {
    agentId: "summarizer",
    task: prompt,
    systemPrompt: "You are a results summarizer. Create concise summaries of task execution results.",
    disableTools: true, // Summarizer doesn't need file tools - prevents plan mode hanging
    model: getModelFlag("haiku"), // Summarizer: haiku is sufficient for text summarization (saves ~80% tokens)
    staleTimeout: getModelStaleTimeout("haiku", 0), // Simple summarization; short timeout (haiku low complexity)
  };

  try {
    const result = await executeLlmTask(options);

    if (!result.success) {
      // Provide fallback summary on failure
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      return `Task "${task}" completed with ${successCount} success(es) and ${failureCount} failure(s).`;
    }

    // Return output or fallback if empty
    if (!result.output || result.output.trim() === "") {
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      return `Task "${task}" completed with ${successCount} success(es) and ${failureCount} failure(s).`;
    }

    return result.output;
  } catch (error) {
    // If summarization fails, return a basic fallback summary
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    return `Task "${task}" completed with ${successCount} success(es) and ${failureCount} failure(s). (Summary generation failed)`;
  }
}

/**
 * Full orchestration: create plan, execute, summarize
 */
export async function orchestrate(
  task: string,
  agents: AgentInfo[],
  executor: (
    agentId: string,
    task: string,
    systemPrompt?: string,
    category?: DelegationCategory
  ) => Promise<{ success: boolean; output?: string; error?: string }>,
  onProgress?: (event: ProgressEvent) => void
): Promise<OrchestrationResult> {
  const startTime = Date.now();

  onProgress?.({ phase: "plan_creating" });

  const plan = await createPlan(task, agents);

  onProgress?.({
    phase: "plan_created",
    detail: plan.reasoning,
    totalSubtasks: plan.subtasks.length,
  });

  const results = await executePlan(plan, executor, onProgress);

  onProgress?.({ phase: "summarizing" });

  const summary = await summarizeResults(task, results);

  onProgress?.({ phase: "completed" });

  const totalTime = Math.max(1, Date.now() - startTime);

  return {
    plan,
    results,
    summary,
    totalTime,
  };
}
