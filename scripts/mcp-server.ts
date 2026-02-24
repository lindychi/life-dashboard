#!/usr/bin/env npx tsx

/**
 * Life Dashboard MCP Server
 *
 * Exposes the Life Dashboard Relay API as tools for Claude Code agents.
 *
 * Dependencies required (not yet installed):
 * - @modelcontextprotocol/sdk
 * - zod
 *
 * Install with: pnpm add @modelcontextprotocol/sdk zod
 *
 * Run with: npx ts-node scripts/mcp-server.ts
 */

import * as path from "path";
import { execFileSync } from "child_process";
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

// Project root directory (one level up from scripts/)
const PROJECT_ROOT = path.resolve(__dirname, "..");

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { sendMessageWithAttachments, uploadAttachment } from "./mcp-attachments";

// Configuration — validate URL is not a literal unexpanded variable
const rawUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
const DASHBOARD_URL = rawUrl.startsWith("http") ? rawUrl : "http://localhost:3000";
if (!rawUrl.startsWith("http")) {
  console.error(`Warning: DASHBOARD_URL="${rawUrl}" is not a valid URL, falling back to localhost`);
}
const RELAY_API_KEY = process.env.RELAY_API_KEY || "dev-relay-key";

// Helper function for API calls
async function apiCall(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<unknown> {
  const url = `${DASHBOARD_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": RELAY_API_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${method} ${url}`, error);
    throw error;
  }
}

// Zod schemas for tool parameters
const GetHistorySchema = z.object({
  agentId: z.string().optional().describe("Agent ID to filter by (omit for all agents)"),
  limit: z.number().default(20).describe("Maximum number of entries to return"),
  excludeTypes: z.array(z.string()).optional().describe("Exclude event types from results (e.g., ['output'])"),
});

const GetAgentsSchema = z.object({
  category: z.enum(["dev", "business", "ops"]).optional().describe("Filter by agent category"),
  includeDisabled: z.boolean().optional().describe("Include disabled agents"),
});

const GetMessagesSchema = z.object({
  agentId: z.string().describe("Agent ID to get messages for"),
  unreadOnly: z.boolean().optional().describe("Only return unread messages"),
});

const AddHistorySchema = z.object({
  agentId: z.string().describe("Agent ID"),
  type: z.enum([
    "task_started",
    "task_completed",
    "task_failed",
    "output",
    "status_change",
  ]).describe("Type of history entry"),
  content: z.string().describe("Content of the history entry"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Additional metadata"),
  requestGroupId: z.string().uuid().optional().describe("UUID to group related history entries together"),
  requestTitle: z.string().max(200).optional().describe("Human-readable title for the request group"),
});

const SendMessageSchema = z.object({
  from: z.string().describe("Sender agent ID"),
  to: z.string().describe("Recipient agent ID"),
  content: z.string().describe("Message content"),
  type: z.string().default("text").describe("Message type"),
  attachments: z.array(z.object({
    filePath: z.string().describe("Local file path to attach"),
    refKey: z.string().optional().describe("Custom ref_key"),
  })).optional().describe("Files to upload and attach to the message. Each file gets a ref_key that is auto-appended to the message content as @file:ref_key"),
});

const UploadAttachmentSchema = z.object({
  filePath: z.string().describe("Local file path to upload"),
  refKey: z.string().optional().describe("Custom ref_key for the attachment (auto-generated if omitted)"),
});

const SendCommandSchema = z.object({
  type: z.enum(["spawn", "orchestrate", "status"]).describe("Command type"),
  payload: z.record(z.string(), z.unknown()).describe("Command payload"),
});

const SearchHistorySchema = z.object({
  query: z.string().describe("Search query"),
  agentId: z.string().optional().describe("Filter by agent ID"),
  limit: z.number().default(20).describe("Maximum number of results"),
});

const GetTimelineSchema = z.object({
  agentId: z.string().optional().describe("Filter by agent ID"),
  types: z.array(z.string()).optional().describe("Filter by event types (e.g., ['task_started', 'task_completed'])"),
  excludeTypes: z.array(z.string()).optional().describe("Exclude event types (e.g., ['output'] to hide noise)"),
  search: z.string().optional().describe("Search text in content (case-insensitive)"),
  dateFrom: z.string().optional().describe("Filter entries after this ISO date"),
  dateTo: z.string().optional().describe("Filter entries before this ISO date"),
  cursor: z.string().optional().describe("Cursor for pagination (ISO timestamp from previous response)"),
  limit: z.number().default(50).describe("Maximum number of entries to return"),
});

const BuildAndTestSchema = z.object({});

const GitCommitSchema = z.object({
  files: z.array(z.string()).min(1).describe("File paths to stage and commit (relative to project root)"),
  message: z.string().min(1).describe("Commit message"),
});

const DeploySchema = z.object({
  files: z.array(z.string()).optional().describe("File paths to stage and commit before deploying"),
  message: z.string().optional().default("deploy: agent-initiated deployment").describe("Commit message"),
  skipTests: z.boolean().optional().default(false).describe("Skip build/test step"),
});

const GatewayRestartSchema = z.object({});

// Security: validate that a file path is within the project directory
function validateProjectPath(filePath: string): string {
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    throw new Error(`Path "${filePath}" resolves outside the project directory`);
  }
  return resolved;
}

// Helper: run a command safely and return stdout
function runCommand(cmd: string, args: string[], options?: { cwd?: string }): string {
  return execFileSync(cmd, args, {
    cwd: options?.cwd ?? PROJECT_ROOT,
    encoding: "utf-8",
    timeout: 300_000, // 5 minute timeout
    maxBuffer: 10 * 1024 * 1024, // 10MB
    env: { ...process.env, FORCE_COLOR: "0" },
  });
}

// Create MCP server
const server = new Server(
  {
    name: "life-dashboard",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "dashboard_get_history",
        description: "Get history entries for all agents or a specific agent",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID to filter by (omit for all agents)",
            },
            limit: {
              type: "number",
              description: "Maximum number of entries to return",
              default: 20,
            },
            excludeTypes: {
              type: "array",
              items: { type: "string" },
              description: "Exclude event types from results (e.g., ['output'])",
            },
          },
        },
      },
      {
        name: "dashboard_get_agents",
        description: "List all agent configurations",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["dev", "business", "ops"],
              description: "Filter by agent category",
            },
            includeDisabled: {
              type: "boolean",
              description: "Include disabled agents",
            },
          },
        },
      },
      {
        name: "dashboard_get_status",
        description: "Get gateway connection status and live agent statuses",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "dashboard_get_messages",
        description: "Get messages for an agent",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID to get messages for",
            },
            unreadOnly: {
              type: "boolean",
              description: "Only return unread messages",
            },
          },
          required: ["agentId"],
        },
      },
      {
        name: "dashboard_add_history",
        description: "Add a history entry",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "Agent ID",
            },
            type: {
              type: "string",
              enum: [
                "task_started",
                "task_completed",
                "task_failed",
                "output",
                "status_change",
              ],
              description: "Type of history entry",
            },
            content: {
              type: "string",
              description: "Content of the history entry",
            },
            metadata: {
              type: "object",
              description: "Additional metadata",
            },
            requestGroupId: {
              type: "string",
              description: "UUID to group related history entries together",
            },
            requestTitle: {
              type: "string",
              description: "Human-readable title for the request group (max 200 chars)",
            },
          },
          required: ["agentId", "type", "content"],
        },
      },
      {
        name: "dashboard_send_message",
        description: "Send a message between agents. Supports file attachments via the 'attachments' option - files are uploaded and their @file:ref_key references are appended to the message content.",
        inputSchema: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description: "Sender agent ID",
            },
            to: {
              type: "string",
              description: "Recipient agent ID",
            },
            content: {
              type: "string",
              description: "Message content",
            },
            type: {
              type: "string",
              description: "Message type",
              default: "text",
            },
            attachments: {
              type: "array",
              description: "Files to upload and attach. Each file gets a ref_key auto-appended to message content.",
              items: {
                type: "object",
                properties: {
                  filePath: {
                    type: "string",
                    description: "Local file path to attach",
                  },
                  refKey: {
                    type: "string",
                    description: "Custom ref_key (auto-generated if omitted)",
                  },
                },
                required: ["filePath"],
              },
            },
          },
          required: ["from", "to", "content"],
        },
      },
      {
        name: "dashboard_send_command",
        description: "Send a command to the gateway (spawn task, orchestrate, etc)",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["spawn", "orchestrate", "status"],
              description: "Command type",
            },
            payload: {
              type: "object",
              description: "Command payload",
            },
          },
          required: ["type", "payload"],
        },
      },
      {
        name: "dashboard_search_history",
        description: "Search history entries by content keyword",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            agentId: {
              type: "string",
              description: "Filter by agent ID",
            },
            limit: {
              type: "number",
              description: "Maximum number of results",
              default: 20,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "dashboard_upload_attachment",
        description: "Upload a file as an attachment. Returns a ref_key that can be used in messages with @file:ref_key syntax.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Local file path to upload",
            },
            refKey: {
              type: "string",
              description: "Custom ref_key for the attachment (auto-generated if omitted)",
            },
          },
          required: ["filePath"],
        },
      },
      {
        name: "dashboard_get_timeline",
        description: "Get filtered timeline history with cursor-based pagination. Supports filtering by agent, type, date range, and search text. Returns entries newest-first with a cursor for the next page.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: {
              type: "string",
              description: "Filter by agent ID",
            },
            types: {
              type: "array",
              items: { type: "string" },
              description: "Filter by event types (e.g., ['task_started', 'task_completed'])",
            },
            excludeTypes: {
              type: "array",
              items: { type: "string" },
              description: "Exclude event types (e.g., ['output'] to hide noise)",
            },
            search: {
              type: "string",
              description: "Search text in content (case-insensitive)",
            },
            dateFrom: {
              type: "string",
              description: "Filter entries after this ISO date",
            },
            dateTo: {
              type: "string",
              description: "Filter entries before this ISO date",
            },
            cursor: {
              type: "string",
              description: "Cursor for pagination (ISO timestamp from previous response)",
            },
            limit: {
              type: "number",
              description: "Maximum number of entries to return",
              default: 50,
            },
          },
        },
      },
      {
        name: "dashboard_build_and_test",
        description: "Run build and test in the project directory. Returns success/failure with output from pnpm build and pnpm test.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "dashboard_git_commit",
        description: "Stage specified files and create a git commit. Returns the commit hash on success.",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "File paths to stage and commit (relative to project root)",
            },
            message: {
              type: "string",
              description: "Commit message",
            },
          },
          required: ["files", "message"],
        },
      },
      {
        name: "dashboard_deploy",
        description: "Full deploy pipeline: optionally commit files, run build/test, push to main, and trigger Railway deployment. Returns structured results for each pipeline step.",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "File paths to stage and commit before deploying (optional)",
            },
            message: {
              type: "string",
              description: "Commit message (default: 'deploy: agent-initiated deployment')",
            },
            skipTests: {
              type: "boolean",
              description: "Skip build/test step (default: false)",
            },
          },
        },
      },
      {
        name: "dashboard_gateway_restart",
        description: "Restart the gateway connector process via launchctl. Requires the gateway to be managed by a launchd plist (com.lifedashboard.gateway-connector).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "dashboard_get_history": {
        const params = GetHistorySchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.agentId) queryParams.set("agentId", params.agentId);
        queryParams.set("limit", params.limit.toString());
        if (params.excludeTypes && params.excludeTypes.length > 0) {
          queryParams.set("excludeTypes", params.excludeTypes.join(","));
        }

        const data = await apiCall(`/api/relay/history?${queryParams}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_get_agents": {
        const params = GetAgentsSchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.category) queryParams.set("category", params.category);
        if (params.includeDisabled) queryParams.set("all", "true");

        const data = await apiCall(`/api/relay/agents?${queryParams}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_get_status": {
        const data = await apiCall("/api/relay/status");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_get_messages": {
        const params = GetMessagesSchema.parse(args);
        const queryParams = new URLSearchParams();
        queryParams.set("agentId", params.agentId);
        if (params.unreadOnly) queryParams.set("unreadOnly", "true");

        const data = await apiCall(`/api/relay/messages?${queryParams}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_add_history": {
        const params = AddHistorySchema.parse(args);
        const data = await apiCall("/api/relay/history", "POST", params);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_send_message": {
        const params = SendMessageSchema.parse(args);
        const data = await sendMessageWithAttachments({
          dashboardUrl: DASHBOARD_URL,
          relayApiKey: RELAY_API_KEY,
          from: params.from,
          to: params.to,
          content: params.content,
          type: params.type,
          attachments: params.attachments,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }
      case "dashboard_upload_attachment": {
        const params = UploadAttachmentSchema.parse(args);
        const data = await uploadAttachment({
          dashboardUrl: DASHBOARD_URL,
          relayApiKey: RELAY_API_KEY,
          filePath: params.filePath,
          refKey: params.refKey,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, ...data }, null, 2),
            },
          ],
        };
      }

      case "dashboard_send_command": {
        const params = SendCommandSchema.parse(args);
        const data = await apiCall("/api/relay/command", "POST", params);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_search_history": {
        const params = SearchHistorySchema.parse(args);
        const queryParams = new URLSearchParams();
        queryParams.set("q", params.query);
        if (params.agentId) queryParams.set("agentId", params.agentId);
        queryParams.set("limit", params.limit.toString());

        const data = await apiCall(`/api/relay/history/search?${queryParams}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_get_timeline": {
        const params = GetTimelineSchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.agentId) queryParams.set("agentId", params.agentId);
        if (params.types) queryParams.set("types", params.types.join(","));
        if (params.excludeTypes) queryParams.set("excludeTypes", params.excludeTypes.join(","));
        if (params.search) queryParams.set("search", params.search);
        if (params.dateFrom) queryParams.set("dateFrom", params.dateFrom);
        if (params.dateTo) queryParams.set("dateTo", params.dateTo);
        if (params.cursor) queryParams.set("cursor", params.cursor);
        queryParams.set("limit", params.limit.toString());

        const data = await apiCall(`/api/relay/timeline?${queryParams}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "dashboard_build_and_test": {
        BuildAndTestSchema.parse(args);
        const steps: { step: string; success: boolean; output: string }[] = [];

        try {
          const buildOutput = runCommand("pnpm", ["build"]);
          steps.push({ step: "build", success: true, output: buildOutput.slice(-2000) });
        } catch (err) {
          const msg = err instanceof Error ? (err as Error & { stdout?: string; stderr?: string }).stderr || err.message : String(err);
          steps.push({ step: "build", success: false, output: msg.slice(-2000) });
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, steps }, null, 2) }],
            isError: true,
          };
        }

        try {
          const testOutput = runCommand("pnpm", ["test", "--run"]);
          steps.push({ step: "test", success: true, output: testOutput.slice(-2000) });
        } catch (err) {
          const msg = err instanceof Error ? (err as Error & { stdout?: string; stderr?: string }).stderr || err.message : String(err);
          steps.push({ step: "test", success: false, output: msg.slice(-2000) });
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, steps }, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, steps }, null, 2) }],
        };
      }

      case "dashboard_git_commit": {
        const params = GitCommitSchema.parse(args);

        // Validate all file paths are within project
        const validatedFiles = params.files.map((f) => {
          validateProjectPath(f);
          return f;
        });

        // Stage files
        const addOutput = runCommand("git", ["add", "--", ...validatedFiles]);

        // Commit
        const commitOutput = runCommand("git", ["commit", "-m", params.message]);

        // Extract commit hash
        const hashOutput = runCommand("git", ["rev-parse", "HEAD"]);
        const commitHash = hashOutput.trim();

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              commitHash,
              addOutput: addOutput.trim(),
              commitOutput: commitOutput.trim(),
            }, null, 2),
          }],
        };
      }

      case "dashboard_deploy": {
        const params = DeploySchema.parse(args);
        const pipeline: { step: string; success: boolean; output: string }[] = [];

        // Step 1: Commit files if provided
        if (params.files && params.files.length > 0) {
          try {
            const validatedFiles = params.files.map((f) => {
              validateProjectPath(f);
              return f;
            });
            runCommand("git", ["add", "--", ...validatedFiles]);
            const commitOut = runCommand("git", ["commit", "-m", params.message]);
            const hash = runCommand("git", ["rev-parse", "HEAD"]).trim();
            pipeline.push({ step: "commit", success: true, output: `${hash}\n${commitOut.slice(-1000)}` });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pipeline.push({ step: "commit", success: false, output: msg.slice(-2000) });
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, pipeline }, null, 2) }],
              isError: true,
            };
          }
        }

        // Step 2: Build and test (unless skipped)
        if (!params.skipTests) {
          try {
            const buildOut = runCommand("pnpm", ["build"]);
            pipeline.push({ step: "build", success: true, output: buildOut.slice(-1000) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pipeline.push({ step: "build", success: false, output: msg.slice(-2000) });
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, pipeline }, null, 2) }],
              isError: true,
            };
          }

          try {
            const testOut = runCommand("pnpm", ["test", "--run"]);
            pipeline.push({ step: "test", success: true, output: testOut.slice(-1000) });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pipeline.push({ step: "test", success: false, output: msg.slice(-2000) });
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, pipeline }, null, 2) }],
              isError: true,
            };
          }
        }

        // Step 3: Push to origin main
        try {
          const pushOut = runCommand("git", ["push", "origin", "main"]);
          pipeline.push({ step: "push", success: true, output: pushOut.trim() || "Pushed to origin/main" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pipeline.push({ step: "push", success: false, output: msg.slice(-2000) });
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, pipeline }, null, 2) }],
            isError: true,
          };
        }

        // Step 4: Railway auto-deploys from git push, but try explicit deploy if available
        try {
          const railwayOut = runCommand("railway", ["up", "--detach"], { cwd: PROJECT_ROOT });
          pipeline.push({ step: "railway", success: true, output: railwayOut.trim() });
        } catch {
          // Railway CLI may not be available — auto-deploy from git push is the fallback
          pipeline.push({ step: "railway", success: true, output: "Skipped explicit railway deploy (auto-deploy from git push)" });
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, pipeline }, null, 2) }],
        };
      }

      case "dashboard_gateway_restart": {
        GatewayRestartSchema.parse(args);

        try {
          // Get current user ID for launchctl
          const uid = runCommand("id", ["-u"]).trim();
          const serviceLabel = "com.lifedashboard.gateway-connector";
          const restartOut = runCommand("launchctl", ["kickstart", "-k", `gui/${uid}/${serviceLabel}`]);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                output: restartOut.trim() || `Restarted ${serviceLabel}`,
              }, null, 2),
            }],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: msg,
                hint: "Ensure the gateway connector is managed by launchd with label com.lifedashboard.gateway-connector",
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${error.message}`
      );
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Life Dashboard MCP Server running on stdio");
}

// Only run main if this is the entry point (not imported for testing)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/mcp-server.ts') || process.argv[1]?.endsWith('/mcp-server.js')) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

// Export server for testing
export { server };
