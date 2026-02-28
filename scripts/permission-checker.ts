/**
 * Permission Checker for Gateway Connector
 *
 * Integrates with the permission system to request approvals
 * for sensitive file operations.
 */

import * as http from "http";
import * as https from "https";
import {
  checkPermission,
  type PermissionAction,
  type ApprovalRequest,
} from "../src/lib/permissions";

interface PermissionCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  approvalId?: string;
}

/**
 * Check if an operation requires approval and request it if needed
 */
export async function checkAndRequestPermission(
  path: string,
  action: PermissionAction,
  context: {
    agentId: string;
    gatewayId: string;
    commandId: string;
    relayUrl: string;
    relayApiKey: string;
  }
): Promise<PermissionCheckResult> {
  // Check permission rules
  const permCheck = checkPermission(path, action);

  // Operation denied outright
  if (!permCheck.allowed && !permCheck.requiresApproval) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: permCheck.rule?.reason || "Operation not allowed",
    };
  }

  // Operation allowed without approval
  if (permCheck.allowed && !permCheck.requiresApproval) {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  // Operation requires approval - create approval request
  console.log(`   🔒 Permission required: ${action} on ${path}`);
  console.log(`   📋 Reason: ${permCheck.rule?.reason}`);

  try {
    const approval = await createApprovalRequest({
      agentId: context.agentId,
      gatewayId: context.gatewayId,
      commandId: context.commandId,
      path,
      action,
      reason: permCheck.rule?.reason || "Approval required",
      relayUrl: context.relayUrl,
      relayApiKey: context.relayApiKey,
    });

    console.log(`   ⏳ Approval request created: ${approval.id}`);
    console.log(`   ⏰ Expires at: ${new Date(approval.expiresAt).toLocaleString()}`);

    return {
      allowed: false,
      requiresApproval: true,
      reason: permCheck.rule?.reason,
      approvalId: approval.id,
    };
  } catch (error) {
    console.error(`   ❌ Failed to create approval request:`, error);
    return {
      allowed: false,
      requiresApproval: false,
      reason: "Failed to request approval",
    };
  }
}

/**
 * Wait for approval decision
 */
export async function waitForApprovalDecision(
  approvalId: string,
  context: {
    relayUrl: string;
    relayApiKey: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }
): Promise<{ approved: boolean; status: string }> {
  const pollInterval = context.pollIntervalMs || 2000; // 2 seconds
  const timeout = context.timeoutMs || 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();

  console.log(`   ⏳ Waiting for approval decision (timeout: ${Math.round(timeout / 1000)}s)...`);

  while (Date.now() - startTime < timeout) {
    try {
      const approval = await getApprovalStatus(approvalId, context.relayUrl, context.relayApiKey);

      if (approval.status === "approved") {
        console.log(`   ✅ Approval granted by ${approval.respondedBy || "user"}`);
        return { approved: true, status: "approved" };
      }

      if (approval.status === "denied") {
        console.log(`   ❌ Approval denied by ${approval.respondedBy || "user"}`);
        return { approved: false, status: "denied" };
      }

      if (approval.status === "expired") {
        console.log(`   ⏰ Approval expired`);
        return { approved: false, status: "expired" };
      }

      // Still pending, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      console.error(`   ⚠️ Error checking approval status:`, error);
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  // Timeout reached
  console.log(`   ⏰ Approval timeout reached`);
  return { approved: false, status: "timeout" };
}

// ─── API Helpers ──────────────────────────────────────────

async function createApprovalRequest(params: {
  agentId: string;
  gatewayId: string;
  commandId: string;
  path: string;
  action: PermissionAction;
  reason: string;
  relayUrl: string;
  relayApiKey: string;
}): Promise<ApprovalRequest> {
  const url = `${params.relayUrl}/api/permissions/approvals`;
  const body = {
    agentId: params.agentId,
    gatewayId: params.gatewayId,
    commandId: params.commandId,
    path: params.path,
    action: params.action,
    reason: params.reason,
  };

  const result = await apiCall(url, "POST", body, params.relayApiKey);
  return (result as { approval: ApprovalRequest }).approval;
}

async function getApprovalStatus(
  approvalId: string,
  relayUrl: string,
  relayApiKey: string
): Promise<ApprovalRequest> {
  const url = `${relayUrl}/api/permissions/approvals/${approvalId}`;
  const result = await apiCall(url, "GET", undefined, relayApiKey);
  return (result as { approval: ApprovalRequest }).approval;
}

function apiCall(
  url: string,
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  apiKey?: string
): Promise<unknown> {
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
          ...(apiKey ? { "x-relay-key": apiKey } : {}),
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
            reject(new Error("Invalid JSON response"));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.on("error", reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Parse tool calls from Claude executor to extract file paths
 * Returns paths that need permission checking
 */
export function extractPathsFromToolCall(toolName: string, input: Record<string, unknown>): Array<{ path: string; action: PermissionAction }> {
  const paths: Array<{ path: string; action: PermissionAction }> = [];

  switch (toolName) {
    case "Read":
      if (input.file_path) {
        paths.push({ path: String(input.file_path), action: "read" });
      }
      break;
    case "Write":
      if (input.file_path) {
        paths.push({ path: String(input.file_path), action: "write" });
      }
      break;
    case "Edit":
      if (input.file_path) {
        paths.push({ path: String(input.file_path), action: "write" });
      }
      break;
    case "Bash":
      // Parse bash commands for file operations
      if (input.command) {
        const cmd = String(input.command);
        // Check for dangerous commands (rm, git, etc.)
        if (/\b(rm|git|mv|cp)\b/.test(cmd)) {
          // Extract file paths from command (simplified parsing)
          const match = cmd.match(/\b(?:rm|git|mv|cp)\s+(.+)/);
          if (match) {
            paths.push({ path: match[1].trim(), action: "write" });
          }
        }
      }
      break;
  }

  return paths;
}
