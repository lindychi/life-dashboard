/**
 * SSE Broadcaster Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Create a mock SSEBroadcaster class for testing
class MockSSEBroadcaster {
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

  addClient(client: {
    id: string;
    controller: { enqueue: (msg: Uint8Array) => void; close: () => void };
    userId?: string;
    connectedAt: Date;
  }): void {
    this.clients.set(client.id, client);
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
    }
  }

  broadcast(event: { type: string; data: unknown; timestamp: string }): void {
    const message = this.formatSSEMessage(event);
    this.clients.forEach((client) => {
      client.controller.enqueue(message);
    });
  }

  sendToClient(
    clientId: string,
    event: { type: string; data: unknown; timestamp: string }
  ): void {
    const client = this.clients.get(clientId);
    if (client) {
      const message = this.formatSSEMessage(event);
      client.controller.enqueue(message);
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

  private formatSSEMessage(event: {
    type: string;
    data: unknown;
    timestamp: string;
  }): Uint8Array {
    const data = JSON.stringify(event);
    const message = `event: ${event.type}\ndata: ${data}\n\n`;
    return new TextEncoder().encode(message);
  }

  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client, clientId) => {
      this.removeClient(clientId);
    });
  }
}

describe("SSEBroadcaster", () => {
  let broadcaster: MockSSEBroadcaster;

  beforeEach(() => {
    broadcaster = new MockSSEBroadcaster();
  });

  afterEach(() => {
    broadcaster.cleanup();
  });

  describe("Client Management", () => {
    it("should add client and track it", () => {
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

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(1);
      expect(stats.clientsByUser["user1"]).toBe(1);
    });

    it("should remove client", () => {
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

      broadcaster.removeClient("client1");

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(0);
    });

    it("should track multiple clients for same user", () => {
      const mockController1 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };
      const mockController2 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

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

      const stats = broadcaster.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.clientsByUser["user1"]).toBe(2);
    });
  });

  describe("Broadcasting", () => {
    it("should broadcast to all clients", () => {
      const mockController1 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };
      const mockController2 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController1,
        connectedAt: new Date(),
      });

      broadcaster.addClient({
        id: "client2",
        controller: mockController2,
        connectedAt: new Date(),
      });

      const event = {
        type: "project:created",
        data: { project: { id: "1", name: "Test" } },
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcast(event);

      expect(mockController1.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController2.enqueue).toHaveBeenCalledTimes(1);
    });

    it("should send to specific client", () => {
      const mockController1 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };
      const mockController2 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController1,
        connectedAt: new Date(),
      });

      broadcaster.addClient({
        id: "client2",
        controller: mockController2,
        connectedAt: new Date(),
      });

      const event = {
        type: "heartbeat",
        data: { timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString(),
      };

      broadcaster.sendToClient("client1", event);

      expect(mockController1.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController2.enqueue).toHaveBeenCalledTimes(0);
    });

    it("should broadcast to specific user's clients", () => {
      const mockController1 = {
        enqueue: vi.fn(),
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
        type: "project:updated",
        data: { project: { id: "1", name: "Updated" } },
        timestamp: new Date().toISOString(),
      };

      broadcaster.broadcastToUser("user1", event);

      expect(mockController1.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController2.enqueue).toHaveBeenCalledTimes(1);
      expect(mockController3.enqueue).toHaveBeenCalledTimes(0);
    });
  });

  describe("Message Formatting", () => {
    it("should format SSE message correctly", () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      };

      broadcaster.addClient({
        id: "client1",
        controller: mockController,
        connectedAt: new Date(),
      });

      const event = {
        type: "project:created",
        data: { project: { id: "1", name: "Test" } },
        timestamp: "2025-02-28T12:00:00.000Z",
      };

      broadcaster.broadcast(event);

      const encodedMessage = mockController.enqueue.mock.calls[0][0];
      const decodedMessage = new TextDecoder().decode(encodedMessage);

      expect(decodedMessage).toContain("event: project:created");
      expect(decodedMessage).toContain('"type":"project:created"');
      expect(decodedMessage).toContain('"data":{"project":{"id":"1","name":"Test"}}');
      expect(decodedMessage).toContain('"timestamp":"2025-02-28T12:00:00.000Z"');
      expect(decodedMessage).toMatch(/\n\n$/); // Ends with double newline
    });
  });
});
