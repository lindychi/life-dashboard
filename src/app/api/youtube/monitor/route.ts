/**
 * POST /api/youtube/monitor
 *
 * Manually trigger monitoring for a specific channel or all channels
 */

import { NextRequest, NextResponse } from "next/server";
import { getChannel, monitorChannel, getEnabledChannels } from "@/lib/youtube-monitor";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { channelId } = body;

    if (!channelId) {
      return NextResponse.json(
        { error: "channelId is required" },
        { status: 400 }
      );
    }

    const channel = await getChannel(channelId);
    if (!channel) {
      return NextResponse.json(
        { error: "Channel not found" },
        { status: 404 }
      );
    }

    const run = await monitorChannel(channelId);

    return NextResponse.json({
      success: true,
      run,
      message: `Monitoring completed for ${channel.name}. Found ${run.new_videos} new video(s).`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Monitoring failed" },
      { status: 500 }
    );
  }
}
