# YouTube Monitoring System - Implementation Summary

## Overview

A comprehensive YouTube channel monitoring automation system has been designed and implemented for Life Dashboard. The system periodically monitors YouTube channels (via RSS or API) for new videos and automatically delegates video analysis to the researcher AI agent through the task queue and conversation system.

## What Was Built

### 1. Database Layer
**File:** `sql/025_youtube_monitoring.sql`

Three new PostgreSQL tables:
- `youtube_channels` — Channel configurations with RSS/API settings
- `youtube_videos` — Discovered videos with analysis tracking
- `youtube_monitoring_runs` — Monitoring execution history and metrics

**Key Features:**
- UNIQUE constraint on `(channel_id, video_id)` for deduplication
- Status tracking: `pending` → `analyzing` → `analyzed` | `failed`
- Links to task queue and conversation system
- Automatic timestamp triggers

### 2. Core Libraries

#### `src/lib/youtube-monitor.ts`
Main orchestration layer with functions:
- `getEnabledChannels()` — Get all active channels
- `addChannel()` — Add new channel to monitor
- `monitorChannel(channelId)` — Trigger monitoring for a channel
- `getPendingVideos()` — Get videos awaiting analysis
- `updateVideoAnalysis()` — Update analysis results
- `channelNeedsMonitoring()` — Check if channel is due for monitoring

**Key Flow:**
```
monitorChannel()
  → fetch videos (RSS or API)
  → detect new videos
  → insertAndAnalyzeVideo()
    → create conversation
    → enqueue task_queue entry
    → send structured prompt to researcher
```

#### `src/lib/youtube-parser.ts`
RSS feed parsing utilities:
- `parseRSSFeed(feedUrl)` — Parse YouTube RSS feeds
- `extractVideoId()` — Extract video ID from various formats
- `extractChannelId()` — Extract channel ID from URLs
- `generateRSSFeedUrl()` — Generate RSS URL from channel ID
- `parseWatchUrl()` — Parse YouTube watch URLs

**Supported Formats:**
- RSS feeds: `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNELID`
- Channel URLs: `youtube.com/@handle`, `youtube.com/channel/ID`, `youtube.com/c/name`
- Watch URLs: `youtube.com/watch?v=ID`, `youtu.be/ID`

#### `src/lib/youtube-api.ts`
YouTube Data API v3 integration:
- `fetchYouTubeAPI(channelId, apiKey)` — Fetch latest videos from channel
- `getVideoStats(videoId, apiKey)` — Get views, likes, comments
- `getVideoTranscripts(videoId, apiKey)` — Check transcript availability
- `parseDuration()` — Convert ISO 8601 duration to seconds

**Features:**
- Uses YouTube Data API v3
- Handles playlist queries for channel uploads
- Fetches video metadata (duration, thumbnails)
- Graceful handling of API errors

#### `src/lib/youtube-video-analyzer.ts`
Researcher agent workflow orchestration:
- `triggerVideoAnalysis(task)` — Send analysis request to researcher
- `processAnalysisResult()` — Parse and store researcher's response
- `getVideoAnalysis()` — Retrieve stored analysis
- `getAnalyzedVideos()` — Get all analyzed videos
- `generateChannelInsights()` — Aggregate insights across videos

**Analysis Prompt:**
Structured request requesting:
- Summary (2-3 sentences)
- Key insights (3-5 bullet points)
- Topics and themes (tags)
- Sentiment analysis
- Target audience
- Actionable takeaways
- Related topics

**Output Format:**
JSON structure with all above fields plus metadata (model, tokens, timestamp).

### 3. Cron Handler

**File:** `src/lib/cron-handlers/youtube-monitoring.ts`

Functions:
- `handleYouTubeMonitoring()` — Main cron handler
- `getMonitoringScheduleSummary()` — Get status of all channels

**Features:**
- Checks multiple channels in parallel (concurrency: 3)
- Logs execution to history
- Broadcasts SSE events
- Returns comprehensive results

**Integration:**
Add to `src/lib/cron-handlers.ts`:
```typescript
{
  id: "youtube-monitoring",
  schedule: "*/5 * * * *", // Every 5 minutes
  handler: handleYouTubeMonitoring,
  description: "Monitor YouTube channels for new videos",
}
```

### 4. API Routes

#### `GET/POST /api/youtube/channels`
- GET: List all enabled channels
- POST: Add new channel (RSS or API)

#### `GET /api/youtube/videos`
- List discovered videos
- Filter by channel, status, or limit
- Includes channel name in response

#### `POST /api/youtube/monitor`
- Manually trigger monitoring for a channel
- Returns run metrics

#### `GET /api/youtube/analysis`
- Get analyzed videos
- Get channel-wide insights (common topics, sentiment distribution)
- Filter by channel or type

### 5. Real-time Updates (SSE)

Broadcast events:
- `youtube:channel:added` — New channel added
- `youtube:video:discovered` — New video found
- `youtube:video:analyzing` — Analysis started
- `youtube:video:analyzed` — Analysis completed
- `youtube:video:analysis_failed` — Analysis failed
- `youtube:monitoring:completed` — Single monitoring finished
- `youtube:monitoring:cycle_complete` — Batch monitoring finished

### 6. Testing

**File:** `src/lib/__tests__/youtube-monitor.test.ts`

Test coverage for:
- Adding RSS and API channels
- Getting channels by ID
- Listing enabled channels
- Error handling

## Integration Points

### Task Queue
- Task type: `youtube_video_analysis`
- Agent: `researcher`
- Priority: `normal`
- Status tracking: `pending` → `processing` → `completed` | `failed`

### Conversation System
- Creates session per video
- Participants: `["researcher", "system"]`
- Message threading for Q&A
- Stores analysis results

### History System
- Logs monitoring cycles
- Logs new video discoveries
- Tracks analysis successes/failures
- Records error messages

### SSE Broadcaster
- Real-time video discovery events
- Real-time analysis completion
- Connection management

## Workflow Example

### Complete Flow: New Video → Analysis → Results

1. **Monitoring Triggered** (via cron or manual)
   ```
   cron: "*/5 * * * *" → handleYouTubeMonitoring()
   ```

2. **Channel Polled**
   ```typescript
   monitorChannel(channelId)
   → parseRSSFeed() or fetchYouTubeAPI()
   → returns [Video { id, title, description, publishedAt }]
   ```

3. **New Videos Detected**
   ```typescript
   // For each video not in database:
   insertAndAnalyzeVideo()
   ```

4. **Conversation Created**
   ```typescript
   const conversation = await createConversation({
     title: `YouTube Video Analysis: ${videoTitle}`,
     participants: ["researcher", "system"],
     context: { videoId, watchUrl, channelId },
   });
   ```

5. **Task Enqueued**
   ```typescript
   const task = await enqueueTask({
     type: "youtube_video_analysis",
     agentId: "researcher",
     payload: { videoId, youtubeVideoId, title, watchUrl, conversationId },
   });
   ```

6. **Analysis Request Sent**
   ```typescript
   await addConversationMessage({
     from: "system",
     content: buildAnalysisPrompt(video),
     type: "question",
   });
   ```

7. **Researcher Analyzes** (via agent loop)
   - Agent watches conversation
   - Fetches video metadata
   - Analyzes content
   - Returns JSON response

8. **Analysis Processed**
   ```typescript
   processAnalysisResult(videoId, responseContent)
   → parses JSON
   → stores in youtube_videos.analysis_result
   → broadcasts SSE event
   ```

9. **Results Available**
   - UI receives SSE event
   - Query via `/api/youtube/analysis`
   - Generate channel insights

## Key Features

### ✅ Monitoring
- **RSS-based** (unlimited, no auth) or **API-based** (with quota)
- Configurable check intervals per channel
- Deduplication via UNIQUE constraint
- Parallel monitoring (up to 3 channels concurrent)

### ✅ Analysis
- Structured analysis prompts to researcher
- JSON response parsing and validation
- Error handling and retry capability
- Complete analysis results stored

### ✅ Real-time Updates
- SSE events for video discovery
- SSE events for analysis completion
- Heartbeat connection management
- Auto-reconnect with exponential backoff

### ✅ Integration
- Task queue integration for async processing
- Conversation system for structured dialogue
- History tracking for audit trail
- Message system for agent communication

### ✅ Scalability
- Parallel channel monitoring (configurable)
- Indexed queries for fast filtering
- Deduplication prevents duplicate work
- Graceful error handling and recovery

## Configuration

### Monitoring Frequency
```typescript
// Per-channel configuration
const channel = await addChannel(
  name, channelId, channelUrl, feedType, rssUrl, apiKeyEnv,
  checkIntervalMinutes // 15-60 recommended
);

// Cron schedule
schedule: "*/5 * * * *", // Adjust based on total channels
```

### Researcher Customization
Edit analysis prompt in `youtube-video-analyzer.ts`:
- Modify request fields (add custom insights)
- Change output format (extend JSON schema)
- Add domain-specific instructions

### Task Priority
Modify in `youtube-monitor.ts`:
```typescript
const task = await enqueueTask({
  priority: "high", // Change from "normal"
  // ...
});
```

## Deployment Checklist

- [ ] Run database migration: `psql life_dashboard < sql/025_youtube_monitoring.sql`
- [ ] Add environment variables to `.env.local` (API key if using API)
- [ ] Add YouTube monitoring to cron handlers
- [ ] Add test channels via API or TypeScript script
- [ ] Verify cron job is running
- [ ] Test manual monitoring via `/api/youtube/monitor`
- [ ] Verify researcher agent is connected
- [ ] Check first video analysis completes
- [ ] Enable UI dashboard for videos/analysis

## Documentation Files

1. **Main System Docs:** `docs/youtube-monitoring-system.md`
   - Complete architecture reference
   - All functions and types documented
   - Database schema details
   - API examples

2. **Setup Guide:** `YOUTUBE_SETUP.md`
   - Step-by-step installation
   - Configuration instructions
   - Testing procedures
   - Troubleshooting guide

3. **This Summary:** `YOUTUBE_IMPLEMENTATION_SUMMARY.md`
   - High-level overview
   - Component descriptions
   - Integration points
   - Workflow examples

## Future Enhancements

1. **Transcript Integration**
   - Fetch video captions/transcripts
   - Include in analysis payload
   - Deep content analysis

2. **Comment Analysis**
   - Scrape top comments
   - Sentiment analysis of comments
   - Incorporate in insights

3. **Engagement Tracking**
   - Timeline tracking of views/likes/comments
   - Growth analytics
   - Performance comparisons

4. **Webhooks**
   - Real-time YouTube notifications
   - Eliminates polling overhead
   - Requires YouTube webhook setup

5. **Batch Analysis**
   - Multiple videos per researcher task
   - Trend identification
   - Efficiency improvement

6. **Custom Templates**
   - Per-channel analysis templates
   - Domain-specific insights
   - Dynamic prompt customization

7. **UI Dashboard**
   - Video gallery with thumbnails
   - Analysis results visualization
   - Channel insights dashboard
   - Timeline of new videos

## Files Created/Modified

### New Files Created
```
sql/025_youtube_monitoring.sql
src/lib/youtube-monitor.ts
src/lib/youtube-parser.ts
src/lib/youtube-api.ts
src/lib/youtube-video-analyzer.ts
src/lib/cron-handlers/youtube-monitoring.ts
src/app/api/youtube/channels/route.ts
src/app/api/youtube/videos/route.ts
src/app/api/youtube/monitor/route.ts
src/app/api/youtube/analysis/route.ts
src/lib/__tests__/youtube-monitor.test.ts
docs/youtube-monitoring-system.md
YOUTUBE_SETUP.md
YOUTUBE_IMPLEMENTATION_SUMMARY.md
```

### Files to Modify
```
src/lib/cron-handlers.ts — Add YouTube monitoring job
.env.example — Add YOUTUBE_API_KEY (optional)
```

## Quick Start Command

```bash
# 1. Setup database
psql life_dashboard < sql/025_youtube_monitoring.sql

# 2. Add test channels (create setup script from YOUTUBE_SETUP.md)
npx tsx scripts/setup-youtube-channels.ts

# 3. Add to cron handlers in src/lib/cron-handlers.ts

# 4. Start dev server
pnpm dev

# 5. Test manually
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "uuid-from-db" }'

# 6. Check results
curl http://localhost:3000/api/youtube/videos?status=analyzing
curl http://localhost:3000/api/youtube/analysis
```

## Support Resources

- Full documentation: `docs/youtube-monitoring-system.md`
- Setup instructions: `YOUTUBE_SETUP.md`
- Database schema: `sql/025_youtube_monitoring.sql`
- Example usage: API examples throughout docs
- Tests: `src/lib/__tests__/youtube-monitor.test.ts`

---

**System Version:** 1.0
**Last Updated:** 2024-02-27
**Status:** ✅ Complete Implementation
