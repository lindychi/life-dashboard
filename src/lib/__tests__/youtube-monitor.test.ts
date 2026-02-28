/**
 * Tests for YouTube Monitor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addChannel, getChannel, getEnabledChannels } from "@/lib/youtube-monitor";
import { query, queryOne } from "@/lib/db";

// Mock dependencies
vi.mock("@/lib/db");
vi.mock("@/lib/history");
vi.mock("@/lib/messages");
vi.mock("@/lib/conversations");
vi.mock("@/lib/sse-broadcaster");
vi.mock("@/lib/youtube-parser");
vi.mock("@/lib/youtube-api");
vi.mock("@/lib/task-queue");

describe("YouTube Monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addChannel", () => {
    it("should add a new RSS channel", async () => {
      const mockChannel = {
        id: "uuid-1",
        name: "Test Channel",
        channel_id: "UCxxxx",
        channel_url: "https://youtube.com/@testchannel",
        feed_type: "rss" as const,
        rss_url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx",
        api_key_env: null,
        check_interval_minutes: 30,
        last_checked_at: null,
        last_video_id: null,
        enabled: true,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockChannel as any);

      const channel = await addChannel(
        "Test Channel",
        "UCxxxx",
        "https://youtube.com/@testchannel",
        "rss",
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx",
        undefined,
        30
      );

      expect(channel).toEqual(mockChannel);
      expect(queryOne).toHaveBeenCalled();
    });

    it("should add a new API channel", async () => {
      const mockChannel = {
        id: "uuid-2",
        name: "API Channel",
        channel_id: "UCyyyy",
        channel_url: "https://youtube.com/@apichannel",
        feed_type: "api" as const,
        rss_url: null,
        api_key_env: "YOUTUBE_API_KEY",
        check_interval_minutes: 20,
        last_checked_at: null,
        last_video_id: null,
        enabled: true,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockChannel as any);

      const channel = await addChannel(
        "API Channel",
        "UCyyyy",
        "https://youtube.com/@apichannel",
        "api",
        undefined,
        "YOUTUBE_API_KEY",
        20
      );

      expect(channel).toEqual(mockChannel);
    });
  });

  describe("getChannel", () => {
    it("should return a channel by ID", async () => {
      const mockChannel = {
        id: "uuid-1",
        name: "Test Channel",
        channel_id: "UCxxxx",
        channel_url: "https://youtube.com/@testchannel",
        feed_type: "rss" as const,
        enabled: true,
      };

      vi.mocked(queryOne).mockResolvedValueOnce(mockChannel as any);

      const channel = await getChannel("uuid-1");

      expect(channel).toEqual(mockChannel);
      expect(queryOne).toHaveBeenCalledWith(
        "SELECT * FROM youtube_channels WHERE id = $1",
        ["uuid-1"]
      );
    });

    it("should return null if channel not found", async () => {
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const channel = await getChannel("nonexistent");

      expect(channel).toBeNull();
    });
  });

  describe("getEnabledChannels", () => {
    it("should return all enabled channels", async () => {
      const mockChannels = [
        {
          id: "uuid-1",
          name: "Channel 1",
          enabled: true,
        },
        {
          id: "uuid-2",
          name: "Channel 2",
          enabled: true,
        },
      ];

      vi.mocked(query).mockResolvedValueOnce(mockChannels as any);

      const channels = await getEnabledChannels();

      expect(channels).toHaveLength(2);
      expect(query).toHaveBeenCalledWith(
        "SELECT * FROM youtube_channels WHERE enabled = TRUE"
      );
    });

    it("should return empty array if no channels enabled", async () => {
      vi.mocked(query).mockResolvedValueOnce([]);

      const channels = await getEnabledChannels();

      expect(channels).toEqual([]);
    });
  });
});
