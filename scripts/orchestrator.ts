/**
 * Task Orchestrator
 *
 * Breaks down high-level tasks into subtasks and coordinates agent execution.
 */

import { executeClaudeTask, type ClaudeExecutorOptions } from "./claude-executor";

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
}

export interface SubTask {
  agentId: string;
  task: string;
  priority: number;
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
  phase: "plan_creating" | "plan_created" | "subtask_starting" | "subtask_completed" | "subtask_failed" | "summarizing" | "completed";
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
    { "agentId": "architect", "task": "description", "priority": 1 }
  ],
  "reasoning": "explanation of the plan"
}

Priority: 1 = highest priority (execute first), higher numbers = lower priority.
Return ONLY valid JSON, no additional text.`;

  const systemPrompt = "You are a task planner. You MUST respond with ONLY a valid JSON object. No explanations, no markdown, no text before or after the JSON. Start your response with { and end with }.";

  const options: ClaudeExecutorOptions = {
    agentId: "planner",
    task: prompt,
    systemPrompt,
    disableTools: true, // Planner doesn't need file tools - prevents plan mode hanging
  };

  // Try up to 2 times
  let lastError: Error | null = null;
  let lastOutput = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await executeClaudeTask(
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
 * Executor signature: (agentId: string, task: string, systemPrompt?: string) => Promise<{success, output?, error?}>
 */
export async function executePlan(
  plan: OrchestrationPlan,
  executor: (
    agentId: string,
    task: string,
    systemPrompt?: string
  ) => Promise<{ success: boolean; output?: string; error?: string }>,
  onProgress?: (event: ProgressEvent) => void
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
  const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const group = priorityGroups.get(priority)!;

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
      try {
        const result = await executor(subtask.agentId, subtask.task, undefined);
        const subResult: SubTaskResult = {
          agentId: subtask.agentId,
          task: subtask.task,
          success: result.success,
          output: result.output,
          error: result.error,
        };

        if (result.success) {
          onProgress?.({
            phase: "subtask_completed",
            agentId: subtask.agentId,
            task: subtask.task,
            subtaskIndex: index,
            totalSubtasks,
            detail: result.output,
          });
        } else {
          onProgress?.({
            phase: "subtask_failed",
            agentId: subtask.agentId,
            task: subtask.task,
            subtaskIndex: index,
            totalSubtasks,
            detail: result.error,
          });
        }

        return subResult;
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
    });

    const batchResults = await Promise.allSettled(promises);
    for (const settled of batchResults) {
      if (settled.status === "fulfilled") {
        results.push(settled.value);
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
  };

  try {
    const result = await executeClaudeTask(options);

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
    systemPrompt?: string
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
