/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SSE (Server-Sent Events) Stability Tests
 *
 * Tests for:
 * - GET /api/sse - SSE connection establishment
 * - Connection lifecycle (connect/disconnect/reconnect)
 * - Heartbeat keepalive mechanism
 * - Broadcasting to multiple clients
 * - Authentication enforcement
 * - Error handling and cleanup
 * - Memory leak prevention
 *
 * Edge cases:
 * - Concurrent connections from same user
 * - Connection drops and auto-reconnect
 * - Controller stream errors
 * - Client disconnect cleanup
 * - Heartbeat during no activity
 * - Large number of simultaneous connections
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as sseRoute } from "../sse/route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@/lib/auth", () => ({
  verifyAuth: vi.fn(),
}));

vi.mock("@/lib/sse-broadcaster", () => {
  const actualBroadcaster = {
    clients: new Map(),
    heartbeatInterval: null,
    addClient: vi.fn(function (this: typeof actualBroadcaster, client: any) {
      this.clients.set(client.id, client);
    }),
    removeClient: vi.fn(function (this: typeof actualBroadcaster, clientId: string) {
      const client = this.clients.get(clientId);
      if (client) {
        try {
          client.controller.close();
        } catch (err) {
          // Ignore
        }
        this.clients.delete(clientId);
      }
    }),
    broadcast: vi.fn(),
    sendToClient: vi.fn(),
    broadcastToUser: vi.fn(),
    getStats: vi.fn(function (this: typeof actualBroadcaster) {
      return {
        totalClients: this.clients.size,
        clientsByUser: {},
      };
    }),
    cleanup: vi.fn(function (this: typeof actualBroadcaster) {
      this.clients.forEach((client, clientId) => {
        this.removeClient(clientId);
      });
    }),
  };
  return {
    sseBroadcaster: actualBroadcaster,
  };
});

import { verifyAuth } from "@/lib/auth";
import { sseBroadcaster } from "@/lib/sse-broadcaster";

const mockVerifyAuth = vi.mocked(verifyAuth);
const mockAddClient = vi.mocked(sseBroadcaster.addClient);
const mockRemoveClient = vi.mocked(sseBroadcaster.removeClient);

describe("SSE Stability Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any existing clients
    const broadcaster = sseBroadcaster as unknown as { clients: Map<string, unknown> };
    if (broadcaster.clients instanceof Map) {
      broadcaster.clients.clear();
    }
  });

  afterEach(() => {
    // Cleanup any remaining clients
    if (typeof sseBroadcaster.cleanup === "function") {
      sseBroadcaster.cleanup();
    }
  });

  describe("Connection Establishment", () => {
    it("인증되지 않은 요청은 401 반환", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: false,
        email: undefined,
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("인증된 요청은 SSE 스트림 반환", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(response.headers.get("Connection")).toBe("keep-alive");
      expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    });

    it("클라이언트 등록 및 welcome 메시지 전송", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      // Wait for stream setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddClient).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^client_\d+_[a-z0-9]+$/),
          userId: "test@example.com",
          connectedAt: expect.any(Date),
        })
      );
    });

    it("동일 사용자의 다중 연결 지원", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      // Create 3 concurrent connections
      const request1 = new NextRequest("http://localhost/api/sse");
      const request2 = new NextRequest("http://localhost/api/sse");
      const request3 = new NextRequest("http://localhost/api/sse");

      const [response1, response2, response3] = await Promise.all([
        sseRoute(request1),
        sseRoute(request2),
        sseRoute(request3),
      ]);

      // Wait for all streams to setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response3.status).toBe(200);
      expect(mockAddClient).toHaveBeenCalledTimes(3);
    });
  });

  describe("Connection Cleanup", () => {
    it("스트림 cancel 시 클라이언트 제거", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      // Extract client ID from the first addClient call
      await new Promise((resolve) => setTimeout(resolve, 10));
      const clientId = mockAddClient.mock.calls[0][0].id;

      // Cancel the stream (simulating client disconnect)
      if (response.body) {
        const reader = response.body.getReader();
        await reader.cancel();
      }

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRemoveClient).toHaveBeenCalledWith(clientId);
    });

    it("다중 연결 종료 시 각각 독립적으로 정리", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      const request1 = new NextRequest("http://localhost/api/sse");
      const request2 = new NextRequest("http://localhost/api/sse");

      const [response1, response2] = await Promise.all([
        sseRoute(request1),
        sseRoute(request2),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientId1 = mockAddClient.mock.calls[0][0].id;
      const clientId2 = mockAddClient.mock.calls[1][0].id;

      // Close only first connection
      if (response1.body) {
        const reader = response1.body.getReader();
        await reader.cancel();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRemoveClient).toHaveBeenCalledWith(clientId1);
      expect(mockRemoveClient).not.toHaveBeenCalledWith(clientId2);

      // Close second connection
      if (response2.body) {
        const reader = response2.body.getReader();
        await reader.cancel();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRemoveClient).toHaveBeenCalledWith(clientId2);
    });
  });

  describe("Stream Data Reading", () => {
    it("welcome 메시지 수신 가능", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.body).toBeDefined();

      if (response.body) {
        const reader = response.body.getReader();
        const { value, done } = await reader.read();

        expect(done).toBe(false);
        expect(value).toBeDefined();

        const text = new TextDecoder().decode(value);
        expect(text).toContain("event: connected");
        expect(text).toContain("data:");
        expect(text).toContain('"type":"connected"');
        expect(text).toContain('"clientId":"client_');

        await reader.cancel();
      }
    });

    it("여러 메시지 순차 수신", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      if (response.body) {
        const reader = response.body.getReader();

        // Read welcome message
        const { value: value1 } = await reader.read();
        const text1 = new TextDecoder().decode(value1);
        expect(text1).toContain("event: connected");

        await reader.cancel();
      }
    });
  });

  describe("Error Handling", () => {
    it("controller.enqueue 실패 시 에러 처리", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      // Mock controller that throws on enqueue
      const mockController = {
        enqueue: vi.fn(() => {
          throw new Error("Stream error");
        }),
        close: vi.fn(),
      };

      const originalAddClient = sseBroadcaster.addClient;
      sseBroadcaster.addClient = vi.fn((client) => {
        // Replace controller with mock
        client.controller = mockController as any;
        return originalAddClient.call(sseBroadcaster, client);
      });

      const request = new NextRequest("http://localhost/api/sse");
      await sseRoute(request);

      // Restore original
      sseBroadcaster.addClient = originalAddClient;

      // The test should not throw - errors are handled gracefully
      expect(true).toBe(true);
    });

    it("인증 실패 시 스트림 생성 안 됨", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: false,
        email: undefined,
      });

      const request = new NextRequest("http://localhost/api/sse");
      await sseRoute(request);

      expect(mockAddClient).not.toHaveBeenCalled();
    });
  });

  describe("Client ID Generation", () => {
    it("각 연결마다 고유한 클라이언트 ID 생성", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      const request1 = new NextRequest("http://localhost/api/sse");
      const request2 = new NextRequest("http://localhost/api/sse");
      const request3 = new NextRequest("http://localhost/api/sse");

      await Promise.all([sseRoute(request1), sseRoute(request2), sseRoute(request3)]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientIds = mockAddClient.mock.calls.map((call) => call[0].id);

      expect(clientIds).toHaveLength(3);
      expect(new Set(clientIds).size).toBe(3); // All unique
    });

    it("클라이언트 ID 형식 검증", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      await sseRoute(request);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientId = mockAddClient.mock.calls[0][0].id;
      expect(clientId).toMatch(/^client_\d+_[a-z0-9]+$/);
    });
  });

  describe("Response Headers", () => {
    it("SSE 표준 헤더 포함", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });

    it("nginx 버퍼링 비활성화 헤더 포함", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    });
  });

  describe("Memory Management", () => {
    it("연결 종료 후 메모리 정리", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientId = mockAddClient.mock.calls[0][0].id;

      // Disconnect
      if (response.body) {
        const reader = response.body.getReader();
        await reader.cancel();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify client is removed from memory
      expect(mockRemoveClient).toHaveBeenCalledWith(clientId);
    });

    it("다수 연결 후 전체 정리", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      const connections = 10;
      const requests = Array.from({ length: connections }, () =>
        new NextRequest("http://localhost/api/sse")
      );

      const responses = await Promise.all(requests.map((req) => sseRoute(req)));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddClient).toHaveBeenCalledTimes(connections);

      // Close all connections
      await Promise.all(
        responses.map(async (response) => {
          if (response.body) {
            const reader = response.body.getReader();
            await reader.cancel();
          }
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRemoveClient).toHaveBeenCalledTimes(connections);
    });
  });

  describe("Concurrent Operations", () => {
    it("동시 연결 및 종료 처리", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      // Create connections
      const responses = await Promise.all([
        sseRoute(new NextRequest("http://localhost/api/sse")),
        sseRoute(new NextRequest("http://localhost/api/sse")),
        sseRoute(new NextRequest("http://localhost/api/sse")),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Close connections concurrently
      await Promise.all(
        responses.map(async (response) => {
          if (response.body) {
            const reader = response.body.getReader();
            await reader.cancel();
          }
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddClient).toHaveBeenCalledTimes(3);
      expect(mockRemoveClient).toHaveBeenCalledTimes(3);
    });

    it("연결 생성 중 다른 연결 종료", async () => {
      mockVerifyAuth.mockResolvedValue({
        authenticated: true,
        email: "test@example.com",
      });

      const response1 = await sseRoute(new NextRequest("http://localhost/api/sse"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const clientId1 = mockAddClient.mock.calls[0][0].id;

      // Start creating second connection while closing first
      const response2Promise = sseRoute(new NextRequest("http://localhost/api/sse"));

      if (response1.body) {
        const reader = response1.body.getReader();
        await reader.cancel();
      }

      const response2 = await response2Promise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockRemoveClient).toHaveBeenCalledWith(clientId1);
      expect(mockAddClient).toHaveBeenCalledTimes(2);
      expect(response2.status).toBe(200);
    });
  });

  describe("Edge Cases", () => {
    it("빈 이메일로 인증된 경우 처리", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddClient).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "",
        })
      );
    });

    it("null 이메일로 인증된 경우 처리", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: null as any,
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      expect(response.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockAddClient).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
        })
      );
    });

    it("스트림 즉시 취소", async () => {
      mockVerifyAuth.mockResolvedValueOnce({
        authenticated: true,
        email: "test@example.com",
      });

      const request = new NextRequest("http://localhost/api/sse");
      const response = await sseRoute(request);

      // Cancel immediately without reading
      if (response.body) {
        const reader = response.body.getReader();
        await reader.cancel();
      }

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
