# YouTube Channel Monitoring & Automated Video Analysis

## 🎯 System Overview

A fully-featured YouTube channel monitoring system that automatically detects new videos and delegates analysis to your researcher AI agent. Integrates seamlessly with Life Dashboard's task queue, conversation system, and real-time SSE updates.

**Key Capabilities:**
- ✅ Periodic monitoring of YouTube channels (RSS or API)
- ✅ Automatic new video detection with deduplication
- ✅ Structured video analysis delegation to researcher agent
- ✅ Real-time SSE events for UI updates
- ✅ Complete analysis result storage and retrieval
- ✅ Channel-wide insights aggregation
- ✅ Full audit trail and execution history

## 📚 Documentation

### Getting Started
- **[Setup Guide](YOUTUBE_SETUP.md)** — Step-by-step installation & configuration
- **[System Architecture](docs/youtube-monitoring-system.md)** — Detailed technical reference
- **[Implementation Summary](YOUTUBE_IMPLEMENTATION_SUMMARY.md)** — High-level overview

### Quick Reference
- Database: `sql/025_youtube_monitoring.sql`
- Core libraries: `src/lib/youtube-*.ts`
- API routes: `src/app/api/youtube/*/route.ts`
- Cron handler: `src/lib/cron-handlers/youtube-monitoring.ts`

## 🚀 Quick Start (5 minutes)

### 1. Setup Database
```bash
psql life_dashboard < sql/025_youtube_monitoring.sql
```

### 2. Add YouTube Channels

Via HTTP (simplest):
```bash
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
```

### 3. Enable Monitoring (add to cron handlers)

Edit `src/lib/cron-handlers.ts`:
```typescript
import { handleYouTubeMonitoring } from "@/lib/cron-handlers/youtube-monitoring";

export const CRON_JOBS = [
  // ... existing jobs
  {
    id: "youtube-monitoring",
    schedule: "*/5 * * * *",
    handler: handleYouTubeMonitoring,
    description: "Monitor YouTube channels for new videos",
  },
];
```

### 4. Test Manually
```bash
# Get channel ID from database
curl http://localhost:3000/api/youtube/channels

# Trigger monitoring
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "your-channel-uuid" }'

# Check for new videos
curl "http://localhost:3000/api/youtube/videos?status=analyzing"

# Get analysis results (after researcher completes)
curl "http://localhost:3000/api/youtube/analysis"
```

## 📊 Architecture

### Data Flow
```
YouTube Channel
      ↓
   Monitor (RSS/API)
      ↓
  Detect New Videos
      ↓
  Create Conversation + Task
      ↓
  Send to Researcher Agent
      ↓
  Parse JSON Response
      ↓
  Store Analysis + Broadcast SSE
      ↓
   UI Dashboard / API
```

### Key Components

| Component | Purpose | Status |
|-----------|---------|--------|
| `youtube_channels` table | Store monitored channels | ✅ |
| `youtube_videos` table | Track discovered videos | ✅ |
| `youtube_monitoring_runs` table | Execution history | ✅ |
| RSS/API parsers | Fetch videos | ✅ |
| Researcher workflow | Analyze videos | ✅ |
| Conversation system | Multi-turn analysis | ✅ |
| Task queue | Async processing | ✅ |
| SSE events | Real-time updates | ✅ |
| API routes | HTTP endpoints | ✅ |

## 🔌 API Reference

### Channels

#### List Channels
```bash
GET /api/youtube/channels
```
Response:
```json
[
  {
    "id": "uuid",
    "name": "Channel Name",
    "channel_id": "UCxxx",
    "feed_type": "rss",
    "check_interval_minutes": 30,
    "enabled": true,
    "last_checked_at": "2024-02-27T10:30:00Z"
  }
]
```

#### Add Channel
```bash
POST /api/youtube/channels
Content-Type: application/json

{
  "name": "Channel Name",
  "channelId": "UCxxx",
  "channelUrl": "https://youtube.com/@channel",
  "feedType": "rss|api",
  "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx",
  "apiKeyEnv": "YOUTUBE_API_KEY",
  "checkIntervalMinutes": 30
}
```

### Videos

#### List Videos
```bash
GET /api/youtube/videos?channelId=uuid&status=pending&limit=50
```

#### Trigger Monitoring
```bash
POST /api/youtube/monitor
Content-Type: application/json

{ "channelId": "uuid" }
```

### Analysis

#### Get Analyzed Videos
```bash
GET /api/youtube/analysis?channelId=uuid&limit=20
```

#### Get Channel Insights
```bash
GET /api/youtube/analysis?channelId=uuid&type=insights
```

Response:
```json
{
  "totalAnalyzed": 15,
  "commonTopics": [
    { "topic": "AI", "frequency": 12 },
    { "topic": "LLMs", "frequency": 10 }
  ],
  "sentimentDistribution": {
    "positive": 10,
    "neutral": 4,
    "negative": 1
  },
  "topSummaries": ["...", "..."]
}
```

## 🎬 Video Analysis Workflow

### How It Works

1. **Detection** — New video published on monitored channel
2. **Discovery** — RSS/API polling detects new video
3. **Storage** — Video inserted with `status: 'pending'`
4. **Delegation** — Conversation + task created for researcher
5. **Analysis** — Researcher agent analyzes video
6. **Processing** — JSON response parsed and stored
7. **Publishing** — SSE event broadcast to UI

### Analysis Output

The researcher returns a structured JSON analysis:

```json
{
  "summary": "2-3 sentence overview of video content",
  "keyInsights": [
    "Key insight 1",
    "Key insight 2",
    "Key insight 3"
  ],
  "topics": ["topic1", "topic2", "topic3"],
  "sentiment": "positive|neutral|negative",
  "targetAudience": "Description of intended audience",
  "actionableTakeaways": [
    "Actionable takeaway 1",
    "Actionable takeaway 2"
  ],
  "relatedTopics": ["related1", "related2", "related3"],
  "additionalNotes": "Any other observations"
}
```

## 📈 Monitoring & Insights

### Check Monitoring Status
```bash
psql life_dashboard << EOF
SELECT
  name,
  feed_type,
  last_checked_at,
  (last_checked_at + (check_interval_minutes || ' minutes')::INTERVAL) as next_check
FROM youtube_channels
ORDER BY next_check;
EOF
```

### View Recent Analyses
```bash
curl "http://localhost:3000/api/youtube/analysis?limit=10"
```

### Get Channel Trends
```bash
curl "http://localhost:3000/api/youtube/analysis?channelId=uuid&type=insights"
```

Response shows:
- Most common topics across videos
- Sentiment distribution
- Sample summaries from recent videos

## ⚙️ Configuration

### Monitoring Frequency

Per-channel configuration:
```typescript
// Very frequent (requires many API calls)
checkIntervalMinutes: 5

// Moderate (balanced)
checkIntervalMinutes: 30

// Infrequent (for slower channels)
checkIntervalMinutes: 120
```

Cron schedule (in handlers):
```typescript
// Every 5 minutes
schedule: "*/5 * * * *"

// Every 15 minutes
schedule: "*/15 * * * *"

// Every hour
schedule: "0 * * * *"
```

### RSS vs API

| Feature | RSS | API |
|---------|-----|-----|
| Rate limit | None | 10k units/day |
| Authentication | None | API key required |
| Quota cost | 0 | ~60 units/request |
| Setup complexity | Low | High |
| Speed | Medium | Fast |
| **Recommended** | ✅ Yes | For high-volume |

**Recommendation:** Start with RSS for 1-5 channels, switch to API if monitoring 10+ channels.

## 🔧 Customization

### Custom Analysis Prompts

Edit `src/lib/youtube-video-analyzer.ts` function `buildAnalysisPrompt()`:

```typescript
function buildAnalysisPrompt(task: VideoAnalysisTask): string {
  return `
# Custom Analysis Prompt

Your instructions here...

## Additional Requirements
- Include X in your analysis
- Focus on Y aspects
- Consider Z factors

## Output Format
[Your custom JSON schema]
  `;
}
```

### Batch Video Analysis

Modify to analyze multiple videos per request:

```typescript
// In youtube-monitor.ts, modify insertAndAnalyzeVideo() to batch
const videosToAnalyze = newVideos.slice(0, 5); // Group 5 videos
const payload = {
  type: "batch_youtube_analysis",
  videos: videosToAnalyze,
};
```

### Custom Metadata Storage

Store additional data in `youtube_channels.metadata` JSONB:

```typescript
await addChannel(
  name, channelId, channelUrl, feedType,
  rssUrl, apiKeyEnv, checkIntervalMinutes
);

// Then update with custom metadata
const result = await query(`
  UPDATE youtube_channels
  SET metadata = jsonb_build_object(
    'tags', ARRAY['tag1', 'tag2'],
    'category', 'education',
    'priority', 'high'
  )
  WHERE id = $1
  RETURNING *
`, [channelId]);
```

## 🐛 Troubleshooting

### No Videos Detected

**Step 1: Verify channel exists**
```bash
psql life_dashboard -c "SELECT * FROM youtube_channels WHERE enabled = TRUE;"
```

**Step 2: Test RSS feed**
```bash
curl -s "https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID" | head -20
```

**Step 3: Check monitoring runs**
```bash
psql life_dashboard -c "SELECT * FROM youtube_monitoring_runs ORDER BY run_at DESC LIMIT 5;"
```

**Solutions:**
- Enable channel: `UPDATE youtube_channels SET enabled = TRUE WHERE id = 'uuid'`
- Verify RSS URL format
- Check cron job is running

### Analysis Not Starting

**Check task queue:**
```bash
psql life_dashboard -c "SELECT * FROM task_queue WHERE type = 'youtube_video_analysis';"
```

**Check researcher connection:**
```bash
curl http://localhost:3000/api/relay/status
```

**Solutions:**
- Restart researcher agent
- Check gateway logs: `pnpm gateway:logs`
- Verify task queue is processing

### API Rate Limiting

**Check quota usage:**
- Go to https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas

**Solutions:**
- Switch to RSS-based monitoring
- Increase check intervals
- Request quota increase in Google Cloud

## 📊 Real-time Updates (SSE)

The system broadcasts SSE events for real-time UI updates:

```javascript
// Client-side
const eventSource = new EventSource('/api/sse');

eventSource.addEventListener('youtube:video:discovered', (e) => {
  const data = JSON.parse(e.data);
  console.log('New video found:', data.data.title);
});

eventSource.addEventListener('youtube:video:analyzed', (e) => {
  const data = JSON.parse(e.data);
  console.log('Analysis complete:', data.data.analysis);
});
```

## 🔒 Security

### API Authentication
- All endpoints require valid session cookie or JWT token
- Authentication checked via `verifyAuth()` middleware
- API key stored in environment variables (never in code)

### Data Protection
- Video data stored in PostgreSQL with proper permissions
- Analysis results stored as JSONB with access controls
- Conversation system provides audit trail

### Best Practices
- Don't commit API keys to git
- Use environment variables for secrets
- Rotate API keys periodically
- Monitor API usage and billing

## 📈 Performance

### Monitoring Large Channel Lists

With 20+ channels:
- Set cron interval to 10-15 minutes (instead of 5)
- Use RSS feeds (no quota limits)
- Stagger channel check intervals

### Analyzing Many Videos

With 10+ videos/day:
- Implement batch analysis (5 videos per request)
- Increase task queue concurrency
- Archive old videos to separate storage

### Database Optimization

Indexes automatically created:
```sql
-- Fast channel lookups
CREATE INDEX idx_youtube_channels_enabled ON youtube_channels(enabled);
CREATE INDEX idx_youtube_channels_last_checked ON youtube_channels(last_checked_at);

-- Fast video queries
CREATE INDEX idx_youtube_videos_channel_status ON youtube_videos(channel_id, status);
CREATE INDEX idx_youtube_videos_published ON youtube_videos(published_at DESC);
```

## 🚀 Deployment

### Production Checklist

- [ ] Database migration applied
- [ ] Environment variables configured
- [ ] Researcher agent connected
- [ ] Cron job added to handlers
- [ ] Test channels added
- [ ] Manual monitoring tested
- [ ] First video analysis completed
- [ ] SSE events verified
- [ ] UI dashboard created (optional)
- [ ] Monitoring health checks enabled

### Cloud Deployment (Railway)

The system integrates with your existing Railway deployment:

1. Database is on Railway PostgreSQL
2. API routes run on Next.js app
3. Cron jobs run on app server
4. Researcher agent via gateway connector

No additional infrastructure needed.

## 📚 Additional Resources

### Documentation Files
- `docs/youtube-monitoring-system.md` — Complete technical reference
- `YOUTUBE_SETUP.md` — Detailed setup guide
- `YOUTUBE_IMPLEMENTATION_SUMMARY.md` — Architecture overview

### Database Schema
- `sql/025_youtube_monitoring.sql` — All tables and indexes

### Code Examples
```typescript
// Add channel
import { addChannel } from "@/lib/youtube-monitor";
const channel = await addChannel(...);

// Monitor channel
import { monitorChannel } from "@/lib/youtube-monitor";
const run = await monitorChannel(channelId);

// Get analysis
import { getAnalyzedVideos } from "@/lib/youtube-video-analyzer";
const videos = await getAnalyzedVideos(channelId);

// Get insights
import { generateChannelInsights } from "@/lib/youtube-video-analyzer";
const insights = await generateChannelInsights(channelId);
```

## 🔮 Future Enhancements

1. **Transcript Integration** — Fetch and analyze video captions
2. **Comment Analysis** — Analyze top comments for sentiment
3. **Engagement Tracking** — Monitor views/likes/comments over time
4. **Webhook Support** — Real-time YouTube notifications
5. **UI Dashboard** — Visual gallery with analysis results
6. **Batch Analysis** — Analyze multiple videos in single task
7. **Custom Templates** — Per-channel analysis templates
8. **Export Features** — Download analysis as PDF/CSV

## 💡 Tips & Tricks

### Monitor Multiple Channels Efficiently
```bash
# Add multiple channels
for channel_id in UCxxx UCyyy UCzzz; do
  curl -X POST http://localhost:3000/api/youtube/channels \
    -H "Content-Type: application/json" \
    -d "{ ... }"
done
```

### Get Daily Summary
```bash
# Query for today's videos
psql life_dashboard << EOF
SELECT title, status, discovered_at
FROM youtube_videos
WHERE discovered_at >= NOW() - INTERVAL '1 day'
ORDER BY discovered_at DESC;
EOF
```

### Export Analysis
```bash
# Export as JSON
psql life_dashboard -c "SELECT * FROM youtube_videos WHERE status = 'analyzed'" --json > videos.json
```

## ❓ FAQ

**Q: How often are channels checked?**
A: Configurable per channel (default 30 min). Cron runs every 5 min but respects per-channel intervals.

**Q: Do I need YouTube API key?**
A: No, RSS feeds work without authentication. Use API only for channels with limited RSS access.

**Q: How long does analysis take?**
A: Depends on researcher agent availability. Usually 1-5 minutes per video.

**Q: Can I analyze old videos?**
A: Yes, but only new videos are auto-detected. To analyze old videos, use the API to manually enqueue them.

**Q: What if analysis fails?**
A: Video marked as `failed` with error message. Can be retried manually.

## 📞 Support

For issues:
1. Check [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) troubleshooting section
2. Review database health via `psql life_dashboard`
3. Check researcher agent logs: `pnpm gateway:logs`
4. Query task queue: `SELECT * FROM task_queue WHERE type = 'youtube_video_analysis'`

---

**Version:** 1.0
**Last Updated:** 2024-02-27
**Status:** ✅ Production Ready

For detailed technical documentation, see [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md)
