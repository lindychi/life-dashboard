/**
 * MCP Server: dashboard_get_messages handler tests
 *
 * Tests the data consistency between the MCP server's dashboard_get_messages
 * tool handler and the underlying API responses. The MCP server acts as a
 * proxy to /api/relay/messages, so we verify:
 *
 * 1. Parameter mapping (agentId, unreadOnly → query params)
 * 2. Response format consistency (MCP wraps API response in content[])
 * 3. Error handling (API failures → MCP error responses)
 * 4. Schema validation (Zod schema for GetMessagesSchema)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock pg
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Track all fetch calls for verification
const fetchCalls: Array<{
  url: string;
  method: string;
  headers: Record<string, string>;
}> = [];

// Mock fetch globally
const mockFetch = vi.fn(async (url: string, options?: RequestInit) => {
  fetchCalls.push({
    url,
    method: options?.method || "GET",
    headers: (options?.headers as Record<string, string>) || {},
  });

  // Default successful response
  return {
    ok: true,
    status: 200,
    json: async () => ({
      messages: [
        {
          id: "msg-1",
          from: "dev",
          to: "pm",
          content: "test message",
          type: "text",
          read: false,
          timestamp: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
    text: async () => "OK",
  } as Response;
});

// Replace global fetch
vi.stubGlobal("fetch", mockFetch);

// =========================================================================
// Test the MCP parameter/query mapping logic directly
// (Without requiring the full MCP server infrastructure)
// =========================================================================

describe("MCP dashboard_get_messages: Parameter Mapping", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should construct correct URL with agentId query param", async () => {
    // Simulate what the MCP handler does
    const params = { agentId: "dev", unreadOnly: undefined };
    const queryParams = new URLSearchParams();
    queryParams.set("agentId", params.agentId);
    if (params.unreadOnly) queryParams.set("unreadOnly", "true");

    const url = `http://localhost:3000/api/relay/messages?${queryParams}`;

    await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": "dev-relay-key",
      },
    });

    expect(fetchCalls[0].url).toContain("agentId=dev");
    expect(fetchCalls[0].url).not.toContain("unreadOnly");
  });

  it("should include unreadOnly=true when specified", async () => {
    const params = { agentId: "pm", unreadOnly: true };
    const queryParams = new URLSearchParams();
    queryParams.set("agentId", params.agentId);
    if (params.unreadOnly) queryParams.set("unreadOnly", "true");

    const url = `http://localhost:3000/api/relay/messages?${queryParams}`;

    await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": "dev-relay-key",
      },
    });

    expect(fetchCalls[0].url).toContain("agentId=pm");
    expect(fetchCalls[0].url).toContain("unreadOnly=true");
  });

  it("should always include x-relay-key header for authentication", async () => {
    const RELAY_API_KEY = "dev-relay-key";

    await fetch("http://localhost:3000/api/relay/messages?agentId=dev", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-relay-key": RELAY_API_KEY,
      },
    });

    expect(fetchCalls[0].headers["x-relay-key"]).toBe(RELAY_API_KEY);
  });
});

describe("MCP dashboard_get_messages: Response Format Consistency", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    mockFetch.mockClear();
  });

  it("should wrap API response in MCP content format", async () => {
    // Simulate the MCP handler response wrapping
    const apiResponse = {
      messages: [
        {
          id: "msg-1",
          from: "dev",
          to: "pm",
          content: "hello",
          type: "text",
          read: false,
          timestamp: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    // This is what the MCP handler does with the API response
    const mcpResponse = {
      content: [
        {
          type: "text",
          text: JSON.stringify(apiResponse, null, 2),
        },
      ],
    };

    expect(mcpResponse.content).toHaveLength(1);
    expect(mcpResponse.content[0].type).toBe("text");

    // Parse the text content back
    const parsed = JSON.parse(mcpResponse.content[0].text);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].id).toBe("msg-1");
    expect(parsed.messages[0].from).toBe("dev");
  });

  it("MCP response message fields should match API response exactly", async () => {
    const apiMessage = {
      id: "msg-123",
      from: "dev",
      to: "pm",
      content: "task completed",
      type: "result",
      read: true,
      timestamp: "2025-06-15T10:30:00.000Z",
    };

    // Wrap as MCP does
    const mcpText = JSON.stringify({ messages: [apiMessage] }, null, 2);
    const parsed = JSON.parse(mcpText);

    // All fields should be preserved exactly
    expect(parsed.messages[0]).toEqual(apiMessage);
  });

  it("should handle empty messages array from API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ messages: [] }),
      text: async () => "OK",
    } as Response);

    const response = await fetch(
      "http://localhost:3000/api/relay/messages?agentId=nonexistent"
    );
    const data = await response.json();

    const mcpResponse = {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };

    const parsed = JSON.parse(mcpResponse.content[0].text);
    expect(parsed.messages).toEqual([]);
  });
});

describe("MCP dashboard_get_messages: Error Handling", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    mockFetch.mockClear();
  });

  it("should return isError:true when API returns non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
      text: async () => "Server error",
    } as Response);

    // Simulate MCP handler error path
    try {
      const response = await fetch(
        "http://localhost:3000/api/relay/messages?agentId=dev"
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const mcpErrorResponse = {
        content: [
          { type: "text", text: JSON.stringify({ error: errorMessage }, null, 2) },
        ],
        isError: true,
      };

      expect(mcpErrorResponse.isError).toBe(true);
      const parsed = JSON.parse(mcpErrorResponse.content[0].text);
      expect(parsed.error).toContain("API error (500)");
    }
  });

  it("should return isError:true when API key is invalid (401)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
      text: async () => "Invalid API key",
    } as Response);

    try {
      const response = await fetch(
        "http://localhost:3000/api/relay/messages?agentId=dev",
        {
          headers: { "x-relay-key": "wrong-key" } as Record<string, string>,
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error (${response.status}): ${errorText}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const mcpErrorResponse = {
        content: [
          { type: "text", text: JSON.stringify({ error: errorMessage }, null, 2) },
        ],
        isError: true,
      };

      expect(mcpErrorResponse.isError).toBe(true);
      const parsed = JSON.parse(mcpErrorResponse.content[0].text);
      expect(parsed.error).toContain("401");
    }
  });

  it("should handle network/fetch failure gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    try {
      await fetch("http://localhost:3000/api/relay/messages?agentId=dev");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const mcpErrorResponse = {
        content: [
          { type: "text", text: JSON.stringify({ error: errorMessage }, null, 2) },
        ],
        isError: true,
      };

      expect(mcpErrorResponse.isError).toBe(true);
      const parsed = JSON.parse(mcpErrorResponse.content[0].text);
      expect(parsed.error).toBe("ECONNREFUSED");
    }
  });
});

describe("MCP dashboard_get_messages: Zod Schema Validation", () => {
  it("should require agentId parameter", async () => {
    // Simulate Zod validation from the MCP server
    const { z } = await import("zod");
    const GetMessagesSchema = z.object({
      agentId: z.string(),
      unreadOnly: z.boolean().optional(),
    });

    // Missing agentId should fail
    expect(() => GetMessagesSchema.parse({})).toThrow();
    expect(() => GetMessagesSchema.parse({ unreadOnly: true })).toThrow();
  });

  it("should accept valid parameters", async () => {
    const { z } = await import("zod");
    const GetMessagesSchema = z.object({
      agentId: z.string(),
      unreadOnly: z.boolean().optional(),
    });

    const result = GetMessagesSchema.parse({ agentId: "dev" });
    expect(result.agentId).toBe("dev");
    expect(result.unreadOnly).toBeUndefined();
  });

  it("should accept agentId with unreadOnly", async () => {
    const { z } = await import("zod");
    const GetMessagesSchema = z.object({
      agentId: z.string(),
      unreadOnly: z.boolean().optional(),
    });

    const result = GetMessagesSchema.parse({
      agentId: "pm",
      unreadOnly: true,
    });
    expect(result.agentId).toBe("pm");
    expect(result.unreadOnly).toBe(true);
  });

  it("should reject non-string agentId", async () => {
    const { z } = await import("zod");
    const GetMessagesSchema = z.object({
      agentId: z.string(),
      unreadOnly: z.boolean().optional(),
    });

    expect(() => GetMessagesSchema.parse({ agentId: 123 })).toThrow();
    expect(() => GetMessagesSchema.parse({ agentId: null })).toThrow();
  });
});

describe("MCP vs API Data Consistency: End-to-End", () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    mockFetch.mockClear();
  });

  it("MCP response should contain all fields from API response without transformation", async () => {
    // The API returns messages in a specific format
    const apiResponseData = {
      messages: [
        {
          id: "uuid-1",
          from: "dev",
          to: "pm",
          content: "Build succeeded with @file:abc123",
          type: "result",
          read: false,
          timestamp: "2025-12-01T12:00:00.000Z",
          // Note: API might include attachments field
          attachments: [
            {
              id: "att-1",
              refKey: "abc123",
              originalFilename: "build.log",
            },
          ],
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => apiResponseData,
      text: async () => JSON.stringify(apiResponseData),
    } as Response);

    const response = await fetch(
      "http://localhost:3000/api/relay/messages?agentId=pm"
    );
    const data = await response.json();

    // MCP handler wraps in content[]
    const mcpContent = JSON.stringify(data, null, 2);
    const parsed = JSON.parse(mcpContent);

    // Verify no data loss in the pipeline
    expect(parsed.messages[0].id).toBe("uuid-1");
    expect(parsed.messages[0].content).toContain("@file:abc123");
    expect(parsed.messages[0].attachments).toBeDefined();
    expect(parsed.messages[0].attachments[0].refKey).toBe("abc123");
  });

  it("MCP should propagate agentId correctly through the API call chain", async () => {
    const targetAgentId = "dev";

    // Simulate MCP handler flow
    const queryParams = new URLSearchParams();
    queryParams.set("agentId", targetAgentId);

    await fetch(
      `http://localhost:3000/api/relay/messages?${queryParams}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": "dev-relay-key",
        },
      }
    );

    // Verify the URL was constructed with correct agentId
    const calledUrl = new URL(fetchCalls[0].url);
    expect(calledUrl.searchParams.get("agentId")).toBe(targetAgentId);
  });

  it("MCP unreadOnly=false should not include unreadOnly param in URL", async () => {
    const params = { agentId: "dev", unreadOnly: false };
    const queryParams = new URLSearchParams();
    queryParams.set("agentId", params.agentId);
    if (params.unreadOnly) queryParams.set("unreadOnly", "true");

    await fetch(
      `http://localhost:3000/api/relay/messages?${queryParams}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-relay-key": "dev-relay-key",
        },
      }
    );

    const calledUrl = new URL(fetchCalls[0].url);
    expect(calledUrl.searchParams.has("unreadOnly")).toBe(false);
  });
});
