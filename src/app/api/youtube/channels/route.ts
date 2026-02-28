/**
 * GET /api/youtube/channels
 * POST /api/youtube/channels
 *
 * List all YouTube channels or add a new one
 */

import { NextRequest, NextResponse } from "next/server";
import { getEnabledChannels, addChannel } from "@/lib/youtube-monitor";
import { verifyAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const channels = await getEnabledChannels();
    return NextResponse.json(channels);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch channels" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      channelId,
      channelUrl,
      feedType,
      rssUrl,
      apiKeyEnv,
      checkIntervalMinutes,
    } = body;

    if (!name || !channelId || !channelUrl || !feedType) {
      return NextResponse.json(
        { error: "Missing required fields: name, channelId, channelUrl, feedType" },
        { status: 400 }
      );
    }

    if (feedType === "rss" && !rssUrl) {
      return NextResponse.json(
        { error: "RSS URL required for RSS feed type" },
        { status: 400 }
      );
    }

    if (feedType === "api" && !apiKeyEnv) {
      return NextResponse.json(
        { error: "API key env variable required for API feed type" },
        { status: 400 }
      );
    }

    const channel = await addChannel(
      name,
      channelId,
      channelUrl,
      feedType,
      rssUrl,
      apiKeyEnv,
      checkIntervalMinutes || 30
    );

    return NextResponse.json(channel, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add channel" },
      { status: 500 }
    );
  }
}
