import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey } from "@/lib/relay";
import { query, isDbConnectionError } from "@/lib/db";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { gatewayId, reason } = await request.json();

    if (!gatewayId) {
      return NextResponse.json(
        { error: "gatewayId is required" },
        { status: 400 }
      );
    }

    const result = await query<{ count: string }>(
      `
      UPDATE task_executions
      SET status = 'interrupted', recovery_reason = $2, completed_at = NOW()
      WHERE gateway_id = $1 AND status = 'running'
      RETURNING id
      `,
      [gatewayId, reason || "Gateway restart"]
    );

    return NextResponse.json({ count: result.length });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Error marking tasks as interrupted:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
