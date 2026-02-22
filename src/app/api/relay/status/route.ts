import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getConnectedGateways, getAllAgentStatuses } from "@/lib/relay";

// Dashboard에서 현재 상태 조회
export async function GET(request: NextRequest) {
  // 인증 체크
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const gateways = await getConnectedGateways();
    const agents = await getAllAgentStatuses();

    return NextResponse.json({
      gateways,
      agents,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Status error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
