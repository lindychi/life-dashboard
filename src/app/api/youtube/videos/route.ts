/**
 * GET /api/youtube/videos
 *
 * List YouTube videos across all channels or for a specific channel
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const channelId = searchParams.get("channelId");
    const status = searchParams.get("status") || "pending";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    let queryStr =
      `SELECT v.*, c.name as channel_name FROM youtube_videos v
       LEFT JOIN youtube_channels c ON v.channel_id = c.id`;

    const params: any[] = [];

    if (channelId) {
      queryStr += ` WHERE v.channel_id = $${params.length + 1}`;
      params.push(channelId);
    }

    if (status) {
      const whereClause = params.length > 0 ? "AND" : "WHERE";
      queryStr += ` ${whereClause} v.status = $${params.length + 1}`;
      params.push(status);
    }

    queryStr += ` ORDER BY v.discovered_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const videos = await query(queryStr, params);

    return NextResponse.json({
      videos,
      total: videos.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch videos" },
      { status: 500 }
    );
  }
}
