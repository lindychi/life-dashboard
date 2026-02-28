/**
 * GET /api/youtube/analysis
 *
 * Get analyzed videos and channel insights
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAnalyzedVideos,
  generateChannelInsights,
} from "@/lib/youtube-video-analyzer";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const channelId = searchParams.get("channelId");
    const type = searchParams.get("type") || "videos"; // 'videos' or 'insights'

    if (type === "insights" && !channelId) {
      return NextResponse.json(
        { error: "channelId required for insights" },
        { status: 400 }
      );
    }

    if (type === "insights") {
      const insights = await generateChannelInsights(channelId!);
      return NextResponse.json(insights);
    }

    // Default: return analyzed videos
    const videos = await getAnalyzedVideos(channelId || undefined);

    return NextResponse.json({
      videos,
      total: videos.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch analysis" },
      { status: 500 }
    );
  }
}
