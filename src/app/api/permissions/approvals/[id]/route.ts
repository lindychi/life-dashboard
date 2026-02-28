/**
 * Single Approval Request API
 * GET: Get approval details
 * PATCH: Respond to approval (approve/deny)
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import {
  getApprovalRequest,
  respondToApproval,
} from "@/lib/permission-approvals";

export const dynamic = "force-dynamic";

// GET: Get approval details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: session or relay key
  const authResult = await verifyAuth(request);
  const relayKey = request.headers.get("x-relay-key");

  if (!authResult.authenticated && !validateRelayKey(relayKey || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const approval = await getApprovalRequest(id);

    if (!approval) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    return NextResponse.json({ approval });
  } catch (error) {
    console.error("[permissions/approvals/[id]] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch approval" },
      { status: 500 }
    );
  }
}

// PATCH: Respond to approval
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth: session only (user must approve via dashboard)
  const authResult = await verifyAuth(request);

  if (!authResult.authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      status: "approved" | "denied";
      respondedBy?: string;
    };

    const { status, respondedBy } = body;

    if (!status || (status !== "approved" && status !== "denied")) {
      return NextResponse.json(
        { error: "Invalid status. Must be 'approved' or 'denied'" },
        { status: 400 }
      );
    }

    // Use email from auth if respondedBy not provided
    const responder = respondedBy || authResult.email || "user";

    const { id } = await params;
    const approval = await respondToApproval(id, status, responder);

    if (!approval) {
      return NextResponse.json(
        { error: "Approval not found or already responded to" },
        { status: 404 }
      );
    }

    return NextResponse.json({ approval });
  } catch (error) {
    console.error("[permissions/approvals/[id]] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to respond to approval" },
      { status: 500 }
    );
  }
}
