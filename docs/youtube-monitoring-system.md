# YouTube Channel Monitoring System

## Overview

The YouTube Monitoring System is an automated workflow that periodically monitors YouTube channels for new videos and automatically delegates video analysis to the researcher AI agent. It integrates with your Life Dashboard task queue, conversation system, and real-time SSE updates.

## Architecture

### Components

1. **Database Layer** (`sql/025_youtube_monitoring.sql`)
   - `youtube_channels` — Monitored channel configurations
   - `youtube_videos` — Discovered videos with analysis status
   - `youtube_monitoring_runs` — Execution history and metrics

2. **Core Libraries**
   - `src/lib/youtube-monitor.ts` — Channel monitoring orchestration
   - `src/lib/youtube-parser.ts` — RSS feed parsing
   - `src/lib/youtube-api.ts` — YouTube Data API v3 integration
   - `src/lib/youtube-video-analyzer.ts` — Researcher agent workflow

3. **Cron Handler**
   - `src/lib/cron-handlers/youtube-monitoring.ts` — Periodic monitoring scheduler

4. **API Routes**
   - `GET/POST /api/youtube/channels` — Channel management
   - `GET /api/youtube/videos` — Video listing and filtering
   - `POST /api/youtube/monitor` — Manual monitoring trigger
   - `GET /api/youtube/analysis` — Analysis results and insights

## Setup

### 1. Create Database Schema

```bash
psql life_dashboard < sql/025_youtube_monitoring.sql
```

This creates:
- `youtube_channels` table with RSS/API configuration
- `youtube_videos` table with analysis tracking
- `youtube_monitoring_runs` table with execution history
- Appropriate indexes and triggers

### 2. Configure Environment Variables

Add to `.env.local`:

```env
# YouTube API Configuration (for API-based monitoring)
YOUTUBE_API_KEY=your_youtube_api_key_here

# Or use a custom env variable name:
CUSTOM_YOUTUBE_API_KEY=your_api_key_here
```

**Getting a YouTube API Key:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable "YouTube Data API v3"
4. Create an OAuth 2.0 credential (or API key for testing)
5. Copy the API key to your environment

### 3. Add Channels to Monitor

Use the API or TypeScript directly:

```typescript
import { addChannel } from "@/lib/youtube-monitor";

// Via RSS feed (simpler, no auth required)
const channel1 = await addChannel(
  "Example Channel",
  "UCxxx...", // Channel ID
  "https://www.youtube.com/@examplechannel",
  "rss",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx...",
  undefined,
  30 // Check every 30 minutes
);

// Via YouTube API
const channel2 = await addChannel(
  "Another Channel",
  "UCyyy...",
  "https://www.youtube.com/@anotherchannel",
  "api",
  undefined,
  "YOUTUBE_API_KEY", // Env variable name
  20 // Check every 20 minutes
);
```

Or via HTTP:

```bash
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example Channel",
    "channelId": "UCxxx...",
    "channelUrl": "https://www.youtube.com/@examplechannel",
    "feedType": "rss",
    "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx...",
    "checkIntervalMinutes": 30
  }'
```

## Usage

### Monitoring Flow

1. **Periodic Check** (via cron)
   - Cron scheduler triggers every 5-10 minutes
   - Checks all enabled channels that need monitoring
   - Fetches latest videos from RSS or API

2. **New Video Detection**
   - Compares fetched videos against database
   - Inserts new videos with `status: 'pending'`

3. **Researcher Agent Delegation**
   - Creates a conversation session per video
   - Enqueues analysis task in task queue
   - Sends structured analysis prompt to researcher agent

4. **Analysis Processing**
   - Researcher agent watches the conversation
   - Analyzes video content (title, description, metadata)
   - Returns JSON with summary, insights, topics, sentiment
   - Results stored in `youtube_videos.analysis_result`

5. **Real-time Updates**
   - SSE events broadcast to connected clients
   - UI updates with new videos and analysis results

### Manual Monitoring

Trigger monitoring manually for a specific channel:

```bash
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "uuid-of-channel" }'
```

### List Channels

```bash
curl http://localhost:3000/api/youtube/channels
```

### List Videos

```bash
# All videos
curl http://localhost:3000/api/youtube/videos

# By channel
curl "http://localhost:3000/api/youtube/videos?channelId=uuid&status=pending"

# By status
curl "http://localhost:3000/api/youtube/videos?status=analyzed&limit=20"
```

### Get Analysis Results

```bash
# All analyzed videos
curl http://localhost:3000/api/youtube/analysis

# Channel insights
curl "http://localhost:3000/api/youtube/analysis?channelId=uuid&type=insights"
```

## Analysis Workflow

### How Researcher Agent Works

When a new video is detected:

1. **Conversation Creation**
   ```typescript
   const conversation = await createConversation({
     title: `YouTube Video Analysis: ${videoTitle}`,
     participants: ["researcher", "system"],
     context: { videoId, watchUrl, channelId },
     createdBy: "system",
   });
   ```

2. **Task Enqueuing**
   ```typescript
   const task = await enqueueTask({
     type: "youtube_video_analysis",
     agentId: "researcher",
     priority: "normal",
     payload: { videoId, youtubeVideoId, title, description, watchUrl, conversationId },
   });
   ```

3. **Structured Analysis Prompt**
   The system sends a detailed prompt requesting:
   - Summary (2-3 sentences)
   - Key insights (3-5 bullet points)
   - Topics and themes (tags)
   - Sentiment analysis
   - Target audience
   - Actionable takeaways
   - Related topics

4. **JSON Response Processing**
   Researcher returns analysis in JSON format within markdown code block:
   ```json
   {
     "summary": "Video explores...",
     "keyInsights": ["insight1", "insight2"],
     "topics": ["topic1", "topic2"],
     "sentiment": "positive",
     "targetAudience": "...",
     "actionableTakeaways": ["..."],
     "relatedTopics": ["..."],
     "additionalNotes": "..."
   }
   ```

5. **Result Storage**
   ```typescript
   await updateVideoAnalysis(videoId, "analyzed", {
     summary: "...",
     keyInsights: [...],
     topics: [...],
     sentiment: "positive",
     metadata: {
       analyzedAt: "...",
       model: "claude-3-sonnet",
       tokensUsed: 1250,
     },
   });
   ```

## SSE Real-time Events

The system broadcasts SSE events for real-time UI updates:

### Monitoring Events
- `youtube:monitoring:completed` — Monitoring cycle finished
- `youtube:monitoring:cycle_complete` — Batch monitoring finished

### Video Events
- `youtube:video:discovered` — New video found
- `youtube:video:analyzing` — Analysis started
- `youtube:video:analyzed` — Analysis completed
- `youtube:video:analysis_failed` — Analysis failed

### Channel Events
- `youtube:channel:added` — New channel added

### Event Structure
```typescript
{
  type: "youtube:video:analyzed",
  data: {
    videoId: "uuid",
    analysis: {
      summary: "...",
      keyInsights: [...],
      topics: [...],
      sentiment: "positive",
      metadata: { analyzedAt, model, tokensUsed }
    }
  }
}
```

## Database Schema Details

### youtube_channels

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `name` | TEXT | User-friendly channel name |
| `channel_id` | TEXT | YouTube channel ID |
| `channel_url` | TEXT | YouTube channel URL |
| `feed_type` | TEXT | `'rss'` or `'api'` |
| `rss_url` | TEXT | RSS feed URL (for RSS type) |
| `api_key_env` | TEXT | Env variable name for API key |
| `check_interval_minutes` | INT | Polling interval (default: 30) |
| `last_checked_at` | TIMESTAMP | Last monitoring timestamp |
| `last_video_id` | TEXT | Latest video ID (for deduplication) |
| `enabled` | BOOLEAN | Whether to monitor |
| `metadata` | JSONB | Custom config/tags |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### youtube_videos

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to youtube_channels |
| `video_id` | TEXT | YouTube video ID |
| `title` | TEXT | Video title |
| `description` | TEXT | Video description |
| `published_at` | TIMESTAMP | Publication time |
| `duration_seconds` | INT | Video duration |
| `thumbnail_url` | TEXT | Thumbnail image URL |
| `watch_url` | TEXT | YouTube watch URL |
| `status` | TEXT | `'pending'`, `'analyzing'`, `'analyzed'`, `'failed'` |
| `analysis_result` | JSONB | Researcher analysis output |
| `researcher_task_id` | UUID | FK to task_queue |
| `conversation_id` | UUID | FK to conversations |
| `error_message` | TEXT | Error message if failed |
| `discovered_at` | TIMESTAMP | Detection timestamp |
| `analyzed_at` | TIMESTAMP | Analysis completion timestamp |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

### youtube_monitoring_runs

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `channel_id` | UUID | FK to youtube_channels |
| `run_at` | TIMESTAMP | Execution timestamp |
| `status` | TEXT | `'success'` or `'failure'` |
| `videos_found` | INT | Total videos found |
| `new_videos` | INT | Newly discovered count |
| `error_message` | TEXT | Error details if failed |
| `duration_ms` | INT | Execution duration |
| `created_at` | TIMESTAMP | Creation timestamp |

## Cron Integration

Add to your cron scheduler (in `src/lib/cron-handlers.ts`):

```typescript
import { handleYouTubeMonitoring } from "@/lib/cron-handlers/youtube-monitoring";

// Add to cron jobs list
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

Or run manually:

```typescript
import { handleYouTubeMonitoring } from "@/lib/cron-handlers/youtube-monitoring";

const result = await handleYouTubeMonitoring();
console.log(`Checked ${result.channelsChecked} channels, found ${result.newVideosFound} new videos`);
```

## Task Queue Integration

The system integrates with your task queue:

1. **Task Type**: `youtube_video_analysis`
2. **Agent**: `researcher`
3. **Priority**: `normal`
4. **Payload Structure**:
   ```typescript
   {
     videoId: string; // UUID
     youtubeVideoId: string; // YouTube video ID
     title: string;
     description?: string;
     watchUrl: string;
     conversationId: string;
   }
   ```

## Conversation Integration

Each video analysis uses the conversation system:

- **Session Title**: `"YouTube Video Analysis: {title}"`
- **Participants**: `["researcher", "system"]`
- **Context**: Video metadata (videoId, watchUrl, channelId)
- **Messages**: Structured Q&A between system and researcher

Example conversation flow:

1. System → Researcher: Analysis prompt with video details
2. Researcher → System: Analysis response with JSON
3. System → Dashboard: SSE event with results

## Error Handling

### RSS Feed Failures
- Logged to history with error details
- Channel remains enabled for retry
- Exponential backoff available (future enhancement)

### API Rate Limiting
- YouTube API v3 has quotas (default: 10,000 units/day)
- Monitor `youtube_monitoring_runs` for failures
- Use RSS feeds for unlimited polling

### Analysis Failures
- Video marked with `status: 'failed'`
- Error message stored in `error_message` column
- Can be retried manually

## Monitoring and Analytics

### Get Channel Status

```typescript
import { getMonitoringScheduleSummary } from "@/lib/cron-handlers/youtube-monitoring";

const summary = await getMonitoringScheduleSummary();
console.log(`Total channels: ${summary.totalChannels}`);
console.log(`Next checks:`, summary.nextCheckTimes);
```

### Get Channel Insights

```typescript
import { generateChannelInsights } from "@/lib/youtube-video-analyzer";

const insights = await generateChannelInsights(channelId);
console.log(`Common topics:`, insights.commonTopics);
console.log(`Sentiment distribution:`, insights.sentimentDistribution);
```

### Query Monitoring History

```typescript
import { getMonitoringHistory } from "@/lib/youtube-monitor";

const history = await getMonitoringHistory(channelId, 100);
// Returns 100 most recent monitoring runs
```

## Performance Considerations

### Concurrency
- Monitoring runs up to 3 channels in parallel
- Task queue handles researcher agent distribution

### Deduplication
- Each video is unique per channel (UNIQUE constraint on channel_id + video_id)
- Last video ID tracking prevents duplicate processing

### Indexing
- `youtube_channels(enabled, last_checked_at)` — Fast channel filtering
- `youtube_videos(channel_id, status)` — Fast video filtering by status
- `youtube_videos(published_at)` — Fast chronological queries
- `youtube_monitoring_runs(channel_id)` — Fast history queries

## Future Enhancements

1. **Transcript Integration**
   - Fetch video captions/transcripts
   - Send full transcript to researcher for deep analysis

2. **Comment Analysis**
   - Analyze top comments for sentiment/themes
   - Include in researcher analysis

3. **Engagement Metrics**
   - Track views, likes, comments over time
   - Generate performance reports

4. **Webhooks**
   - Real-time YouTube notifications (requires webhook setup)
   - Reduces polling overhead

5. **Batch Processing**
   - Process multiple videos in single researcher task
   - Summarize trends across videos

6. **Custom Analysis Templates**
   - Allow different analysis prompts per channel
   - Domain-specific insights (e.g., tech vs. creative channels)

## Troubleshooting

### No Videos Detected
- Check channel is enabled: `SELECT enabled FROM youtube_channels WHERE id = ?`
- Verify RSS URL is valid (for RSS type): Visit URL in browser
- Check YouTube API quota (for API type): Look at Google Cloud Console
- Run manual monitoring: `curl -X POST .../api/youtube/monitor`

### Analysis Not Starting
- Check task queue is processing: `SELECT * FROM task_queue WHERE type = 'youtube_video_analysis'`
- Verify researcher agent is connected: Check gateway status
- Check conversation system: `SELECT * FROM conversations WHERE context->>'videoId' = ?`

### Missing Videos
- Verify monitoring was run: `SELECT * FROM youtube_monitoring_runs`
- Check video deduplication: Videos with same `video_id` won't be re-added
- Manual check: `SELECT * FROM youtube_videos WHERE channel_id = ?`

## API Examples

### Create Channel (RSS)
```bash
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tech Talk Daily",
    "channelId": "UCxxxxxxxxxxxxxx",
    "channelUrl": "https://www.youtube.com/@techtalkdaily",
    "feedType": "rss",
    "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxxxxxxxxx",
    "checkIntervalMinutes": 30
  }'
```

### Create Channel (API)
```bash
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI Research",
    "channelId": "UCyyyyyyyyyyyyyyyy",
    "channelUrl": "https://www.youtube.com/@airesearch",
    "feedType": "api",
    "apiKeyEnv": "YOUTUBE_API_KEY",
    "checkIntervalMinutes": 20
  }'
```

### Get Videos Pending Analysis
```bash
curl "http://localhost:3000/api/youtube/videos?status=pending&limit=10"
```

### Get Analyzed Videos
```bash
curl "http://localhost:3000/api/youtube/videos?status=analyzed&limit=20"
```

### Get Channel Insights
```bash
curl "http://localhost:3000/api/youtube/analysis?channelId=uuid&type=insights"
```

### Trigger Manual Monitoring
```bash
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "uuid" }'
```
