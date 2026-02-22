import { NextRequest, NextResponse } from "next/server";
import { validateRelayKey, registerGateway } from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get("x-relay-key");

  if (!apiKey || !validateRelayKey(apiKey)) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  try {
    const { gatewayId } = await request.json();

    if (!gatewayId) {
      return NextResponse.json(
        { error: "gatewayId required" },
        { status: 400 }
      );
    }

    const connection = await registerGateway(gatewayId);

    return NextResponse.json({
      success: true,
      connection,
    });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json(
        { error: "Database unavailable" },
        { status: 503 }
      );
    }
    console.error("Register error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
