# YouTube Monitoring System - Implementation Guide

## Quick Start

This guide walks you through setting up the YouTube Channel Monitoring system for Life Dashboard.

## Prerequisites

- PostgreSQL 14+ running
- Life Dashboard with task queue system
- Researcher agent configured and running
- Node.js 18+

## Step 1: Database Setup

### 1.1 Create Tables

Run the migration to create YouTube monitoring tables:

```bash
psql life_dashboard < sql/025_youtube_monitoring.sql
```

This creates:
- `youtube_channels` — Channel configurations
- `youtube_videos` — Discovered videos
- `youtube_monitoring_runs` — Monitoring execution history

Verify installation:

```bash
psql life_dashboard -c "\dt youtube_*"
```

You should see three tables listed.

## Step 2: Environment Configuration

### 2.1 For RSS-Based Monitoring (Recommended for Testing)

RSS feeds don't require authentication and have no rate limits. No additional configuration needed.

### 2.2 For API-Based Monitoring

If using YouTube Data API v3, you need an API key:

1. **Create Google Cloud Project:**
   ```
   https://console.cloud.google.com/
   ```

2. **Enable YouTube Data API v3:**
   - Click "Enable APIs and Services"
   - Search "YouTube Data API v3"
   - Click "Enable"

3. **Create API Credential:**
   - Go to "Credentials" in left sidebar
   - Click "Create Credentials" → "API Key"
   - Copy the API key

4. **Add to `.env.local`:**
   ```env
   YOUTUBE_API_KEY=your_api_key_here
   ```

   Or use a custom variable name:
   ```env
   CUSTOM_YOUTUBE_API_KEY=your_api_key_here
   ```

## Step 3: Add Channels to Monitor

### 3.1 Via TypeScript (Recommended for Setup)

Create a simple script to add channels:

```typescript
// scripts/setup-youtube-channels.ts

import { addChannel } from "@/lib/youtube-monitor";

const channels = [
  {
    name: "Anthropic",
    channelId: "UCVHFbqXqoYvEWM1Ddxl0QDg",
    channelUrl: "https://www.youtube.com/@AnthropicAI",
    feedType: "rss" as const,
    rssUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCVHFbqXqoYvEWM1Ddxl0QDg",
    checkIntervalMinutes: 30,
  },
  {
    name: "3Blue1Brown",
    channelId: "UCYO_jab_esuFRV4b-je9pww",
    channelUrl: "https://www.youtube.com/@3blue1brown",
    feedType: "rss" as const,
    rssUrl: "https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b-je9pww",
    checkIntervalMinutes: 60,
  },
];

async function setup() {
  for (const ch of channels) {
    try {
      const channel = await addChannel(
        ch.name,
        ch.channelId,
        ch.channelUrl,
        ch.feedType,
        ch.rssUrl,
        undefined,
        ch.checkIntervalMinutes
      );
      console.log(`✅ Added channel: ${channel.name}`);
    } catch (error) {
      console.error(`❌ Failed to add ${ch.name}:`, error);
    }
  }
}

setup().catch(console.error);
```

Run it:

```bash
npx tsx scripts/setup-youtube-channels.ts
```

### 3.2 Via HTTP API

```bash
# Add Anthropic channel (RSS)
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Anthropic",
    "channelId": "UCVHFbqXqoYvEWM1Ddxl0QDg",
    "channelUrl": "https://www.youtube.com/@AnthropicAI",
    "feedType": "rss",
    "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCVHFbqXqoYvEWM1Ddxl0QDg",
    "checkIntervalMinutes": 30
  }'

# Add another channel (API-based)
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "3Blue1Brown",
    "channelId": "UCYO_jab_esuFRV4b-je9pww",
    "channelUrl": "https://www.youtube.com/@3blue1brown",
    "feedType": "api",
    "apiKeyEnv": "YOUTUBE_API_KEY",
    "checkIntervalMinutes": 60
  }'
```

### 3.3 Find YouTube Channel IDs

To find a channel's ID:

1. Go to the YouTube channel page
2. Right-click → View Page Source
3. Search for `"browseId":"UC`
4. Copy the ID after "UC" (e.g., `UCYO_jab_esuFRV4b-je9pww`)

Or use this pattern:
- For `https://www.youtube.com/@channelname`, ID is in channel's "About" section
- For `https://www.youtube.com/c/ChannelName`, extract from URL
- For `https://www.youtube.com/user/UserName`, check channel info

## Step 4: Configure Cron Scheduling

### 4.1 Add to Cron Handlers

Edit `src/lib/cron-handlers.ts` to include YouTube monitoring:

```typescript
import { handleYouTubeMonitoring } from "@/lib/cron-handlers/youtube-monitoring";

export const CRON_JOBS = [
  // ... existing jobs
  {
    id: "youtube-monitoring",
    schedule: "*/5 * * * *", // Every 5 minutes
    handler: handleYouTubeMonitoring,
    description: "Monitor YouTube channels for new videos",
  },
];
```

### 4.2 Adjust Schedule

Recommended schedules:

- **Every 5 minutes** (for active channels, uses more API quota):
  ```
  */5 * * * *
  ```

- **Every 15 minutes** (balanced):
  ```
  */15 * * * *
  ```

- **Every hour** (for less frequent channels):
  ```
  0 * * * *
  ```

- **Multiple times daily** (e.g., 6 AM, 12 PM, 6 PM):
  ```
  0 6,12,18 * * *
  ```

## Step 5: Configure Researcher Agent

The system automatically delegates video analysis to the `researcher` agent. Ensure:

1. **Researcher Agent is Running**
   - Via gateway: Check `/api/relay/status`
   - Agent should have `researcher` ID in configuration

2. **Task Queue is Processing**
   - Check `src/lib/task-queue.ts` is integrated with orchestrator
   - Verify tasks are being picked up: `SELECT * FROM task_queue WHERE type = 'youtube_video_analysis'`

3. **Conversation System Active**
   - Verify `src/lib/conversations.ts` is working
   - Test: `SELECT COUNT(*) FROM conversations`

## Step 6: Manual Testing

### 6.1 Verify Setup

Check channels are in database:

```bash
psql life_dashboard -c "SELECT id, name, feed_type, enabled FROM youtube_channels;"
```

### 6.2 Trigger Manual Monitoring

```bash
# Get channel ID from previous query, then:
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "uuid-from-above" }'
```

Expected response:
```json
{
  "success": true,
  "run": {
    "id": "run-uuid",
    "channel_id": "channel-uuid",
    "status": "success",
    "videos_found": 25,
    "new_videos": 3,
    "duration_ms": 1245
  },
  "message": "Monitoring completed for Anthropic. Found 3 new video(s)."
}
```

### 6.3 Check Discovered Videos

```bash
curl "http://localhost:3000/api/youtube/videos?status=pending&limit=10"
```

Expected response:
```json
{
  "videos": [
    {
      "id": "video-uuid",
      "video_id": "dQw4w9WgXcQ",
      "title": "Introduction to Claude 3",
      "watch_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "status": "analyzing",
      "discovered_at": "2024-02-27T10:30:00Z"
    }
  ],
  "total": 3
}
```

### 6.4 Check Task Queue

Verify analysis tasks were created:

```bash
psql life_dashboard -c "SELECT id, type, status FROM task_queue WHERE type = 'youtube_video_analysis' LIMIT 5;"
```

### 6.5 Check Researcher Agent Progress

In another terminal, watch researcher agent:

```bash
# If using tmux monitoring
pnpm monitor

# Or check messages
curl "http://localhost:3000/api/messages/researcher?limit=10"
```

## Step 7: Verify End-to-End Workflow

1. **Manual Monitoring Triggered**
   ```bash
   curl -X POST http://localhost:3000/api/youtube/monitor \
     -H "Content-Type: application/json" \
     -d '{ "channelId": "your-channel-id" }'
   ```

2. **New Videos Discovered**
   ```bash
   curl "http://localhost:3000/api/youtube/videos?status=pending"
   ```
   Should show videos with `status: 'analyzing'`

3. **Researcher Agent Analyzes**
   - Check researcher agent is processing:
     ```bash
     curl "http://localhost:3000/api/relay/status"
     ```
   - Check conversation messages:
     ```bash
     psql life_dashboard -c "SELECT * FROM conversation_messages ORDER BY created_at DESC LIMIT 5;"
     ```

4. **Analysis Completes**
   - After researcher responds, check video status:
     ```bash
     curl "http://localhost:3000/api/youtube/videos?status=analyzed"
     ```
   - Check analysis result:
     ```bash
     psql life_dashboard -c "SELECT id, title, analysis_result FROM youtube_videos WHERE status = 'analyzed' LIMIT 1\gx"
     ```

5. **Get Analysis Summary**
   ```bash
   curl "http://localhost:3000/api/youtube/analysis?type=videos"
   ```

## Monitoring and Maintenance

### Check Monitoring Health

```bash
# Get next check times for all channels
psql life_dashboard << EOF
SELECT
  name,
  last_checked_at,
  check_interval_minutes,
  (last_checked_at + (check_interval_minutes || ' minutes')::INTERVAL) as next_check
FROM youtube_channels
ORDER BY next_check;
EOF
```

### View Monitoring History

```bash
# Last 20 monitoring runs
psql life_dashboard << EOF
SELECT
  c.name,
  r.status,
  r.videos_found,
  r.new_videos,
  r.duration_ms,
  r.run_at
FROM youtube_monitoring_runs r
JOIN youtube_channels c ON r.channel_id = c.id
ORDER BY r.run_at DESC
LIMIT 20;
EOF
```

### Check for Failed Analyses

```bash
# Videos that failed analysis
psql life_dashboard << EOF
SELECT
  id,
  title,
  error_message,
  analyzed_at
FROM youtube_videos
WHERE status = 'failed'
ORDER BY analyzed_at DESC;
EOF
```

### Monitor Task Queue Status

```bash
# Pending YouTube analysis tasks
psql life_dashboard << EOF
SELECT
  id,
  agent_id,
  status,
  priority,
  created_at
FROM task_queue
WHERE type = 'youtube_video_analysis'
ORDER BY created_at DESC
LIMIT 10;
EOF
```

## Troubleshooting

### Issue: No Videos Discovered

**Check 1: Verify channel exists**
```bash
psql life_dashboard -c "SELECT name, feed_type, enabled FROM youtube_channels;"
```

**Check 2: Test RSS feed manually**
```bash
# For RSS channels, verify the URL works
curl -s "https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID" | head -20
```

**Check 3: Check monitoring runs**
```bash
psql life_dashboard -c "SELECT * FROM youtube_monitoring_runs ORDER BY run_at DESC LIMIT 5\gx"
```

**Solution:**
- Ensure channel is enabled: `UPDATE youtube_channels SET enabled = TRUE WHERE id = 'uuid'`
- Verify RSS URL is correct
- Check cron job is running (if schedule-based)

### Issue: Tasks Not Processing

**Check 1: Verify task queue**
```bash
psql life_dashboard -c "SELECT COUNT(*) FROM task_queue WHERE type = 'youtube_video_analysis';"
```

**Check 2: Check researcher agent**
```bash
curl "http://localhost:3000/api/relay/status"
```

**Solution:**
- Ensure researcher agent is connected and running
- Check gateway logs: `pnpm gateway:logs`
- Manually retry: Add agent messages to restart

### Issue: Analysis Not Completing

**Check conversation messages:**
```bash
psql life_dashboard << EOF
SELECT from, content, created_at FROM conversation_messages
WHERE conversation_id IN (
  SELECT conversation_id FROM youtube_videos WHERE status = 'analyzing'
)
ORDER BY created_at DESC
LIMIT 10;
EOF
```

**Solution:**
- Check researcher agent logs
- Verify JSON response format in agent output
- Manually update video status if stuck:
  ```bash
  psql life_dashboard -c "UPDATE youtube_videos SET status = 'pending' WHERE status = 'analyzing' AND analyzed_at IS NULL;"
  ```

### Issue: API Rate Limiting (YouTube Data API)

**Check usage:**
```bash
# Monitor API quota at: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas
```

**Solution:**
- Switch to RSS-based monitoring (no quota limits)
- Increase check intervals (reduce frequency)
- Use different API keys for different channels
- Request quota increase in Google Cloud Console

## Performance Tuning

### Optimize for Large Channel Lists

If monitoring 20+ channels:

1. **Increase cron interval:**
   ```typescript
   {
     id: "youtube-monitoring",
     schedule: "*/10 * * * *", // Every 10 minutes instead of 5
     handler: handleYouTubeMonitoring,
   }
   ```

2. **Reduce check frequency per channel:**
   ```typescript
   // When adding channels, use 60+ minute intervals for less frequent channels
   checkIntervalMinutes: 60
   ```

3. **Use RSS over API:**
   - RSS feeds are unlimited and faster
   - API has 10,000 units/day quota

### Optimize for Many Videos

If channels upload many videos daily:

1. **Batch analysis:**
   - Modify researcher to analyze 3-5 videos per request
   - Reduces conversation overhead

2. **Increase task concurrency:**
   ```typescript
   // In orchestrator.ts
   const maxConcurrentTasks = 5; // Up from 3
   ```

3. **Archive old videos:**
   ```sql
   -- Archive analyzed videos older than 90 days
   UPDATE youtube_videos
   SET status = 'archived'
   WHERE analyzed_at < NOW() - INTERVAL '90 days';
   ```

## Next Steps

1. ✅ Database setup complete
2. ✅ Add channels to monitor
3. ✅ Configure cron scheduling
4. ✅ Test manual monitoring
5. **Next:** Set up UI dashboard to visualize videos and analysis results

## Additional Resources

- **Main Documentation:** `docs/youtube-monitoring-system.md`
- **API Reference:** See API examples in main docs
- **Database Schema:** `sql/025_youtube_monitoring.sql`
- **Cron Handler:** `src/lib/cron-handlers/youtube-monitoring.ts`
- **Researcher Workflow:** `src/lib/youtube-video-analyzer.ts`

## Support

For issues or questions:

1. Check **Troubleshooting** section above
2. Review **Monitoring and Maintenance** for health checks
3. Check logs:
   ```bash
   pnpm gateway:logs
   tail -f uploads/logs/youtube-monitoring.log
   ```
4. Query monitoring history and error messages in database

---

**Last Updated:** 2024-02-27
**Version:** 1.0
