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
import { config } from "dotenv";
config({ path: path.resolve(__dirname, "..", ".env.local") });

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Configuration
const DASHBOARD_URL = process.env.DASHBOARD_URL || "http://localhost:3000";
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
});

const SendMessageSchema = z.object({
  from: z.string().describe("Sender agent ID"),
  to: z.string().describe("Recipient agent ID"),
  content: z.string().describe("Message content"),
  type: z.string().default("text").describe("Message type"),
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
          },
          required: ["agentId", "type", "content"],
        },
      },
      {
        name: "dashboard_send_message",
        description: "Send a message between agents",
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
        const data = await apiCall("/api/relay/messages", "POST", params);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
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

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
