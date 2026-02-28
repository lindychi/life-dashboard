/**
 * YouTube Feed Parser
 * Handles RSS feed parsing and video extraction
 */

import { parseStringPromise } from "xml2js";

export interface ParsedVideo {
  id: string;
  title: string;
  description?: string;
  publishedAt: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

/**
 * Parse YouTube RSS feed and extract video data
 * Supports standard RSS feeds from YouTube channels
 */
export async function parseRSSFeed(feedUrl: string): Promise<ParsedVideo[]> {
  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const parsed = await parseStringPromise(xmlText);

    // Extract videos from RSS feed
    const entries = parsed.feed?.entry || [];
    const videos: ParsedVideo[] = entries.map((entry: any) => {
      const videoId = extractVideoId(entry.id?.[0]);
      const title = entry.title?.[0];
      const description = entry.content?.[0]?._;
      const publishedAt = entry.published?.[0];
      const thumbnail =
        entry["media:thumbnail"]?.[0]?.$ || entry["media:thumbnail"]?.[0];

      return {
        id: videoId,
        title,
        description,
        publishedAt,
        thumbnailUrl: thumbnail?.url,
      };
    });

    return videos.filter((v) => v.id && v.title);
  } catch (error) {
    throw new Error(
      `RSS feed parsing failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Extract video ID from YouTube URL or entry ID
 */
function extractVideoId(idString: string): string {
  // YouTube video ID is typically yt:video:XXXXX or in the URL
  const match = idString.match(/(?:yt:video:|v=)?([a-zA-Z0-9_-]{11})/);
  return match?.[1] || idString;
}

/**
 * Extract YouTube channel ID from various URL formats
 */
export function extractChannelId(url: string): string {
  // Handles: youtube.com/@channelname, youtube.com/channel/CHANNELID, youtube.com/c/channelname
  const patterns = [
    /youtube\.com\/channel\/([^/?]+)/, // /channel/ID format
    /youtube\.com\/@([^/?]+)/, // /@handle format
    /youtube\.com\/c\/([^/?]+)/, // /c/name format
    /youtube\.com\/user\/([^/?]+)/, // /user/name format
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract channel ID from URL: ${url}`);
}

/**
 * Generate RSS feed URL from channel handle or ID
 */
export function generateRSSFeedUrl(channelIdOrHandle: string): string {
  // YouTube RSS feed format: https://www.youtube.com/feeds/videos.xml?channel_id=CHANNELID
  // If it's a handle (starts with @), we need to resolve it first (handled by YouTube API)
  // For now, assume it's a channel ID
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdOrHandle}`;
}

/**
 * Validate YouTube URL
 */
export function isValidYouTubeUrl(url: string): boolean {
  return (
    /youtube\.com\/(channel|@|c|user)\/[^\s/?]+/.test(url) ||
    /youtu\.be\/[^\s/?]+/.test(url)
  );
}

/**
 * Parse YouTube watch URL and extract video ID
 */
export function parseWatchUrl(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/, // Standard formats
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/, // Embed format
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
