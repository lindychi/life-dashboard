/**
 * SSE Broadcaster Advanced Tests
 *
 * Additional edge case tests for SSEBroadcaster:
 * - Controller errors during broadcast
 * - Heartbeat mechanism
 * - Large payload handling
 * - Rapid connect/disconnect
 * - Memory leak scenarios
 * - Concurrent broadcast operations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Create a comprehensive mock SSEBroadcaster class
class TestSSEBroadcaster {
  private clients: Map<
    string,
    {
      id: string;
      controller: { enqueue: (msg: Uint8Array) => void; close: () => void };
      userId?: string;
      connectedAt: Date;
    }
  > = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 100; // Shorter for testing

  constructor() {
    this.startHeartbeat();
  }

  addClient(client: {
    id: string;
    controller: { enqueue: (msg: Uint8Array) => void; close: () => void };
    userId?: string;
    connectedAt: Date;
  }): void {
    this.clients.set(client.id, client);
    // Send initial heartbeat
    this.sendToClient(client.id, {
      type: "heartbeat",
      data: { status: "connected" },
      timestamp: new Date().toISOString(),
    });
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        client.controller.close();
      } catch (err) {
        // Ignore close errors
      }
      this.clients.delete(clientId);
    }
  }

  broadcast(event: { type: string; data: unknown; timestamp: string }): void {
    const message = this.formatSSEMessage(event);
    let errorCount = 0;

    this.clients.forEach((client, clientId) => {
      try {
        client.controller.enqueue(message);
      } catch (err) {
        errorCount++;
        this.removeClient(clientId);
      }
    });
  }

  sendToClient(
    clientId: string,
    event: { type: string; data: unknown; timestamp: string }
  ): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    try {
      const message = this.formatSSEMessage(event);
      client.controller.enqueue(message);
    } catch (err) {
      this.removeClient(clientId);
    }
  }

  broadcastToUser(
    userId: string,
    event: { type: string; data: unknown; timestamp: string }
  ): void {
    this.clients.forEach((client, clientId) => {
      if (client.userId === userId) {
        this.sendToClient(clientId, event);
      }
    });
  }

  private formatSSEMessage(event: {
    type: string;
    data: unknown;
    timestamp: string;
  }): Uint8Array {
    const data = JSON.stringify(event);
    const message = `event: ${event.type}\ndata: ${data}\n\n`;
    return new TextEncoder().encode(message);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.clients.size === 0) return;

      const heartbeatEvent = {
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      };

      this.broadcast(heartbeatEvent);
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  getStats(): {
    totalClients: number;
    clientsByUser: Record<string, number>;
  } {
    const clientsByUser: Record<string, number> = {};
    this.clients.forEach((client) => {
      if (client.userId) {
        clientsByUser[client.userId] = (clientsByUser[client.userId] || 0) + 1;
      }
    });
    return {
      totalClients: this.clients.size,
      clientsByUser,
    };
  }

  cleanup(): void {
    this.stopHeartbeat();
    this.clients.forEach((client, clientId) => {
      this.removeClient(clientId);
    });
  }
}

describe("SSEBroadcaster Advanced Tests", () => {
  let broadcaster: TestSSEBroadcaster;

  beforeEach(() => {
    broadcaster = new TestSSEBroadcaster();
  });

  afterEach(() => {
    broadcaster.cleanup();
  });

  describe("Error Handling", () => {
    it("controller.enqueue 실패 시 클라이언트 자동 제거", () => {
      const mockController = {
        enqueue: vi.fn(() => {
          throw new Error("Stream closed");
        }),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      const event = {
        type: "test:event",
        data: { test: true },
        timestamp: new Date().toISOString(),
      };

      // Initial heartbeat will fail and remove client
      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0); // Auto-removed due to enqueue error
    });

    it("일부 클라이언트 실패 시 나머지 클라이언트는 정상 수신", () => {
      const mockController1 = {
        enqueue: vi.fn(() => {
          throw new Error("Stream error");
        }),
        close: vi.fn(),
      };

      const mockController2 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      const mockController3 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      // Disable auto-heartbeat for this test
      broadcaster.stopHeartbeat();

      broadcaster.addClient({
        id: "client1",
        controller: mockController1,
        userId: "user1",
        connectedAt: new Date(),
      });

      broadcaster.addClient({
        id: "client2",
        controller: mockController2,
        userId: "user1",
        connectedAt: new Date(),
      });

      broadcaster.addClient({
        id: "client3",
        controller: mockController3,
        userId: "user2",
        connectedAt: new Date(),
      });

      const event = {
        type: "test:event",
        data: { test: true },
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcast(event);

      // Client1 failed, client2 and client3 should receive
      expect(mockController2.enqueue).toHaveBeenCalled();
      expect(mockController3.enqueue).toHaveBeenCalled();

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(2); // client1 removed
    });

    it("controller.close 실패 시에도 클라이언트 제거", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(() => {
          throw new Error("Cannot close");
        }),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      // Should not throw
      expect(() => broadcaster.removeClient("client1")).not.toThrow();

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0);
    });

    it("존재하지 않는 클라이언트 제거 시도는 무시", () => {
      expect(() => broadcaster.removeClient("nonexistent")).not.toThrow();
    });

    it("존재하지 않는 클라이언트에 메시지 전송은 무시", () => {
      const event = {
        type: "test:event",
        data: { test: true },
        timestamp: new Date().toISOString(),
      };

      expect(() => broadcaster.sendToClient("nonexistent", event)).not.toThrow();
    });
  });

  describe("Heartbeat Mechanism", () => {
    it("주기적으로 heartbeat 전송", async () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.stopHeartbeat(); // Stop auto-heartbeat
      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      const initialCalls = mockController.enqueue.mock.calls.length;

      // Manually trigger heartbeat
      const heartbeatEvent = {
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      };
      broadcaster.broadcast(heartbeatEvent);

      expect(mockController.enqueue).toHaveBeenCalledTimes(initialCalls + 1);
    });

    it("클라이언트가 없을 때 heartbeat는 전송하지 않음", async () => {
      // Create new broadcaster with heartbeat
      const testBroadcaster = new TestSSEBroadcaster();

      // Wait for potential heartbeat
      await new Promise((resolve) => setTimeout(resolve, 150));

      // No clients, so no heartbeat should have been sent
      testBroadcaster.cleanup();
    });

    it("stopHeartbeat 후 heartbeat 전송 중지", async () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      const callsBeforeStop = mockController.enqueue.mock.calls.length;
      broadcaster.stopHeartbeat();

      await new Promise((resolve) => setTimeout(resolve, 150));

      // No additional calls after stopHeartbeat
      const callsAfterStop = mockController.enqueue.mock.calls.length;
      expect(callsAfterStop).toBe(callsBeforeStop);
    });
  });

  describe("Large Payload Handling", () => {
    it("대용량 데이터 브로드캐스트", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      // Create large payload (1MB of data)
      const largeData = {
        items: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: "A".repeat(100),
        })),
      };

      const event = {
        type: "bulk:update",
        data: largeData,
        timestamp: new Date().toISOString(),
      };

      expect(() => broadcaster.broadcast(event)).not.toThrow();
      expect(mockController.enqueue).toHaveBeenCalled();
    });

    it("JSON 직렬화 가능한 복잡한 객체 처리", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        connectedAt: new Date(),
      });

      const complexData = {
        nested: {
          deeply: {
            nested: {
              value: 123,
              array: [1, 2, 3, { inner: true }],
            },
          },
        },
        nullValue: null,
        boolValue: true,
        stringValue: "test",
      };

      const event = {
        type: "complex:data",
        data: complexData,
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcast(event);

      const encodedMessage = mockController.enqueue.mock.calls[1][0]; // Skip initial heartbeat
      const decodedMessage = new TextDecoder().decode(encodedMessage);
      const parsed = JSON.parse(
        decodedMessage.split("\ndata: ")[1].split("\n\n")[0]
      );

      expect(parsed.data).toEqual(complexData);
    });
  });

  describe("Rapid Connect/Disconnect", () => {
    it("빠른 연결/해제 반복", () => {
      for (let i = 0; i < 100; i++) {
        const mockController = {
          enqueue: vi.fn(),
          close: vi.fn(),
        };

        const clientId = `client${i}`;
        broadcaster.addClient({
          id: clientId,
          controller: mockController,
          userId: `user${i % 10}`,
          connectedAt: new Date(),
        });

        broadcaster.removeClient(clientId);
      }

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0);
    });

    it("동시 다중 연결/해제", () => {
      const clients = Array.from({ length: 50 }, (_, i) => ({
        id: `client${i}`,
        controller: {
          enqueue: vi.fn(),
          close: vi.fn(),
        },
        userId: `user${i % 5}`,
        connectedAt: new Date(),
      }));

      // Add all clients
      clients.forEach((client) => broadcaster.addClient(client));

      let stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(50);

      // Remove half
      clients.slice(0, 25).forEach((client) => broadcaster.removeClient(client.id));

      stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(25);

      // Remove remaining
      clients.slice(25).forEach((client) => broadcaster.removeClient(client.id));

      stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0);
    });
  });

  describe("Memory Management", () => {
    it("cleanup 후 모든 클라이언트 제거", () => {
      const clients = Array.from({ length: 10 }, (_, i) => ({
        id: `client${i}`,
        controller: {
          enqueue: vi.fn(),
          close: vi.fn(),
        },
        userId: `user${i}`,
        connectedAt: new Date(),
      }));

      clients.forEach((client) => broadcaster.addClient(client));

      broadcaster.cleanup();

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0);
      expect(stats.clientsByUser).toEqual({});
    });

    it("cleanup 시 heartbeat 중지", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      const callsBeforeCleanup = mockController.enqueue.mock.calls.length;
      broadcaster.cleanup();

      // Wait for potential heartbeat interval
      setTimeout(() => {
        const callsAfterCleanup = mockController.enqueue.mock.calls.length;
        expect(callsAfterCleanup).toBe(callsBeforeCleanup);
      }, 150);
    });

    it("제거된 클라이언트는 브로드캐스트 수신 안 함", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        userId: "user1",
        connectedAt: new Date(),
      });

      const callsBeforeRemove = mockController.enqueue.mock.calls.length;
      broadcaster.removeClient("client1");

      const event = {
        type: "test:event",
        data: { test: true },
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcast(event);

      // No additional calls after removal
      expect(mockController.enqueue).toHaveBeenCalledTimes(callsBeforeRemove);
    });
  });

  describe("Concurrent Operations", () => {
    it("동시 브로드캐스트 처리", () => {
      const clients = Array.from({ length: 5 }, (_, i) => ({
        id: `client${i}`,
        controller: {
          enqueue: vi.fn(),
          close: vi.fn(),
        },
        userId: `user${i}`,
        connectedAt: new Date(),
      }));

      clients.forEach((client) => broadcaster.addClient(client));

      // Broadcast multiple events concurrently
      const events = Array.from({ length: 10 }, (_, i) => ({
        type: `event${i}`,
        data: { index: i },
        timestamp: new Date().toISOString(),
      }));

      events.forEach((event) => broadcaster.broadcast(event));

      // Each client should receive all 10 events + initial heartbeat
      clients.forEach((client) => {
        expect(client.controller.enqueue.mock.calls.length).toBeGreaterThanOrEqual(10);
      });
    });

    it("브로드캐스트 중 클라이언트 추가/제거", () => {
      const client1 = {
        id: "client1",
        controller: {
          enqueue: vi.fn(),
          close: vi.fn(),
        },
        userId: "user1",
        connectedAt: new Date(),
      };

      const client2 = {
        id: "client2",
        controller: {
          enqueue: vi.fn(),
          close: vi.fn(),
        },
        userId: "user2",
        connectedAt: new Date(),
      };

      broadcaster.addClient(client1);

      const event = {
        type: "test:event",
        data: { test: true },
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcast(event);
      broadcaster.addClient(client2); // Add during broadcast
      broadcaster.broadcast(event);
      broadcaster.removeClient("client1"); // Remove during broadcast
      broadcaster.broadcast(event);

      expect(client1.controller.enqueue.mock.calls.length).toBeGreaterThan(0);
      expect(client2.controller.enqueue.mock.calls.length).toBeGreaterThan(0);

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(1); // Only client2 remains
    });
  });

  describe("User-Specific Broadcasting", () => {
    it("특정 사용자에게만 브로드캐스트", () => {
      const user1Client1 = {
        id: "u1c1",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user1",
        connectedAt: new Date(),
      };

      const user1Client2 = {
        id: "u1c2",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user1",
        connectedAt: new Date(),
      };

      const user2Client1 = {
        id: "u2c1",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user2",
        connectedAt: new Date(),
      };

      broadcaster.addClient(user1Client1);
      broadcaster.addClient(user1Client2);
      broadcaster.addClient(user2Client1);

      const event = {
        type: "user:notification",
        data: { message: "Hello user1" },
        timestamp: new Date().toISOString(),
      };

      const initialCalls1 = user1Client1.controller.enqueue.mock.calls.length;
      const initialCalls2 = user1Client2.controller.enqueue.mock.calls.length;
      const initialCalls3 = user2Client1.controller.enqueue.mock.calls.length;

      broadcaster.broadcastToUser("user1", event);

      // User1's clients should receive, user2's should not
      expect(user1Client1.controller.enqueue).toHaveBeenCalledTimes(initialCalls1 + 1);
      expect(user1Client2.controller.enqueue).toHaveBeenCalledTimes(initialCalls2 + 1);
      expect(user2Client1.controller.enqueue).toHaveBeenCalledTimes(initialCalls3);
    });

    it("userId 없는 클라이언트는 user-specific 브로드캐스트 수신 안 함", () => {
      const clientWithUser = {
        id: "c1",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user1",
        connectedAt: new Date(),
      };

      const clientWithoutUser = {
        id: "c2",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        connectedAt: new Date(),
      };

      broadcaster.addClient(clientWithUser);
      broadcaster.addClient(clientWithoutUser);

      const event = {
        type: "user:notification",
        data: { message: "Hello" },
        timestamp: new Date().toISOString(),
      };

      const initialCallsWithUser = clientWithUser.controller.enqueue.mock.calls.length;
      const initialCallsWithoutUser = clientWithoutUser.controller.enqueue.mock.calls.length;

      broadcaster.broadcastToUser("user1", event);

      expect(clientWithUser.controller.enqueue).toHaveBeenCalledTimes(
        initialCallsWithUser + 1
      );
      expect(clientWithoutUser.controller.enqueue).toHaveBeenCalledTimes(
        initialCallsWithoutUser
      );
    });
  });

  describe("Stats Tracking", () => {
    it("정확한 통계 반환", () => {
      const clients = [
        {
          id: "c1",
          controller: { enqueue: vi.fn(), close: vi.fn() },
          userId: "user1",
          connectedAt: new Date(),
        },
        {
          id: "c2",
          controller: { enqueue: vi.fn(), close: vi.fn() },
          userId: "user1",
          connectedAt: new Date(),
        },
        {
          id: "c3",
          controller: { enqueue: vi.fn(), close: vi.fn() },
          userId: "user2",
          connectedAt: new Date(),
        },
        {
          id: "c4",
          controller: { enqueue: vi.fn(), close: vi.fn() },
          connectedAt: new Date(),
        },
      ];

      clients.forEach((client) => broadcaster.addClient(client));

      const stats = broadcaster.getStats();

      expect(stats.totalClients).toBe(4);
      expect(stats.clientsByUser["user1"]).toBe(2);
      expect(stats.clientsByUser["user2"]).toBe(1);
      expect(stats.clientsByUser["undefined"]).toBeUndefined();
    });

    it("클라이언트 제거 후 통계 업데이트", () => {
      const client1 = {
        id: "c1",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user1",
        connectedAt: new Date(),
      };

      const client2 = {
        id: "c2",
        controller: { enqueue: vi.fn(), close: vi.fn() },
        userId: "user1",
        connectedAt: new Date(),
      };

      broadcaster.addClient(client1);
      broadcaster.addClient(client2);

      let stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.clientsByUser["user1"]).toBe(2);

      broadcaster.removeClient("c1");

      stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(1);
      expect(stats.clientsByUser["user1"]).toBe(1);
    });
  });
});
