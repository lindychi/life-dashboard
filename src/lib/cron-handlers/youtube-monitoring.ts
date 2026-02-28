/**
 * YouTube Channel Monitoring Cron Handler
 * Runs periodically to check for new videos across all monitored channels
 */

import { getEnabledChannels, monitorChannel, channelNeedsMonitoring } from "@/lib/youtube-monitor";
import { addHistoryEntry } from "@/lib/history";
import { broadcastSSE } from "@/lib/sse-broadcaster";

interface CronExecutionResult {
  channelsChecked: number;
  newVideosFound: number;
  failedChannels: number;
  duration: number;
  errors: Array<{
    channel: string;
    error: string;
  }>;
}

/**
 * Main cron handler for YouTube monitoring
 * Should be called every 5-10 minutes by the cron scheduler
 */
export async function handleYouTubeMonitoring(): Promise<CronExecutionResult> {
  const startTime = Date.now();
  const result: CronExecutionResult = {
    channelsChecked: 0,
    newVideosFound: 0,
    failedChannels: 0,
    duration: 0,
    errors: [],
  };

  try {
    // Get all enabled channels
    const channels = await getEnabledChannels();

    if (channels.length === 0) {
      console.log("[YouTube Monitoring] No channels configured");
      return result;
    }

    // Check which channels need monitoring
    const channelsToCheck = [];
    for (const channel of channels) {
      if (await channelNeedsMonitoring(channel)) {
        channelsToCheck.push(channel);
      }
    }

    console.log(
      `[YouTube Monitoring] Found ${channelsToCheck.length} channels that need checking`
    );

    // Monitor each channel in parallel (with concurrency limit)
    const concurrency = 3;
    for (let i = 0; i < channelsToCheck.length; i += concurrency) {
      const batch = channelsToCheck.slice(i, i + concurrency);
      const promises = batch.map((channel) =>
        monitorChannel(channel.id)
          .then((run) => {
            result.channelsChecked++;
            result.newVideosFound += run.new_videos;
            return { success: true, run };
          })
          .catch((error) => {
            result.failedChannels++;
            result.errors.push({
              channel: channel.name,
              error: error instanceof Error ? error.message : "Unknown error",
            });
            console.error(`[YouTube Monitoring] Failed to monitor ${channel.name}:`, error);
            return { success: false, error };
          })
      );

      await Promise.all(promises);
    }

    result.duration = Date.now() - startTime;

    // Log execution
    await addHistoryEntry("youtube-monitoring-cron", {
      type: "status_change",
      content: `YouTube monitoring: ${result.channelsChecked} checked, ${result.newVideosFound} new videos`,
      metadata: {
        channelsChecked: result.channelsChecked,
        newVideosFound: result.newVideosFound,
        failedChannels: result.failedChannels,
        durationMs: result.duration,
        errors: result.errors,
      } as Record<string, unknown>,
    });

    // Broadcast completion event
    broadcastSSE({
      type: "youtube:monitoring:cycle_complete",
      data: {
        channelsChecked: result.channelsChecked,
        newVideosFound: result.newVideosFound,
        failedChannels: result.failedChannels,
      },
      timestamp: new Date().toISOString(),
    });

    console.log(
      `[YouTube Monitoring] Cycle complete: ${result.channelsChecked} checked, ${result.newVideosFound} new videos, ${result.failedChannels} failed (${result.duration}ms)`
    );

    return result;
  } catch (error) {
    result.duration = Date.now() - startTime;
    console.error("[YouTube Monitoring] Fatal error:", error);

    await addHistoryEntry("youtube-monitoring-cron", {
      type: "task_failed",
      content: `YouTube monitoring failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      metadata: {
        error: error instanceof Error ? error.message : "Unknown error",
        durationMs: result.duration,
      },
    });

    throw error;
  }
}

/**
 * Get monitoring schedule summary
 */
export async function getMonitoringScheduleSummary(): Promise<{
  totalChannels: number;
  enabledChannels: number;
  nextCheckTimes: Array<{
    name: string;
    lastChecked?: string;
    nextCheckIn: string;
  }>;
}> {
  const channels = await getEnabledChannels();
  const now = new Date();

  const nextCheckTimes = channels.map((channel) => {
    const lastChecked = channel.last_checked_at ? new Date(channel.last_checked_at) : null;
    let nextCheckIn = "Never";

    if (lastChecked) {
      const nextCheck = new Date(lastChecked.getTime() + channel.check_interval_minutes * 60000);
      const diffMinutes = Math.round((nextCheck.getTime() - now.getTime()) / 60000);
      if (diffMinutes > 0) {
        nextCheckIn = `${diffMinutes}m`;
      } else {
        nextCheckIn = "Now";
      }
    } else {
      nextCheckIn = "Now";
    }

    return {
      name: channel.name,
      lastChecked: lastChecked?.toISOString(),
      nextCheckIn,
    };
  });

  return {
    totalChannels: channels.length,
    enabledChannels: channels.filter((c) => c.enabled).length,
    nextCheckTimes,
  };
}
