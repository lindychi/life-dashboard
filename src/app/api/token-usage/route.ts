import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validateRelayKey } from "@/lib/relay";
import { isDbConnectionError } from "@/lib/db";
import {
  getOverviewMetrics,
  getDailySummary,
  getAgentSummary,
  getModelDistribution,
  getEcomodeComparison,
  getRecentUsage,
  recordTokenUsage,
  type ModelTier,
} from "@/lib/token-tracker";

/**
 * GET /api/token-usage
 * Token usage metrics overview
 *
 * Query params:
 *   view: "overview" | "daily" | "agents" | "models" | "ecomode" | "recent" (default: "overview")
 *   days: number (default: 7)
 *   agentId?: string (filter for "recent" view)
 *   model?: string (filter for "recent" view)
 *   cursor?: string (pagination for "recent" view)
 *   limit?: number (for "recent" view, default: 50)
 */
export async function GET(request: NextRequest) {
  // Auth: session or relay key
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  const user = relayValid ? null : await getCurrentUser();
  if (!relayValid && !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "overview";
    const days = parseInt(searchParams.get("days") || "7", 10);

    switch (view) {
      case "overview": {
        const metrics = await getOverviewMetrics(days);
        return NextResponse.json(metrics);
      }
      case "daily": {
        const summary = await getDailySummary(days);
        return NextResponse.json({ summary, days });
      }
      case "agents": {
        const agents = await getAgentSummary(days);
        return NextResponse.json({ agents, days });
      }
      case "models": {
        const distribution = await getModelDistribution(days);
        return NextResponse.json({ distribution, days });
      }
      case "ecomode": {
        const comparison = await getEcomodeComparison(days);
        return NextResponse.json({ comparison, days });
      }
      case "recent": {
        const agentId = searchParams.get("agentId") || undefined;
        const model = (searchParams.get("model") || undefined) as ModelTier | undefined;
        const cursor = searchParams.get("cursor") || undefined;
        const limit = parseInt(searchParams.get("limit") || "50", 10);
        const result = await getRecentUsage({ agentId, model, limit, cursor });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `Unknown view: ${view}` }, { status: 400 });
    }
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }
    console.error("Token usage metrics error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/token-usage
 * Record a token usage entry (called by gateway-connector via relay)
 *
 * Auth: relay key only (machine-to-machine)
 */
export async function POST(request: NextRequest) {
  const relayValid = validateRelayKey(
    request.headers.get("x-relay-key") || ""
  );
  if (!relayValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const entry = await recordTokenUsage({
      agentId: body.agentId,
      commandId: body.commandId,
      taskExecutionId: body.taskExecutionId,
      requestGroupId: body.requestGroupId,
      model: body.model,
      modelSource: body.modelSource,
      complexityScore: body.complexityScore,
      delegationCategory: body.delegationCategory,
      ecomode: body.ecomode ?? false,
      totalCostUsd: body.totalCostUsd,
      numTurns: body.numTurns,
      durationApiMs: body.durationApiMs,
      elapsedMs: body.elapsedMs,
      toolCallsCount: body.toolCallsCount ?? 0,
      success: body.success,
      exitCode: body.exitCode,
      isHung: body.isHung ?? false,
      retryCount: body.retryCount ?? 0,
      provider: body.provider ?? "claude",
      fallbackUsed: body.fallbackUsed ?? false,
      wasEscalated: body.wasEscalated ?? false,
      escalatedFrom: body.escalatedFrom,
      taskPreview: body.taskPreview,
      isComplex: body.isComplex ?? false,
    });

    return NextResponse.json({ success: true, id: entry.id });
  } catch (error) {
    if (isDbConnectionError(error)) {
      return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
    }
    console.error("Token usage record error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
