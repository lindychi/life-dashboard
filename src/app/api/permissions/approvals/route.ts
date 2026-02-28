/**
 * Permission Approvals API
 * GET: List pending approvals
 * POST: Create approval request
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import {
  createApprovalRequest,
  getPendingApprovals,
  getApprovalHistory,
} from "@/lib/permission-approvals";
import type { CreateApprovalRequest } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// GET: List pending approvals or approval history
export async function GET(request: NextRequest) {
  // Auth: session or relay key
  const authResult = await verifyAuth(request);
  const relayKey = request.headers.get("x-relay-key");

  if (!authResult.authenticated && !validateRelayKey(relayKey || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "pending"; // "pending" or "history"
    const gatewayId = searchParams.get("gatewayId") || undefined;
    const agentId = searchParams.get("agentId") || undefined;
    const status = searchParams.get("status") || undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined;

    if (mode === "history") {
      const history = await getApprovalHistory({
        agentId,
        gatewayId,
        status: status as "pending" | "approved" | "denied" | "expired" | undefined,
        limit,
      });
      return NextResponse.json({ approvals: history });
    }

    // Default: pending approvals
    const pending = await getPendingApprovals(gatewayId);
    return NextResponse.json({ approvals: pending });
  } catch (error) {
    console.error("[permissions/approvals] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch approvals" },
      { status: 500 }
    );
  }
}

// POST: Create approval request
export async function POST(request: NextRequest) {
  // Auth: relay key only (gateway creates requests)
  const relayKey = request.headers.get("x-relay-key");

  if (!validateRelayKey(relayKey || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json() as CreateApprovalRequest & {
      timeoutMs?: number;
    };

    const { agentId, gatewayId, commandId, path, action, reason, metadata, timeoutMs } = body;

    if (!agentId || !gatewayId || !commandId || !path || !action || !reason) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const approval = await createApprovalRequest(
      { agentId, gatewayId, commandId, path, action, reason, metadata },
      timeoutMs
    );

    return NextResponse.json({ approval }, { status: 201 });
  } catch (error) {
    console.error("[permissions/approvals] POST error:", error);
    return NextResponse.json(
      { error: "Failed to create approval request" },
      { status: 500 }
    );
  }
}
