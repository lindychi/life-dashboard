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
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
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
  requestTitle: z.string().max(200).optional().describe("Human-readable title for the request group (max 200 chars). If omitted, auto-generated from content by analyzing keywords and summarizing"),
});

const SendMessageSchema = z.object({
  from: z.string().min(1, "Sender agent ID must not be empty").describe("Sender agent ID"),
  to: z.string().min(1, "Recipient agent ID must not be empty").describe("Recipient agent ID"),
  content: z.string().min(1, "Message content must not be empty").max(100_000, "Message content exceeds 100,000 character limit").describe("Message content"),
  type: z.enum(["text", "task", "result", "question", "answer"]).default("text").describe("Message type"),
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
  attachments: z.array(z.object({
    filePath: z.string().describe("Local file path to attach"),
    refKey: z.string().optional().describe("Custom ref_key"),
  })).optional().describe("Files to upload and attach to the command. Each file is uploaded, assigned a ref_key, and the @file:ref_key reference is auto-injected into the task/instruction content."),
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
  requestGroupId: z.string().uuid().optional().describe("Filter by request group UUID to see all entries in a specific request group"),
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

const ForceRetryTaskSchema = z.object({
  taskId: z.string().describe("Task execution ID to retry"),
  reason: z.string().optional().describe("Optional reason for manual retry"),
});

// Project CRUD schemas
const GetProjectsSchema = z.object({
  status: z.string().optional().describe("Filter by project status (e.g., 'idea', 'in-progress', 'completed')"),
});

const GetProjectSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
});

const CreateProjectSchema = z.object({
  name: z.string().min(1).describe("Project name"),
  description: z.string().min(1).describe("Project description"),
  status: z.string().optional().default("idea").describe("Project status (default: 'idea')"),
  progress: z.number().min(0).max(100).optional().default(0).describe("Project progress (0-100)"),
  url: z.string().optional().describe("Project URL"),
  kpis: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional().default([]).describe("Key Performance Indicators"),
});

const UpdateProjectSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
  name: z.string().optional().describe("Project name"),
  description: z.string().optional().describe("Project description"),
  status: z.string().optional().describe("Project status"),
  progress: z.number().min(0).max(100).optional().describe("Project progress (0-100)"),
  url: z.string().optional().describe("Project URL"),
  kpis: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional().describe("Key Performance Indicators"),
});

const DeleteProjectSchema = z.object({
  projectId: z.string().uuid().describe("Project ID to delete"),
});

// Project metrics schemas
const GetProjectMetricsSchema = z.object({
  projectId: z.string().optional().describe("Filter by specific project ID (omit for all projects)"),
});

const GetProjectMetricsHistorySchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
  limit: z.number().default(100).describe("Maximum number of history entries to return"),
});

const SnapshotProjectMetricsSchema = z.object({
  projectId: z.string().uuid().describe("Project ID to create snapshot for"),
});

const LinkTaskToProjectSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
  taskExecutionId: z.string().uuid().optional().describe("Task execution ID to link"),
  taskQueueId: z.string().uuid().optional().describe("Task queue ID to link"),
  metadata: z.object({
    task_title: z.string().optional(),
    task_status: z.string().optional(),
    task_type: z.string().optional(),
  }).optional().describe("Optional task metadata"),
});

const GetProjectTasksSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
  limit: z.number().default(50).describe("Maximum number of tasks to return"),
});

// OKR Schemas
const GetObjectivesSchema = z.object({
  status: z.enum(["active", "completed", "cancelled", "archived"]).optional().describe("Filter by objective status"),
});

const CreateObjectiveSchema = z.object({
  title: z.string().describe("Objective title"),
  description: z.string().optional().describe("Objective description"),
  period_type: z.enum(["quarterly", "annual", "custom"]).describe("Period type"),
  start_date: z.string().describe("Start date (YYYY-MM-DD)"),
  end_date: z.string().describe("End date (YYYY-MM-DD)"),
  status: z.enum(["active", "completed", "cancelled", "archived"]).optional().describe("Objective status"),
  owner: z.string().optional().describe("Owner name"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
});

const UpdateObjectiveSchema = z.object({
  objectiveId: z.string().uuid().describe("Objective ID"),
  title: z.string().optional().describe("Objective title"),
  description: z.string().optional().describe("Objective description"),
  period_type: z.enum(["quarterly", "annual", "custom"]).optional().describe("Period type"),
  start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
  status: z.enum(["active", "completed", "cancelled", "archived"]).optional().describe("Objective status"),
  owner: z.string().optional().describe("Owner name"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
});

const GetObjectiveSchema = z.object({
  objectiveId: z.string().uuid().describe("Objective ID"),
});

const CreateKeyResultSchema = z.object({
  objective_id: z.string().uuid().describe("Objective ID"),
  title: z.string().describe("Key result title"),
  description: z.string().optional().describe("Key result description"),
  metric_type: z.enum(["percentage", "number", "boolean", "currency"]).describe("Metric type"),
  target_value: z.number().describe("Target value to achieve"),
  current_value: z.number().optional().describe("Current progress value"),
  unit: z.string().optional().describe("Unit of measurement (e.g., 'users', 'revenue', '%')"),
  status: z.enum(["active", "completed", "at_risk", "off_track"]).optional().describe("Key result status"),
  weight: z.number().min(0).max(100).optional().describe("Weight for calculating objective progress (sum should be 100)"),
});

const UpdateKeyResultSchema = z.object({
  keyResultId: z.string().uuid().describe("Key result ID"),
  title: z.string().optional().describe("Key result title"),
  description: z.string().optional().describe("Key result description"),
  metric_type: z.enum(["percentage", "number", "boolean", "currency"]).optional().describe("Metric type"),
  target_value: z.number().optional().describe("Target value to achieve"),
  current_value: z.number().optional().describe("Current progress value"),
  unit: z.string().optional().describe("Unit of measurement"),
  status: z.enum(["active", "completed", "at_risk", "off_track"]).optional().describe("Key result status"),
  weight: z.number().min(0).max(100).optional().describe("Weight for calculating objective progress"),
});

const LinkProjectObjectiveSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
  objectiveId: z.string().uuid().describe("Objective ID"),
  relevantKeyResultIds: z.array(z.string().uuid()).optional().describe("Relevant key result IDs for this project"),
});

const GetProjectObjectivesSchema = z.object({
  projectId: z.string().uuid().describe("Project ID"),
});

// Conversation Session Schemas
const CreateConversationSchema = z.object({
  title: z.string().min(1).describe("Conversation title"),
  participants: z.array(z.string()).min(1).describe("Array of participant IDs (agent IDs or 'user')"),
  context: z.record(z.string(), z.unknown()).optional().describe("Session context data (project info, goals, etc.)"),
  createdBy: z.string().describe("Creator ID (agent ID or 'user')"),
});

const GetConversationsSchema = z.object({
  participantId: z.string().optional().describe("Filter by participant ID"),
  status: z.enum(["active", "archived", "completed"]).optional().describe("Filter by status"),
  createdBy: z.string().optional().describe("Filter by creator ID"),
  limit: z.number().optional().describe("Maximum number of conversations to return"),
});

const GetConversationSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID"),
  includeStats: z.boolean().optional().describe("Include statistics (message count, read status)"),
});

const UpdateConversationSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID"),
  title: z.string().optional().describe("New title"),
  context: z.record(z.string(), z.unknown()).optional().describe("Context updates (merged with existing)"),
  status: z.enum(["active", "archived", "completed"]).optional().describe("New status"),
});

const DeleteConversationSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID to delete"),
});

const AddConversationMessageSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID"),
  from: z.string().describe("Sender ID (agent ID or 'user')"),
  content: z.string().min(1).describe("Message content"),
  type: z.enum(["text", "task", "result", "question", "answer", "system"]).optional().describe("Message type"),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Additional metadata (model info, token usage, etc.)"),
  parentMessageId: z.string().uuid().optional().describe("Parent message ID for threading"),
});

const GetConversationMessagesSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID"),
  limit: z.number().optional().describe("Maximum number of messages to return"),
  since: z.string().optional().describe("ISO timestamp - only return messages after this time"),
  parentMessageId: z.string().uuid().optional().describe("Filter by parent message ID (null for top-level only)"),
});

const UpdateConversationReadStatusSchema = z.object({
  conversationId: z.string().uuid().describe("Conversation ID"),
  agentId: z.string().describe("Agent ID"),
  lastReadMessageId: z.string().uuid().describe("ID of the last message read"),
});

const GetUnreadConversationsSchema = z.object({
  agentId: z.string().describe("Agent ID to check unread conversations for"),
});

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
        description: "Send a command to the gateway (spawn task, orchestrate, etc). Supports file attachments via the 'attachments' option - files are uploaded and their @file:ref_key references are appended to the task/instruction content.",
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
            attachments: {
              type: "array",
              description: "Files to upload and attach. Each file gets a ref_key auto-appended to task/instruction content.",
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
        name: "dashboard_submit_task_feedback",
        description: "Submit user satisfaction feedback for a completed task. Rating is 'good' or 'bad'. Provider identity is hidden — this is purely a quality signal. Used to internally optimize which provider handles which task types.",
        inputSchema: {
          type: "object",
          properties: {
            commandId: {
              type: "string",
              description: "The command ID of the completed task",
            },
            rating: {
              type: "string",
              enum: ["good", "bad"],
              description: "User satisfaction rating",
            },
          },
          required: ["commandId", "rating"],
        },
      },
      {
        name: "dashboard_get_provider_stats",
        description: "Get provider performance statistics (internal). Shows satisfaction rates, success rates, and recommended providers per task category.",
        inputSchema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description: "Task category to get stats for (optional, returns all if omitted)",
            },
            windowDays: {
              type: "number",
              description: "Number of days to look back (default: 30)",
            },
          },
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
            requestGroupId: {
              type: "string",
              description: "Filter by request group UUID to see all entries in a specific request group",
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
        description: "Full deploy pipeline: optionally commit files, run build/test, push to main, and trigger Railway deployment. Returns structured results for each pipeline step. On failure, includes build/deploy logs for diagnosis.",
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
      {
        name: "dashboard_force_retry_task",
        description: "Manually retry a specific interrupted or failed task. Useful when recovering from gateway restart or identifying lost work.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Task execution ID to retry (from task_executions table)",
            },
            reason: {
              type: "string",
              description: "Optional reason for manual retry (for audit trail)",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "dashboard_get_projects",
        description: "Get list of all projects. Optional status filter.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Filter by project status (e.g., 'idea', 'in-progress', 'completed')",
            },
          },
        },
      },
      {
        name: "dashboard_get_project",
        description: "Get a single project by ID.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_create_project",
        description: "Create a new project in Life Dashboard.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Project name",
            },
            description: {
              type: "string",
              description: "Project description",
            },
            status: {
              type: "string",
              description: "Project status (default: 'idea')",
            },
            progress: {
              type: "number",
              description: "Project progress (0-100, default: 0)",
            },
            url: {
              type: "string",
              description: "Project URL",
            },
            kpis: {
              type: "array",
              description: "Key Performance Indicators",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
                required: ["label", "value"],
              },
            },
          },
          required: ["name", "description"],
        },
      },
      {
        name: "dashboard_update_project",
        description: "Update an existing project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID",
            },
            name: {
              type: "string",
              description: "Project name",
            },
            description: {
              type: "string",
              description: "Project description",
            },
            status: {
              type: "string",
              description: "Project status",
            },
            progress: {
              type: "number",
              description: "Project progress (0-100)",
            },
            url: {
              type: "string",
              description: "Project URL",
            },
            kpis: {
              type: "array",
              description: "Key Performance Indicators",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                },
                required: ["label", "value"],
              },
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_delete_project",
        description: "Delete a project by ID.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID to delete",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_get_project_metrics",
        description: "Get real-time KPI metrics for projects. Returns calculated metrics (completion rate, success rate, task counts, etc.) based on linked task executions. If projectId is omitted, returns metrics for all projects.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Filter by specific project ID (omit for all projects)",
            },
          },
        },
      },
      {
        name: "dashboard_get_project_metrics_history",
        description: "Get historical metrics snapshots for a project (time-series data). Returns up to 'limit' snapshots ordered by snapshot_at DESC.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID",
            },
            limit: {
              type: "number",
              description: "Maximum number of history entries to return",
              default: 100,
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_snapshot_project_metrics",
        description: "Create a new metrics snapshot for a project. Calculates current metrics and stores them in the project_metrics table for historical tracking.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID to create snapshot for",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_link_task_to_project",
        description: "Link a task (from task_executions or task_queue) to a project. This enables automatic metrics calculation for the project based on task execution status. Either taskExecutionId or taskQueueId must be provided.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID",
            },
            taskExecutionId: {
              type: "string",
              description: "Task execution ID to link",
            },
            taskQueueId: {
              type: "string",
              description: "Task queue ID to link",
            },
            metadata: {
              type: "object",
              properties: {
                task_title: {
                  type: "string",
                },
                task_status: {
                  type: "string",
                },
                task_type: {
                  type: "string",
                },
              },
              description: "Optional task metadata",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_get_project_tasks",
        description: "Get list of tasks linked to a project. Returns up to 'limit' tasks ordered by created_at DESC.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Project ID",
            },
            limit: {
              type: "number",
              description: "Maximum number of tasks to return",
              default: 50,
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_get_objectives",
        description: "Get all objectives, optionally filtered by status.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["active", "completed", "cancelled", "archived"],
              description: "Filter by objective status",
            },
          },
        },
      },
      {
        name: "dashboard_get_objective",
        description: "Get objective by ID with its key results.",
        inputSchema: {
          type: "object",
          properties: {
            objectiveId: {
              type: "string",
              description: "Objective ID",
            },
          },
          required: ["objectiveId"],
        },
      },
      {
        name: "dashboard_create_objective",
        description: "Create a new objective.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Objective title" },
            description: { type: "string", description: "Objective description" },
            period_type: {
              type: "string",
              enum: ["quarterly", "annual", "custom"],
              description: "Period type",
            },
            start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
            end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
            status: {
              type: "string",
              enum: ["active", "completed", "cancelled", "archived"],
              description: "Objective status",
            },
            owner: { type: "string", description: "Owner name" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization",
            },
          },
          required: ["title", "period_type", "start_date", "end_date"],
        },
      },
      {
        name: "dashboard_update_objective",
        description: "Update an existing objective.",
        inputSchema: {
          type: "object",
          properties: {
            objectiveId: { type: "string", description: "Objective ID" },
            title: { type: "string", description: "Objective title" },
            description: { type: "string", description: "Objective description" },
            period_type: {
              type: "string",
              enum: ["quarterly", "annual", "custom"],
              description: "Period type",
            },
            start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
            end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
            status: {
              type: "string",
              enum: ["active", "completed", "cancelled", "archived"],
              description: "Objective status",
            },
            owner: { type: "string", description: "Owner name" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tags for categorization",
            },
          },
          required: ["objectiveId"],
        },
      },
      {
        name: "dashboard_create_key_result",
        description: "Create a new key result for an objective. Progress is auto-calculated from current_value/target_value.",
        inputSchema: {
          type: "object",
          properties: {
            objective_id: { type: "string", description: "Objective ID" },
            title: { type: "string", description: "Key result title" },
            description: { type: "string", description: "Key result description" },
            metric_type: {
              type: "string",
              enum: ["percentage", "number", "boolean", "currency"],
              description: "Metric type",
            },
            target_value: { type: "number", description: "Target value to achieve" },
            current_value: { type: "number", description: "Current progress value" },
            unit: { type: "string", description: "Unit (e.g., 'users', '%', '$')" },
            status: {
              type: "string",
              enum: ["active", "completed", "at_risk", "off_track"],
              description: "Key result status",
            },
            weight: {
              type: "number",
              description: "Weight for objective progress (0-100, sum=100)",
            },
          },
          required: ["objective_id", "title", "metric_type", "target_value"],
        },
      },
      {
        name: "dashboard_update_key_result",
        description: "Update an existing key result. Progress auto-recalculates on value change.",
        inputSchema: {
          type: "object",
          properties: {
            keyResultId: { type: "string", description: "Key result ID" },
            title: { type: "string", description: "Key result title" },
            description: { type: "string", description: "Key result description" },
            metric_type: {
              type: "string",
              enum: ["percentage", "number", "boolean", "currency"],
              description: "Metric type",
            },
            target_value: { type: "number", description: "Target value" },
            current_value: { type: "number", description: "Current value" },
            unit: { type: "string", description: "Unit" },
            status: {
              type: "string",
              enum: ["active", "completed", "at_risk", "off_track"],
              description: "Key result status",
            },
            weight: { type: "number", description: "Weight (0-100)" },
          },
          required: ["keyResultId"],
        },
      },
      {
        name: "dashboard_link_project_objective",
        description: "Link a project to an objective, optionally specifying relevant key results.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project ID" },
            objectiveId: { type: "string", description: "Objective ID" },
            relevantKeyResultIds: {
              type: "array",
              items: { type: "string" },
              description: "Relevant key result IDs",
            },
          },
          required: ["projectId", "objectiveId"],
        },
      },
      {
        name: "dashboard_get_project_objectives",
        description: "Get all objectives linked to a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project ID" },
          },
          required: ["projectId"],
        },
      },
      {
        name: "dashboard_create_conversation",
        description: "Create a new conversation session with context management.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Conversation title" },
            participants: {
              type: "array",
              items: { type: "string" },
              description: "Array of participant IDs (agent IDs or 'user')"
            },
            context: {
              type: "object",
              description: "Session context data (project info, goals, etc.)"
            },
            createdBy: { type: "string", description: "Creator ID (agent ID or 'user')" },
          },
          required: ["title", "participants", "createdBy"],
        },
      },
      {
        name: "dashboard_get_conversations",
        description: "Get list of conversation sessions with optional filters.",
        inputSchema: {
          type: "object",
          properties: {
            participantId: { type: "string", description: "Filter by participant ID" },
            status: {
              type: "string",
              enum: ["active", "archived", "completed"],
              description: "Filter by status"
            },
            createdBy: { type: "string", description: "Filter by creator ID" },
            limit: { type: "number", description: "Maximum number of conversations" },
          },
        },
      },
      {
        name: "dashboard_get_conversation",
        description: "Get a specific conversation session with optional statistics.",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
            includeStats: { type: "boolean", description: "Include statistics (message count, read status)" },
          },
          required: ["conversationId"],
        },
      },
      {
        name: "dashboard_update_conversation",
        description: "Update conversation title, context, or status.",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
            title: { type: "string", description: "New title" },
            context: { type: "object", description: "Context updates (merged with existing)" },
            status: {
              type: "string",
              enum: ["active", "archived", "completed"],
              description: "New status"
            },
          },
          required: ["conversationId"],
        },
      },
      {
        name: "dashboard_delete_conversation",
        description: "Delete a conversation session and all its messages.",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID to delete" },
          },
          required: ["conversationId"],
        },
      },
      {
        name: "dashboard_add_conversation_message",
        description: "Add a message to a conversation session with threading support.",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
            from: { type: "string", description: "Sender ID (agent ID or 'user')" },
            content: { type: "string", description: "Message content" },
            type: {
              type: "string",
              enum: ["text", "task", "result", "question", "answer", "system"],
              description: "Message type"
            },
            metadata: { type: "object", description: "Additional metadata" },
            parentMessageId: { type: "string", description: "Parent message ID for threading" },
          },
          required: ["conversationId", "from", "content"],
        },
      },
      {
        name: "dashboard_get_conversation_messages",
        description: "Get messages from a conversation session with pagination and filtering.",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
            limit: { type: "number", description: "Maximum number of messages" },
            since: { type: "string", description: "ISO timestamp - only return messages after this time" },
            parentMessageId: { type: "string", description: "Filter by parent message ID" },
          },
          required: ["conversationId"],
        },
      },
      {
        name: "dashboard_update_conversation_read_status",
        description: "Update read status for a conversation (marks messages as read).",
        inputSchema: {
          type: "object",
          properties: {
            conversationId: { type: "string", description: "Conversation ID" },
            agentId: { type: "string", description: "Agent ID" },
            lastReadMessageId: { type: "string", description: "ID of the last message read" },
          },
          required: ["conversationId", "agentId", "lastReadMessageId"],
        },
      },
      {
        name: "dashboard_get_unread_conversations",
        description: "Get all conversations with unread messages for a specific agent.",
        inputSchema: {
          type: "object",
          properties: {
            agentId: { type: "string", description: "Agent ID to check unread conversations for" },
          },
          required: ["agentId"],
        },
      },
      {
        name: "dashboard_browse_url",
        description: "Browse a URL using headless Chrome. Launches a browser session, navigates to the URL, waits for the page to load, and returns the page title, text content, and optionally a screenshot. Use this for web research, scraping, or monitoring tasks.",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to navigate to",
            },
            waitMs: {
              type: "number",
              description: "Milliseconds to wait after page load (default: 2000)",
            },
            screenshot: {
              type: "boolean",
              description: "Whether to take a screenshot (default: false). Returns base64 PNG.",
            },
            sessionId: {
              type: "string",
              description: "Optional session ID to reuse an existing browser session. If omitted, creates a new session.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "dashboard_browser_screenshot",
        description: "Take a screenshot of the current page in an active browser session. Returns base64-encoded PNG image.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "The browser session ID",
            },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "dashboard_browser_close",
        description: "Close an active browser session and free resources.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: {
              type: "string",
              description: "The browser session ID to close",
            },
          },
          required: ["sessionId"],
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

      case "dashboard_submit_task_feedback": {
        const { commandId, rating } = args as { commandId: string; rating: "good" | "bad" };
        if (!commandId || !rating) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "commandId and rating required" }) }] };
        }
        try {
          const { recordProviderFeedback } = await import("./provider-feedback");
          const success = recordProviderFeedback({ commandId, rating, timestamp: new Date() });
          return { content: [{ type: "text", text: JSON.stringify({ success }) }] };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify({ error: String(error) }) }] };
        }
      }

      case "dashboard_get_provider_stats": {
        const { category, windowDays } = args as { category?: string; windowDays?: number };
        try {
          const { getProviderScores, getCategoryProviderScores } = await import("./provider-feedback");
          if (category) {
            const scores = getCategoryProviderScores(category, windowDays);
            return { content: [{ type: "text", text: JSON.stringify(scores, null, 2) }] };
          }
          const scores = getProviderScores(windowDays);
          return { content: [{ type: "text", text: JSON.stringify(scores, null, 2) }] };
        } catch (error) {
          return { content: [{ type: "text", text: JSON.stringify({ error: String(error) }) }] };
        }
      }

      case "dashboard_send_command": {
        const params = SendCommandSchema.parse(args);

        // Upload attachments first, collect ref_keys
        let attachmentRefs: Array<{ refKey: string }> | undefined;
        if (params.attachments && params.attachments.length > 0) {
          attachmentRefs = [];
          for (const att of params.attachments) {
            const result = await uploadAttachment({
              dashboardUrl: DASHBOARD_URL,
              relayApiKey: RELAY_API_KEY,
              filePath: att.filePath,
              refKey: att.refKey,
            });
            attachmentRefs.push({ refKey: result.refKey });
          }
        }

        // Auto-create request group for spawn/orchestrate commands
        let enrichedPayload = { ...params.payload } as Record<string, unknown>;
        let requestGroupInfo: { requestGroupId: string; requestTitle: string } | undefined;

        if (
          (params.type === "spawn" || params.type === "orchestrate") &&
          !enrichedPayload.requestGroupId
        ) {
          const taskContent =
            (enrichedPayload.task as string) ||
            (enrichedPayload.instruction as string) ||
            "";

          if (taskContent) {
            try {
              const groupResult = await apiCall("/api/request-groups", "POST", {
                content: taskContent,
              }) as { success?: boolean; group?: { id: string; title: string } };

              if (groupResult?.success && groupResult.group) {
                enrichedPayload.requestGroupId = groupResult.group.id;
                enrichedPayload.requestTitle = groupResult.group.title;
                requestGroupInfo = {
                  requestGroupId: groupResult.group.id,
                  requestTitle: groupResult.group.title,
                };
              }
            } catch (err) {
              // Request group creation is best-effort; don't block command
              console.error("Failed to auto-create request group:", err);
            }
          }
        }

        const data = await apiCall("/api/relay/command", "POST", {
          type: params.type,
          payload: enrichedPayload,
          ...(attachmentRefs ? { attachments: attachmentRefs } : {}),
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ...(data as Record<string, unknown>),
                ...(requestGroupInfo ? { requestGroup: requestGroupInfo } : {}),
              }, null, 2),
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
        if (params.requestGroupId) queryParams.set("requestGroupId", params.requestGroupId);
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

        // Step 4: Railway deploy + wait for completion
        let deploymentId: string | undefined;
        try {
          const railwayOut = runCommand("railway", ["up", "--detach"], { cwd: PROJECT_ROOT });
          // Extract deployment ID from output (format: "...?id=<uuid>&")
          const idMatch = railwayOut.match(/[?&]id=([a-f0-9-]+)/);
          deploymentId = idMatch?.[1];
          pipeline.push({ step: "railway_trigger", success: true, output: railwayOut.trim() });
        } catch {
          pipeline.push({ step: "railway_trigger", success: true, output: "Skipped explicit deploy (auto-deploy from git push)" });
        }

        // Step 5: Wait for deployment to complete (poll status)
        if (deploymentId) {
          const maxWait = 240_000; // 4 minutes max
          const startWait = Date.now();
          let finalStatus = "UNKNOWN";

          while (Date.now() - startWait < maxWait) {
            try {
              const listOut = runCommand("railway", ["deployment", "list", "--limit", "1", "--json"], { cwd: PROJECT_ROOT });
              const deployments = JSON.parse(listOut) as Array<{ id: string; status: string; createdAt: string }>;
              const latest = deployments[0];
              if (latest?.id === deploymentId) {
                finalStatus = latest.status;
                if (finalStatus === "SUCCESS") {
                  pipeline.push({ step: "railway_status", success: true, output: `Deployment ${deploymentId.slice(0, 8)} completed: SUCCESS` });
                  break;
                }
                if (finalStatus === "FAILED" || finalStatus === "CRASHED" || finalStatus === "REMOVED") {
                  // Fetch failure logs for diagnosis
                  let failureLogs = "";
                  try {
                    const buildLogs = runCommand("railway", ["logs", "--build", deploymentId, "--lines", "50"], { cwd: PROJECT_ROOT });
                    failureLogs += `\n--- Build Logs (last 50 lines) ---\n${buildLogs.slice(-2000)}`;
                  } catch { /* build logs may not be available */ }
                  try {
                    const deployLogs = runCommand("railway", ["logs", deploymentId, "--lines", "30"], { cwd: PROJECT_ROOT });
                    failureLogs += `\n--- Deploy Logs (last 30 lines) ---\n${deployLogs.slice(-1500)}`;
                  } catch { /* deploy logs may not be available */ }

                  pipeline.push({
                    step: "railway_status",
                    success: false,
                    output: `Deployment ${deploymentId.slice(0, 8)} failed: ${finalStatus}${failureLogs}`,
                  });
                  break;
                }
              }
            } catch {
              break;
            }
            execFileSync("sleep", ["10"]);
          }

          if (!["SUCCESS", "FAILED", "CRASHED", "REMOVED"].includes(finalStatus)) {
            pipeline.push({
              step: "railway_status",
              success: true,
              output: `Deployment ${deploymentId.slice(0, 8)} still in progress after ${Math.round((Date.now() - startWait) / 1000)}s (status: ${finalStatus}). Check Railway dashboard.`,
            });
          }
        }

        // Step 6: Auto-restart gateway if gateway-related files were changed
        const gatewayPatterns = ["scripts/gateway-connector", "scripts/claude-executor", "scripts/mcp-server", "scripts/orchestrator", "scripts/tmux-manager", "agents.json", ".mcp.json"];
        let gatewayChanged = false;
        try {
          // Check which files changed in the last commit
          const diffFiles = runCommand("git", ["diff", "--name-only", "HEAD~1", "HEAD"]).trim();
          gatewayChanged = gatewayPatterns.some((p) => diffFiles.includes(p));
        } catch {
          // If files were provided, check those directly
          if (params.files) {
            gatewayChanged = params.files.some((f) => gatewayPatterns.some((p) => f.includes(p)));
          }
        }

        if (gatewayChanged) {
          try {
            const uid = runCommand("id", ["-u"]).trim();
            runCommand("launchctl", ["kickstart", "-k", `gui/${uid}/com.lifedashboard.gateway-connector`]);
            pipeline.push({ step: "gateway_restart", success: true, output: "Gateway connector restarted (gateway-related files changed)" });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pipeline.push({ step: "gateway_restart", success: false, output: `Gateway restart failed: ${msg}` });
          }
        }

        const allSuccess = pipeline.every((s) => s.success);
        return {
          content: [{ type: "text", text: JSON.stringify({ success: allSuccess, pipeline }, null, 2) }],
          ...(allSuccess ? {} : { isError: true }),
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

      case "dashboard_force_retry_task": {
        const params = ForceRetryTaskSchema.parse(args);

        const data = await apiCall(
          "/api/task-executions/force-retry",
          "POST",
          {
            taskId: params.taskId,
            reason: params.reason || "Manual retry via MCP",
          }
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_projects": {
        const params = GetProjectsSchema.parse(args);

        let endpoint = "/api/projects";
        if (params.status) {
          endpoint += `?status=${encodeURIComponent(params.status)}`;
        }

        const data = await apiCall(endpoint);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_project": {
        const params = GetProjectSchema.parse(args);
        const data = await apiCall(`/api/projects/${params.projectId}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_create_project": {
        const params = CreateProjectSchema.parse(args);
        const data = await apiCall("/api/projects", "POST", params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_update_project": {
        const params = UpdateProjectSchema.parse(args);
        const { projectId, ...updateData } = params;
        const data = await apiCall(`/api/projects/${projectId}`, "PATCH", updateData);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_delete_project": {
        const params = DeleteProjectSchema.parse(args);
        const data = await apiCall(`/api/projects/${params.projectId}`, "DELETE");

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_project_metrics": {
        const params = GetProjectMetricsSchema.parse(args);

        const endpoint = params.projectId
          ? `/api/projects/${params.projectId}/metrics`
          : "/api/projects/metrics";

        const data = await apiCall(endpoint);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_project_metrics_history": {
        const params = GetProjectMetricsHistorySchema.parse(args);

        const queryParams = new URLSearchParams();
        queryParams.set("limit", params.limit.toString());

        const data = await apiCall(
          `/api/projects/${params.projectId}/metrics/history?${queryParams}`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_snapshot_project_metrics": {
        const params = SnapshotProjectMetricsSchema.parse(args);

        const data = await apiCall(
          `/api/projects/${params.projectId}/metrics`,
          "POST"
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_link_task_to_project": {
        const params = LinkTaskToProjectSchema.parse(args);

        const data = await apiCall(
          `/api/projects/${params.projectId}/tasks`,
          "POST",
          {
            task_execution_id: params.taskExecutionId,
            task_queue_id: params.taskQueueId,
            metadata: params.metadata,
          }
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_project_tasks": {
        const params = GetProjectTasksSchema.parse(args);

        const queryParams = new URLSearchParams();
        queryParams.set("limit", params.limit.toString());

        const data = await apiCall(
          `/api/projects/${params.projectId}/tasks?${queryParams}`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_objectives": {
        const params = GetObjectivesSchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.status) queryParams.set("status", params.status);

        const data = await apiCall(`/api/okr/objectives?${queryParams}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_objective": {
        const params = GetObjectiveSchema.parse(args);
        const data = await apiCall(`/api/okr/objectives/${params.objectiveId}`);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_create_objective": {
        const params = CreateObjectiveSchema.parse(args);
        const data = await apiCall("/api/okr/objectives", "POST", params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_update_objective": {
        const params = UpdateObjectiveSchema.parse(args);
        const { objectiveId, ...updateData } = params;
        const data = await apiCall(
          `/api/okr/objectives/${objectiveId}`,
          "PATCH",
          updateData
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_create_key_result": {
        const params = CreateKeyResultSchema.parse(args);
        const data = await apiCall("/api/okr/key-results", "POST", params);

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_update_key_result": {
        const params = UpdateKeyResultSchema.parse(args);
        const { keyResultId, ...updateData } = params;
        const data = await apiCall(
          `/api/okr/key-results/${keyResultId}`,
          "PATCH",
          updateData
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_link_project_objective": {
        const params = LinkProjectObjectiveSchema.parse(args);
        const { projectId, objectiveId, relevantKeyResultIds } = params;
        const data = await apiCall(
          `/api/okr/projects/${projectId}/objectives`,
          "POST",
          {
            objective_id: objectiveId,
            relevant_key_result_ids: relevantKeyResultIds,
          }
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_project_objectives": {
        const params = GetProjectObjectivesSchema.parse(args);
        const data = await apiCall(
          `/api/okr/projects/${params.projectId}/objectives`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_create_conversation": {
        const params = CreateConversationSchema.parse(args);
        const data = await apiCall(
          "/api/conversations",
          "POST",
          params
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_conversations": {
        const params = GetConversationsSchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.participantId) queryParams.set("participantId", params.participantId);
        if (params.status) queryParams.set("status", params.status);
        if (params.createdBy) queryParams.set("createdBy", params.createdBy);
        if (params.limit) queryParams.set("limit", params.limit.toString());

        const data = await apiCall(
          `/api/conversations?${queryParams.toString()}`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_conversation": {
        const params = GetConversationSchema.parse(args);
        const queryParams = new URLSearchParams();
        if (params.includeStats) queryParams.set("stats", "true");

        const data = await apiCall(
          `/api/conversations/${params.conversationId}?${queryParams.toString()}`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_update_conversation": {
        const params = UpdateConversationSchema.parse(args);
        const { conversationId, ...updates } = params;
        const data = await apiCall(
          `/api/conversations/${conversationId}`,
          "PATCH",
          updates
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_delete_conversation": {
        const params = DeleteConversationSchema.parse(args);
        const data = await apiCall(
          `/api/conversations/${params.conversationId}`,
          "DELETE"
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_add_conversation_message": {
        const params = AddConversationMessageSchema.parse(args);
        const { conversationId, ...messageData } = params;
        const data = await apiCall(
          `/api/conversations/${conversationId}/messages`,
          "POST",
          messageData
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_conversation_messages": {
        const params = GetConversationMessagesSchema.parse(args);
        const { conversationId, ...options } = params;
        const queryParams = new URLSearchParams();
        if (options.limit) queryParams.set("limit", options.limit.toString());
        if (options.since) queryParams.set("since", options.since);
        if (options.parentMessageId !== undefined) {
          queryParams.set("parentMessageId", options.parentMessageId || "");
        }

        const data = await apiCall(
          `/api/conversations/${conversationId}/messages?${queryParams.toString()}`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_update_conversation_read_status": {
        const params = UpdateConversationReadStatusSchema.parse(args);
        const { conversationId, ...statusData } = params;
        const data = await apiCall(
          `/api/conversations/${conversationId}/read-status`,
          "POST",
          statusData
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_get_unread_conversations": {
        const params = GetUnreadConversationsSchema.parse(args);
        const data = await apiCall(
          `/api/conversations?participantId=${params.agentId}&status=active`
        );

        return {
          content: [{
            type: "text",
            text: JSON.stringify(data, null, 2),
          }],
        };
      }

      case "dashboard_browse_url": {
        const { url, waitMs = 2000, screenshot = false, sessionId: existingSessionId } = args as {
          url: string;
          waitMs?: number;
          screenshot?: boolean;
          sessionId?: string;
        };

        try {
          const { launchBrowser, closeBrowser, getBrowser } = await import("./browser-session-manager");

          const sid = existingSessionId || `mcp-browse-${Date.now()}`;
          let isNewSession = false;

          // Reuse existing session or launch new one
          let session = getBrowser(sid);
          if (!session) {
            session = await launchBrowser(sid);
            isNewSession = true;
          }

          // Use CDP to navigate and extract content
          const http = await import("http");

          // Get page list from CDP
          const cdpListUrl = `http://127.0.0.1:${session.port}/json/list`;
          const pages: Array<{ id: string; webSocketDebuggerUrl: string }> = await new Promise((resolve, reject) => {
            http.get(cdpListUrl, (res) => {
              let data = "";
              res.on("data", (chunk: string) => { data += chunk; });
              res.on("end", () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              });
            }).on("error", reject);
          });

          if (!pages.length) {
            throw new Error("No browser pages available");
          }

          // Connect via CDP WebSocket and navigate
          const WebSocket = (await import("ws")).default;
          const ws = new WebSocket(pages[0].webSocketDebuggerUrl);

          let cmdId = 1;
          const sendCDP = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
            return new Promise((resolve, reject) => {
              const id = cmdId++;
              const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
              const handler = (msg: { toString(): string }) => {
                const data = JSON.parse(msg.toString());
                if (data.id === id) {
                  clearTimeout(timeout);
                  ws.removeListener("message", handler);
                  if (data.error) reject(new Error(data.error.message));
                  else resolve(data.result);
                }
              };
              ws.on("message", handler);
              ws.send(JSON.stringify({ id, method, params }));
            });
          };

          await new Promise<void>((resolve) => ws.on("open", resolve));

          // Enable page events
          await sendCDP("Page.enable");

          // Navigate
          await sendCDP("Page.navigate", { url });

          // Wait for load + additional delay
          await new Promise((resolve) => setTimeout(resolve, waitMs));

          // Extract page info
          const titleResult = await sendCDP("Runtime.evaluate", {
            expression: "document.title",
          }) as { result: { value: string } };

          const contentResult = await sendCDP("Runtime.evaluate", {
            expression: "document.body?.innerText?.substring(0, 50000) || ''",
          }) as { result: { value: string } };

          const urlResult = await sendCDP("Runtime.evaluate", {
            expression: "window.location.href",
          }) as { result: { value: string } };

          let screenshotBase64: string | undefined;
          if (screenshot) {
            const ssResult = await sendCDP("Page.captureScreenshot", {
              format: "png",
              quality: 80,
            }) as { data: string };
            screenshotBase64 = ssResult.data;
          }

          ws.close();

          // Close session if it was created just for this call
          if (isNewSession && !existingSessionId) {
            await closeBrowser(sid);
          }

          const result: Record<string, unknown> = {
            success: true,
            sessionId: sid,
            url: urlResult.result.value,
            title: titleResult.result.value,
            content: contentResult.result.value,
            contentLength: contentResult.result.value.length,
          };
          if (screenshotBase64) {
            result.screenshot = `data:image/png;base64,${screenshotBase64}`;
            result.screenshotSize = screenshotBase64.length;
          }

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            }],
          };
        }
      }

      case "dashboard_browser_screenshot": {
        const { sessionId } = args as { sessionId: string };

        try {
          const { getBrowser } = await import("./browser-session-manager");
          const session = getBrowser(sessionId);

          if (!session) {
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, error: "Session not found" }) }],
            };
          }

          const http = await import("http");
          const cdpListUrl = `http://127.0.0.1:${session.port}/json/list`;
          const pages: Array<{ webSocketDebuggerUrl: string }> = await new Promise((resolve, reject) => {
            http.get(cdpListUrl, (res) => {
              let data = "";
              res.on("data", (chunk: string) => { data += chunk; });
              res.on("end", () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              });
            }).on("error", reject);
          });

          if (!pages.length) throw new Error("No pages available");

          const WebSocket = (await import("ws")).default;
          const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
          await new Promise<void>((resolve) => ws.on("open", resolve));

          let cmdId = 1;
          const sendCDP = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
            return new Promise((resolve, reject) => {
              const id = cmdId++;
              const timeout = setTimeout(() => reject(new Error("CDP timeout")), 10000);
              const handler = (msg: { toString(): string }) => {
                const data = JSON.parse(msg.toString());
                if (data.id === id) {
                  clearTimeout(timeout);
                  ws.removeListener("message", handler);
                  if (data.error) reject(new Error(data.error.message));
                  else resolve(data.result);
                }
              };
              ws.on("message", handler);
              ws.send(JSON.stringify({ id, method, params }));
            });
          };

          const ssResult = await sendCDP("Page.captureScreenshot", {
            format: "png",
            quality: 80,
          }) as { data: string };

          ws.close();

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                sessionId,
                screenshot: `data:image/png;base64,${ssResult.data}`,
                size: ssResult.data.length,
              }),
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            }],
          };
        }
      }

      case "dashboard_browser_close": {
        const { sessionId } = args as { sessionId: string };

        try {
          const { closeBrowser, getBrowser } = await import("./browser-session-manager");
          const session = getBrowser(sessionId);

          if (!session) {
            return {
              content: [{ type: "text", text: JSON.stringify({ success: false, error: "Session not found" }) }],
            };
          }

          await closeBrowser(sessionId);

          return {
            content: [{ type: "text", text: JSON.stringify({ success: true, sessionId }) }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            }],
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
