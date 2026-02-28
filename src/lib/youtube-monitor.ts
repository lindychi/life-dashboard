/**
 * YouTube Channel Monitoring Service
 * Handles periodic polling of YouTube channels via RSS or API
 */

import { query, queryOne } from "@/lib/db";
import { addHistoryEntry } from "@/lib/history";
import { sendMessage } from "@/lib/messages";
import { createConversation, addConversationMessage } from "@/lib/conversations";
import { broadcastSSE } from "@/lib/sse-broadcaster";
import { parseRSSFeed } from "@/lib/youtube-parser";
import { fetchYouTubeAPI } from "@/lib/youtube-api";
import { enqueueTask } from "@/lib/task-queue";

export interface YouTubeChannel {
  id: string;
  name: string;
  channel_id: string;
  channel_url: string;
  feed_type: "rss" | "api";
  rss_url?: string;
  api_key_env?: string;
  check_interval_minutes: number;
  last_checked_at?: string;
  last_video_id?: string;
  enabled: boolean;
}

export interface YouTubeVideo {
  id: string;
  channel_id: string;
  video_id: string;
  title: string;
  description?: string;
  published_at: string;
  duration_seconds?: number;
  thumbnail_url?: string;
  watch_url: string;
  status: "pending" | "analyzing" | "analyzed" | "failed";
}

export interface MonitoringRun {
  id: string;
  channel_id: string;
  status: "success" | "failure";
  videos_found: number;
  new_videos: number;
  error_message?: string;
  duration_ms: number;
}

/**
 * Get all enabled YouTube channels
 */
export async function getEnabledChannels(): Promise<YouTubeChannel[]> {
  const channels = await query<YouTubeChannel>(
    `SELECT * FROM youtube_channels WHERE enabled = TRUE`
  );
  return channels;
}

/**
 * Get a specific YouTube channel
 */
export async function getChannel(channelId: string): Promise<YouTubeChannel | null> {
  const channel = await queryOne<YouTubeChannel>(
    `SELECT * FROM youtube_channels WHERE id = $1`,
    [channelId]
  );
  return channel || null;
}

/**
 * Add a new YouTube channel to monitor
 */
export async function addChannel(
  name: string,
  channelId: string,
  channelUrl: string,
  feedType: "rss" | "api",
  rssUrl?: string,
  apiKeyEnv?: string,
  checkIntervalMinutes: number = 30
): Promise<YouTubeChannel> {
  const channel = await queryOne<YouTubeChannel>(
    `INSERT INTO youtube_channels
     (name, channel_id, channel_url, feed_type, rss_url, api_key_env, check_interval_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [name, channelId, channelUrl, feedType, rssUrl || null, apiKeyEnv || null, checkIntervalMinutes]
  );

  if (!channel) throw new Error("Failed to add YouTube channel");

  broadcastSSE({
    type: "youtube:channel:added",
    data: { channel },
  });

  return channel;
}

/**
 * Monitor a single channel for new videos
 */
export async function monitorChannel(channelId: string): Promise<MonitoringRun> {
  const startTime = Date.now();
  const channel = await getChannel(channelId);

  if (!channel) {
    throw new Error(`Channel ${channelId} not found`);
  }

  try {
    // Fetch videos from source
    let videos: Array<{
      id: string;
      title: string;
      description?: string;
      publishedAt: string;
      durationSeconds?: number;
      thumbnailUrl?: string;
    }>;

    if (channel.feed_type === "rss") {
      if (!channel.rss_url) throw new Error("RSS URL not configured");
      videos = await parseRSSFeed(channel.rss_url);
    } else {
      if (!channel.api_key_env) throw new Error("API key env not configured");
      const apiKey = process.env[channel.api_key_env];
      if (!apiKey) throw new Error(`API key not found in env: ${channel.api_key_env}`);
      videos = await fetchYouTubeAPI(channel.channel_id, apiKey);
    }

    // Detect new videos (those published after last checked or newer than last_video_id)
    let newVideosCount = 0;
    const newVideos: typeof videos = [];

    for (const video of videos) {
      // Check if video already exists in DB
      const existing = await queryOne<YouTubeVideo>(
        `SELECT id FROM youtube_videos WHERE channel_id = $1 AND video_id = $2`,
        [channelId, video.id]
      );

      if (!existing) {
        newVideos.push(video);
        newVideosCount++;
      }
    }

    // Insert new videos and trigger analysis workflow
    for (const video of newVideos) {
      await insertAndAnalyzeVideo(channelId, video);
    }

    // Update channel last_checked_at
    await query(
      `UPDATE youtube_channels
       SET last_checked_at = NOW(), last_video_id = $2
       WHERE id = $1`,
      [channelId, newVideos[0]?.id || channel.last_video_id || null]
    );

    // Log successful run
    const duration = Date.now() - startTime;
    const run = await queryOne<MonitoringRun>(
      `INSERT INTO youtube_monitoring_runs
       (channel_id, status, videos_found, new_videos, duration_ms)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [channelId, "success", videos.length, newVideosCount, duration]
    );

    // Record in history
    await addHistoryEntry("youtube-monitor", {
      type: "status_change",
      content: `YouTube: ${channel.name} — ${newVideosCount} new videos found`,
      metadata: {
        channel: channel.name,
        videosFound: videos.length,
        newVideos: newVideosCount,
        durationMs: duration,
      },
    });

    // Broadcast SSE event
    broadcastSSE({
      type: "youtube:monitoring:completed",
      data: {
        channel: channel.name,
        newVideos: newVideosCount,
        totalVideos: videos.length,
      },
    });

    return run!;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failed run
    const run = await queryOne<MonitoringRun>(
      `INSERT INTO youtube_monitoring_runs
       (channel_id, status, error_message, duration_ms)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [channelId, "failure", errorMessage, duration]
    );

    // Record in history
    await addHistoryEntry("youtube-monitor", {
      type: "task_failed",
      content: `YouTube monitoring failed: ${channel.name} — ${errorMessage}`,
      metadata: {
        channel: channel.name,
        error: errorMessage,
      },
    });

    throw error;
  }
}

/**
 * Insert a new video and trigger researcher analysis
 */
async function insertAndAnalyzeVideo(
  channelId: string,
  videoData: {
    id: string;
    title: string;
    description?: string;
    publishedAt: string;
    durationSeconds?: number;
    thumbnailUrl?: string;
  }
): Promise<void> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoData.id}`;

  // Insert video record
  const video = await queryOne<YouTubeVideo>(
    `INSERT INTO youtube_videos
     (channel_id, video_id, title, description, published_at, duration_seconds, thumbnail_url, watch_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      channelId,
      videoData.id,
      videoData.title,
      videoData.description || null,
      new Date(videoData.publishedAt).toISOString(),
      videoData.durationSeconds || null,
      videoData.thumbnailUrl || null,
      watchUrl,
      "pending",
    ]
  );

  if (!video) throw new Error("Failed to insert video");

  // Create conversation session for this video analysis
  const conversation = await createConversation({
    title: `YouTube Video Analysis: ${videoData.title}`,
    participants: ["researcher", "system"],
    context: {
      videoId: videoData.id,
      videoTitle: videoData.title,
      watchUrl,
      channelId,
    },
    createdBy: "system",
  });

  // Enqueue analysis task in task queue
  const task = await enqueueTask({
    title: `YouTube video analysis: ${videoData.title}`,
    type: "youtube_video_analysis",
    assignedAgent: "researcher",
    priority: 5,
    payload: {
      videoId: video.id,
      youtubeVideoId: videoData.id,
      videoTitle: videoData.title,
      description: videoData.description,
      watchUrl,
      conversationId: conversation.id,
    },
  });

  // Update video with task reference
  await query(
    `UPDATE youtube_videos SET researcher_task_id = $1, conversation_id = $2, status = $3 WHERE id = $4`,
    [task.id, conversation.id, "analyzing", video.id]
  );

  // Add initial message to conversation
  await addConversationMessage({
    conversationId: conversation.id,
    from: "system",
    content: `Analysis task queued for video: [${videoData.title}](${watchUrl})\n\nWaiting for researcher agent to analyze...`,
    type: "task",
    metadata: {
      taskId: task.id,
      videoId: video.id,
    },
  });

  broadcastSSE({
    type: "youtube:video:discovered",
    data: {
      video: {
        id: video.id,
        title: videoData.title,
        watchUrl,
      },
      taskQueued: true,
    },
  });
}

/**
 * Get videos pending analysis
 */
export async function getPendingVideos(limit: number = 10): Promise<YouTubeVideo[]> {
  const videos = await query<YouTubeVideo>(
    `SELECT * FROM youtube_videos WHERE status = 'pending' ORDER BY discovered_at ASC LIMIT $1`,
    [limit]
  );
  return videos;
}

/**
 * Get monitoring history for a channel
 */
export async function getMonitoringHistory(
  channelId: string,
  limit: number = 50
): Promise<MonitoringRun[]> {
  const runs = await query<MonitoringRun>(
    `SELECT * FROM youtube_monitoring_runs WHERE channel_id = $1 ORDER BY run_at DESC LIMIT $2`,
    [channelId, limit]
  );
  return runs;
}

/**
 * Update video analysis status and store results
 */
export async function updateVideoAnalysis(
  videoId: string,
  status: "analyzed" | "failed",
  analysisResult?: Record<string, any>,
  errorMessage?: string
): Promise<void> {
  await query(
    `UPDATE youtube_videos
     SET status = $1, analysis_result = $2, error_message = $3, analyzed_at = NOW()
     WHERE id = $4`,
    [
      status,
      analysisResult ? JSON.stringify(analysisResult) : null,
      errorMessage || null,
      videoId,
    ]
  );

  broadcastSSE({
    type: status === "analyzed" ? "youtube:video:analyzed" : "youtube:video:analysis_failed",
    data: { videoId, status },
  });
}

/**
 * Check if channel needs monitoring (based on interval)
 */
export async function channelNeedsMonitoring(channel: YouTubeChannel): Promise<boolean> {
  if (!channel.enabled) return false;

  if (!channel.last_checked_at) return true;

  const lastChecked = new Date(channel.last_checked_at);
  const now = new Date();
  const minutesSinceCheck = (now.getTime() - lastChecked.getTime()) / (1000 * 60);

  return minutesSinceCheck >= channel.check_interval_minutes;
}
