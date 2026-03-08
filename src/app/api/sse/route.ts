/**
 * SSE (Server-Sent Events) endpoint
 *
 * Provides real-time updates for dashboard data via Server-Sent Events.
 * Clients connect to this endpoint to receive live updates for:
 * - Projects (create/update/delete)
 * - Project metrics (KPIs)
 * - OKR objectives and key results
 * - Task status changes
 */

import { NextRequest } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { sseBroadcaster } from "@/lib/sse-broadcaster";
import type { SSEClient } from "@/lib/sse-broadcaster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verify authentication
  const authResult = await verifyAuth(request);
  if (!authResult.authenticated) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Generate unique client ID
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      // Register client with broadcaster
      const client: SSEClient = {
        id: clientId,
        controller,
        userId: authResult.email,
        connectedAt: new Date(),
      };

      const accepted = sseBroadcaster.addClient(client);
      if (!accepted) {
        // Connection limit reached — controller already closed by addClient
        return;
      }

      // Send initial connection message
      const welcomeMessage = new TextEncoder().encode(
        `event: connected\ndata: ${JSON.stringify({
          type: "connected",
          clientId,
          timestamp: new Date().toISOString(),
        })}\n\n`
      );
      controller.enqueue(welcomeMessage);
    },
    cancel() {
      // Client disconnected
      sseBroadcaster.removeClient(clientId);
    },
  });

  // Return SSE response
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
