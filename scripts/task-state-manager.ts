/**
 * Task State Manager
 *
 * Gateway-connector 전용 태스크 상태 추적 모듈.
 * PostgreSQL에 실행 중인 태스크 상태를 persist하여,
 * gateway-connector 재시작 시 미완료 태스크를 복구할 수 있게 합니다.
 *
 * 사용 흐름:
 * 1. startTask() — 태스크 시작 시 DB에 기록
 * 2. updateProgress() — 주기적으로 진행 상태 업데이트
 * 3. completeTask() / failTask() — 태스크 종료 시 상태 업데이트
 * 4. getInterruptedTasks() — 재시작 시 미완료 태스크 조회
 * 5. markRecovered() — 복구 시작 시 원본 태스크를 'interrupted'로 변경
 */

import * as http from "http";
import * as https from "https";

export interface TaskExecution {
  id: string;
  gatewayId: string;
  agentId: string;
  commandId?: string;
  commandType: "spawn" | "orchestrate";
  task: string;
  systemPrompt?: string;
  status: "running" | "completed" | "failed" | "interrupted" | "recovered";
  lastOutput?: string;
  toolCallsCount: number;
  totalOutputChars: number;
  lastActivityAt: string;
  orchestrationId?: string;
  orchestrationPlan?: Record<string, unknown>;
  subtaskIndex?: number;
  subtaskResults?: Record<string, unknown>[];
  requestGroupId?: string;
  requestTitle?: string;
  attemptNumber: number;
  maxAttempts: number;
  attachmentRefKeys?: string[];
  startedAt: string;
  completedAt?: string;
  recoveredFromId?: string;
  recoveryReason?: string;
}

export interface RecoverableTask {
  id: string;
  agentId: string;
  commandType: "spawn" | "orchestrate";
  task: string;
  systemPrompt?: string;
  lastOutput?: string;
  toolCallsCount: number;
  totalOutputChars: number;
  attemptNumber: number;
  maxAttempts: number;
  attachmentRefKeys?: string[];
  requestGroupId?: string;
  requestTitle?: string;
  orchestrationId?: string;
  orchestrationPlan?: Record<string, unknown>;
  subtaskIndex?: number;
  subtaskResults?: Record<string, unknown>[];
  startedAt: string;
  lastActivityAt: string;
}

interface TaskStateManagerConfig {
  relayUrl: string;
  relayApiKey: string;
  gatewayId: string;
}

/**
 * TaskStateManager — gateway-connector 전용
 *
 * Dashboard API를 통해 task_executions 테이블과 통신합니다.
 * (gateway-connector는 DB에 직접 접근하지 않으므로 API 경유)
 */
export class TaskStateManager {
  private config: TaskStateManagerConfig;
  // In-memory tracking for quick lookups (synced with DB)
  private activeTasks = new Map<string, TaskExecution>();
  // Progress update batching — coalesce rapid updates
  private pendingUpdates = new Map<string, Partial<TaskExecution>>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_INTERVAL = 5000; // 5초마다 DB 동기화

  constructor(config: TaskStateManagerConfig) {
    this.config = config;
    // Start periodic flush
    this.flushTimer = setInterval(() => this.flushUpdates(), this.FLUSH_INTERVAL);
  }

  /**
   * 태스크 시작 기록
   */
  async startTask(params: {
    agentId: string;
    commandId?: string;
    commandType: "spawn" | "orchestrate";
    task: string;
    systemPrompt?: string;
    requestGroupId?: string;
    requestTitle?: string;
    attachmentRefKeys?: string[];
    orchestrationId?: string;
    orchestrationPlan?: Record<string, unknown>;
    subtaskIndex?: number;
    attemptNumber?: number;
    maxAttempts?: number;
    recoveredFromId?: string;
    recoveryReason?: string;
  }): Promise<string | null> {
    try {
      const result = await this.apiCall("/api/task-executions", "POST", {
        gatewayId: this.config.gatewayId,
        ...params,
        attemptNumber: params.attemptNumber || 1,
        maxAttempts: params.maxAttempts || 3,
      }) as { id?: string; success?: boolean };

      if (result?.id) {
        const execution: TaskExecution = {
          id: result.id,
          gatewayId: this.config.gatewayId,
          agentId: params.agentId,
          commandId: params.commandId,
          commandType: params.commandType,
          task: params.task,
          systemPrompt: params.systemPrompt,
          status: "running",
          toolCallsCount: 0,
          totalOutputChars: 0,
          lastActivityAt: new Date().toISOString(),
          requestGroupId: params.requestGroupId,
          requestTitle: params.requestTitle,
          attachmentRefKeys: params.attachmentRefKeys,
          orchestrationId: params.orchestrationId,
          orchestrationPlan: params.orchestrationPlan,
          subtaskIndex: params.subtaskIndex,
          attemptNumber: params.attemptNumber || 1,
          maxAttempts: params.maxAttempts || 3,
          startedAt: new Date().toISOString(),
          recoveredFromId: params.recoveredFromId,
          recoveryReason: params.recoveryReason,
        };
        this.activeTasks.set(result.id, execution);
        return result.id;
      }
      return null;
    } catch (error) {
      console.error(`   ⚠️ TaskStateManager.startTask failed:`, error);
      return null;
    }
  }

  /**
   * 진행 상태 업데이트 (batched — 5초마다 flush)
   */
  updateProgress(executionId: string, update: {
    lastOutput?: string;
    toolCallsCount?: number;
    totalOutputChars?: number;
    subtaskResults?: Record<string, unknown>[];
  }): void {
    const existing = this.pendingUpdates.get(executionId) || {};
    this.pendingUpdates.set(executionId, {
      ...existing,
      ...update,
      lastActivityAt: new Date().toISOString(),
    });

    // Also update in-memory
    const active = this.activeTasks.get(executionId);
    if (active) {
      if (update.lastOutput !== undefined) active.lastOutput = update.lastOutput;
      if (update.toolCallsCount !== undefined) active.toolCallsCount = update.toolCallsCount;
      if (update.totalOutputChars !== undefined) active.totalOutputChars = update.totalOutputChars;
      if (update.subtaskResults !== undefined) active.subtaskResults = update.subtaskResults;
      active.lastActivityAt = new Date().toISOString();
    }
  }

  /**
   * 태스크 완료
   */
  async completeTask(executionId: string, output?: string): Promise<void> {
    // Remove from pending updates
    this.pendingUpdates.delete(executionId);
    this.activeTasks.delete(executionId);

    try {
      await this.apiCall(`/api/task-executions/${executionId}`, "PATCH", {
        status: "completed",
        lastOutput: output?.slice(-2000),
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`   ⚠️ TaskStateManager.completeTask failed:`, error);
    }
  }

  /**
   * 태스크 실패
   */
  async failTask(executionId: string, error?: string): Promise<void> {
    this.pendingUpdates.delete(executionId);
    this.activeTasks.delete(executionId);

    try {
      await this.apiCall(`/api/task-executions/${executionId}`, "PATCH", {
        status: "failed",
        lastOutput: error?.slice(-2000),
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`   ⚠️ TaskStateManager.failTask failed:`, err);
    }
  }

  /**
   * 재시작 시 미완료(interrupted) 태스크 조회
   */
  async getInterruptedTasks(): Promise<RecoverableTask[]> {
    try {
      const result = await this.apiCall(
        `/api/task-executions?gatewayId=${this.config.gatewayId}&status=interrupted`,
        "GET"
      ) as { tasks?: RecoverableTask[] };

      return result?.tasks || [];
    } catch (error) {
      console.error(`   ⚠️ TaskStateManager.getInterruptedTasks failed:`, error);
      return [];
    }
  }

  /**
   * 태스크를 'interrupted' 상태로 변경 (복구 전)
   */
  async markInterrupted(executionId: string, reason: string): Promise<void> {
    try {
      await this.apiCall(`/api/task-executions/${executionId}`, "PATCH", {
        status: "interrupted",
        recoveryReason: reason,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`   ⚠️ TaskStateManager.markInterrupted failed:`, error);
    }
  }

  /**
   * 모든 running 상태 태스크를 interrupted로 전환 (시작 시)
   */
  async markAllRunningAsInterrupted(reason: string): Promise<number> {
    try {
      const result = await this.apiCall(
        `/api/task-executions/interrupt-all`,
        "POST",
        {
          gatewayId: this.config.gatewayId,
          reason,
        }
      ) as { count?: number };

      return result?.count || 0;
    } catch (error) {
      console.error(`   ⚠️ TaskStateManager.markAllRunningAsInterrupted failed:`, error);
      return 0;
    }
  }

  /**
   * Pending updates를 DB에 flush
   */
  private async flushUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) return;

    const updates = new Map(this.pendingUpdates);
    this.pendingUpdates.clear();

    for (const [executionId, update] of updates) {
      try {
        await this.apiCall(`/api/task-executions/${executionId}`, "PATCH", update);
      } catch {
        // Re-queue failed updates for next flush
        const existing = this.pendingUpdates.get(executionId);
        if (!existing) {
          this.pendingUpdates.set(executionId, update);
        }
      }
    }
  }

  /**
   * 현재 활성 태스크 수
   */
  getActiveTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * 특정 에이전트의 활성 태스크 ID
   */
  getActiveTaskId(agentId: string): string | undefined {
    for (const [id, task] of this.activeTasks) {
      if (task.agentId === agentId) return id;
    }
    return undefined;
  }

  /**
   * Shutdown — flush all pending and stop timer
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    await this.flushUpdates();

    // Mark all in-memory active tasks as interrupted
    for (const [executionId] of this.activeTasks) {
      try {
        await this.apiCall(`/api/task-executions/${executionId}`, "PATCH", {
          status: "interrupted",
          recoveryReason: "gateway_shutdown",
          completedAt: new Date().toISOString(),
        });
      } catch {
        // Best-effort
      }
    }
    this.activeTasks.clear();
  }

  /**
   * API call helper
   */
  private apiCall(
    path: string,
    method: "GET" | "POST" | "PATCH" = "POST",
    body?: unknown
  ): Promise<unknown> {
    const url = `${this.config.relayUrl}${path}`;
    const urlObj = new URL(url);
    const transport = urlObj.protocol === "https:" ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method,
          headers: {
            "Content-Type": "application/json",
            "x-relay-key": this.config.relayApiKey,
            ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr).toString() } : {}),
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ error: "Invalid JSON", raw: data });
            }
          });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });
      req.on("error", reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }
}
