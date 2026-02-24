import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey, updateCommandResult } from "@/lib/relay";

// Gateway reports command completion/failure
export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { gatewayId, commandId, status, result } = await request.json();

    if (!gatewayId || !commandId || !status) {
      return NextResponse.json(
        { error: "gatewayId, commandId, and status required" },
        { status: 400 }
      );
    }

    if (status !== "completed" && status !== "failed") {
      return NextResponse.json(
        { error: "status must be 'completed' or 'failed'" },
        { status: 400 }
      );
    }

    const updated = await updateCommandResult(
      gatewayId,
      commandId,
      status,
      result
    );

    return NextResponse.json({ success: updated });
  } catch (error) {
    console.error("Command result error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
