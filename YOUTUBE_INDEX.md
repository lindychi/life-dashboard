# YouTube Monitoring System - Complete Documentation Index

## 📋 Quick Navigation

### For First-Time Setup
1. **Start here:** [YOUTUBE_README.md](YOUTUBE_README.md) — 5-minute overview
2. **Then follow:** [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) — Step-by-step installation
3. **Use this:** [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md) — Verification at each step

### For Technical Deep-Dive
- [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) — Complete architecture reference
- [YOUTUBE_IMPLEMENTATION_SUMMARY.md](YOUTUBE_IMPLEMENTATION_SUMMARY.md) — What was built and how

### For Troubleshooting
- [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Troubleshooting section
- [YOUTUBE_README.md](YOUTUBE_README.md) → FAQ & Performance sections

---

## 📚 Complete Documentation Structure

### Entry Points

| Document | Purpose | Read Time | Audience |
|----------|---------|-----------|----------|
| [YOUTUBE_README.md](YOUTUBE_README.md) | **Start here** — System overview, quick start, API reference | 10 min | Everyone |
| [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) | **Installation guide** — Step-by-step setup with troubleshooting | 30 min | DevOps, Admins |
| [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md) | **Verification** — Go/no-go checklist for each phase | 90 min | QA, Implementers |
| [YOUTUBE_IMPLEMENTATION_SUMMARY.md](YOUTUBE_IMPLEMENTATION_SUMMARY.md) | **Overview** — What was built, components, integration | 15 min | Architects, Leads |
| [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) | **Technical reference** — Complete API, database, workflow docs | 45 min | Developers |

---

## 🏗️ System Architecture

### High-Level Flow
```
YouTube Channel
       ↓
  RSS/API Poll
       ↓
 Detect New Videos
       ↓
  Store in DB
       ↓
  Create Conversation
       ↓
  Enqueue Task
       ↓
 Researcher Agent
       ↓
  Parse Analysis
       ↓
  Store Results
       ↓
 Broadcast SSE
       ↓
  UI/API Access
```

### Key Components

| Component | File(s) | Purpose |
|-----------|---------|---------|
| **Database** | `sql/025_youtube_monitoring.sql` | Schema: channels, videos, monitoring runs |
| **Monitor** | `src/lib/youtube-monitor.ts` | Main orchestration layer |
| **Parser** | `src/lib/youtube-parser.ts` | RSS feed parsing utilities |
| **API Integration** | `src/lib/youtube-api.ts` | YouTube Data API v3 client |
| **Analyzer** | `src/lib/youtube-video-analyzer.ts` | Researcher workflow orchestration |
| **Cron Handler** | `src/lib/cron-handlers/youtube-monitoring.ts` | Periodic monitoring scheduler |
| **API Routes** | `src/app/api/youtube/*/route.ts` | HTTP endpoints (4 files) |
| **Tests** | `src/lib/__tests__/youtube-monitor.test.ts` | Unit tests |

---

## 🔌 API Reference Quick Guide

### Endpoints Overview

```
GET  /api/youtube/channels               → List all channels
POST /api/youtube/channels               → Add new channel

GET  /api/youtube/videos                 → List videos (with filters)
GET  /api/youtube/videos?status=pending  → Pending videos only
GET  /api/youtube/videos?status=analyzed → Analyzed videos only

POST /api/youtube/monitor                → Trigger monitoring (manual)

GET  /api/youtube/analysis               → Get analyzed videos
GET  /api/youtube/analysis?type=insights → Get channel insights
```

### Quick API Examples

**Add a channel (RSS):**
```bash
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Channel Name",
    "channelId": "UCxxx",
    "channelUrl": "https://youtube.com/@channel",
    "feedType": "rss",
    "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCxxx",
    "checkIntervalMinutes": 30
  }'
```

**Trigger monitoring:**
```bash
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "uuid-from-above" }'
```

**Get analyzed videos:**
```bash
curl http://localhost:3000/api/youtube/analysis
```

**Get channel insights:**
```bash
curl "http://localhost:3000/api/youtube/analysis?channelId=uuid&type=insights"
```

For complete API reference, see [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) → API Examples section.

---

## 📊 Database Tables Overview

### youtube_channels
Stores monitored channel configurations
- Supports RSS or API-based monitoring
- Tracks last check time and check intervals
- Links to conversion_id and task_id for analysis

### youtube_videos
Stores discovered videos with analysis status
- Status: `pending` → `analyzing` → `analyzed` | `failed`
- Stores analysis_result as JSONB
- Links to conversations and task_queue entries
- UNIQUE constraint on (channel_id, video_id)

### youtube_monitoring_runs
Execution history and metrics
- Tracks success/failure status
- Records videos_found and new_videos counts
- Stores error messages on failure
- Useful for monitoring system health

For complete schema, see [sql/025_youtube_monitoring.sql](sql/025_youtube_monitoring.sql).

---

## 🚀 Implementation Phases

### Phase 1: Database Setup (5 min)
```bash
psql life_dashboard < sql/025_youtube_monitoring.sql
```
✅ Creates all tables, indexes, and triggers

### Phase 2: Code Integration (10 min)
- Verify library files exist
- Verify API route files exist
- Check TypeScript compilation: `pnpm build`

### Phase 3: Configuration (10 min)
- Add environment variables (if using API)
- Add to cron handlers
- Configure schedule

### Phase 4: Add Channels (15 min)
- Get YouTube channel IDs
- Add via HTTP API or TypeScript
- Verify in database

### Phase 5: Test Monitoring (20 min)
- Trigger manual monitoring
- Verify videos discovered
- Check task queue
- Monitor researcher agent

### Phase 6: Verify Analysis (10 min)
- Check video analysis status
- Get analysis results
- Verify SSE events

Full checklist: [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md)

---

## 🔧 Configuration Reference

### RSS vs API

| Feature | RSS | API |
|---------|-----|-----|
| Rate Limit | Unlimited | 10k units/day |
| Auth Required | No | Yes (API key) |
| Setup Complexity | Low | Medium |
| Cost | Free | Free (within quota) |
| **Recommended For** | Most users | 10+ channels |

### Monitoring Frequency

```typescript
// Very frequent
checkIntervalMinutes: 5    // Every 5 minutes

// Moderate
checkIntervalMinutes: 30   // Every 30 minutes (default)

// Infrequent
checkIntervalMinutes: 120  // Every 2 hours
```

### Cron Schedule

```
*/5 * * * *   → Every 5 minutes
*/15 * * * *  → Every 15 minutes
0 * * * *    → Every hour
0 6,12,18 * * * → 6 AM, 12 PM, 6 PM
```

---

## 🎯 Common Workflows

### Add a New Channel

1. Get YouTube channel ID (from channel URL or About page)
2. Generate RSS URL: `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNELID`
3. POST to `/api/youtube/channels` with channel details
4. Verify in database: `SELECT * FROM youtube_channels`
5. Wait for next cron run or trigger manually

**Detailed guide:** [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Step 3

### Monitor Manually

```bash
# Get channel ID
CHANNEL_ID=$(psql life_dashboard -t -c "SELECT id FROM youtube_channels LIMIT 1")

# Trigger monitoring
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d "{ \"channelId\": \"$CHANNEL_ID\" }"
```

### Get Analysis Results

```bash
# All analyzed videos
curl http://localhost:3000/api/youtube/analysis

# For specific channel
CHANNEL_ID=uuid-here
curl "http://localhost:3000/api/youtube/analysis?channelId=$CHANNEL_ID"

# Channel insights (topics, sentiment, summaries)
curl "http://localhost:3000/api/youtube/analysis?channelId=$CHANNEL_ID&type=insights"
```

### Check Monitoring Health

```bash
# Channels due for monitoring
psql life_dashboard << EOF
SELECT name, last_checked_at, next_check
FROM youtube_channels
WHERE (last_checked_at + (check_interval_minutes || ' minutes')::INTERVAL) < NOW();
EOF

# Recent monitoring runs
psql life_dashboard << EOF
SELECT c.name, r.status, r.new_videos, r.run_at
FROM youtube_monitoring_runs r
JOIN youtube_channels c ON r.channel_id = c.id
ORDER BY r.run_at DESC LIMIT 20;
EOF

# Failed videos
psql life_dashboard -c "SELECT title, error_message FROM youtube_videos WHERE status = 'failed';"
```

---

## 🐛 Troubleshooting Guide

### Issue: No Videos Discovered

**Checklist:**
1. ✓ Channel exists and is enabled: `SELECT * FROM youtube_channels WHERE enabled = TRUE`
2. ✓ RSS URL is valid: Visit in browser or `curl https://www.youtube.com/feeds/...`
3. ✓ Monitoring was run: Check `youtube_monitoring_runs` table
4. ✓ Videos exist on channel: Manual check on YouTube

**Solution:** See [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Troubleshooting → No Videos Detected

### Issue: Analysis Not Starting

**Checklist:**
1. ✓ Researcher agent is connected: `curl http://localhost:3000/api/relay/status`
2. ✓ Task queue has entries: `SELECT * FROM task_queue WHERE type = 'youtube_video_analysis'`
3. ✓ Conversation created: `SELECT * FROM conversations` (check for video analysis titles)

**Solution:** See [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Troubleshooting → Analysis Not Starting

### Issue: API Rate Limiting

**Check quota:** https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas

**Solutions:**
- Switch to RSS monitoring (unlimited)
- Increase check intervals (reduce frequency)
- Use different API keys for different channels

**Details:** See [YOUTUBE_README.md](YOUTUBE_README.md) → Troubleshooting → API Rate Limiting

For all troubleshooting: [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Troubleshooting section

---

## 📈 Monitoring & Maintenance

### Daily
- Check for failed videos: `SELECT COUNT(*) FROM youtube_videos WHERE status = 'failed'`
- Review error messages: `SELECT title, error_message FROM youtube_videos WHERE status = 'failed'`

### Weekly
- Monitor system metrics: `SELECT COUNT(*) FROM youtube_monitoring_runs WHERE run_at > NOW() - INTERVAL '7 days'`
- Check task queue health: `SELECT COUNT(*) FROM task_queue WHERE type = 'youtube_video_analysis' AND status != 'completed'`

### Monthly
- Review channel performance: `SELECT COUNT(*) FROM youtube_videos WHERE channel_id = ? AND analyzed_at > NOW() - INTERVAL '30 days'`
- Check database size: `SELECT pg_size_pretty(pg_total_relation_size('youtube_videos'))`
- Archive old videos (optional): `UPDATE youtube_videos SET status = 'archived' WHERE analyzed_at < NOW() - INTERVAL '90 days'`

See [YOUTUBE_README.md](YOUTUBE_README.md) → Monitoring & Insights for detailed queries.

---

## 🔮 Future Enhancements

### Planned Features
1. **Transcript Integration** — Fetch and analyze video captions
2. **Comment Analysis** — Analyze viewer comments for sentiment
3. **Engagement Tracking** — Monitor views/likes over time
4. **Webhook Support** — Real-time YouTube notifications
5. **UI Dashboard** — Visual gallery with analysis results
6. **Batch Analysis** — Analyze multiple videos in one request
7. **Custom Templates** — Per-channel analysis templates

See [YOUTUBE_README.md](YOUTUBE_README.md) → Future Enhancements for details.

---

## 📞 Getting Help

### By Problem Type

**"I'm getting started"**
→ Read [YOUTUBE_README.md](YOUTUBE_README.md) then follow [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md)

**"I'm implementing"**
→ Use [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md) to verify each step

**"Something isn't working"**
→ Check [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) troubleshooting section, then [YOUTUBE_README.md](YOUTUBE_README.md) FAQ

**"I need technical details"**
→ See [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) and [YOUTUBE_IMPLEMENTATION_SUMMARY.md](YOUTUBE_IMPLEMENTATION_SUMMARY.md)

**"I want to customize something"**
→ See [YOUTUBE_README.md](YOUTUBE_README.md) → Customization section

---

## 📋 File Manifest

### Documentation Files
```
YOUTUBE_INDEX.md                          ← You are here
YOUTUBE_README.md                         ← Quick start & overview
YOUTUBE_SETUP.md                          ← Installation guide
YOUTUBE_CHECKLIST.md                      ← Implementation verification
YOUTUBE_IMPLEMENTATION_SUMMARY.md         ← Architecture overview
docs/youtube-monitoring-system.md         ← Technical reference
```

### Code Files (Created)
```
sql/025_youtube_monitoring.sql                    ← Database schema
src/lib/youtube-monitor.ts                        ← Main orchestration
src/lib/youtube-parser.ts                         ← RSS parsing
src/lib/youtube-api.ts                            ← YouTube API client
src/lib/youtube-video-analyzer.ts                 ← Researcher workflow
src/lib/cron-handlers/youtube-monitoring.ts       ← Cron handler
src/app/api/youtube/channels/route.ts             ← Channel endpoints
src/app/api/youtube/videos/route.ts               ← Video endpoints
src/app/api/youtube/monitor/route.ts              ← Monitor endpoint
src/app/api/youtube/analysis/route.ts             ← Analysis endpoint
src/lib/__tests__/youtube-monitor.test.ts         ← Unit tests
```

### Configuration Files (To Modify)
```
src/lib/cron-handlers.ts                  ← Add YouTube monitoring job
.env.local                                ← Add YOUTUBE_API_KEY (optional)
```

---

## ✅ Implementation Status

### ✓ Completed
- [x] Database schema with all tables and indexes
- [x] RSS feed parsing library
- [x] YouTube Data API v3 integration
- [x] Video monitoring orchestration
- [x] Researcher agent workflow
- [x] Conversation system integration
- [x] Task queue integration
- [x] API routes (4 endpoints)
- [x] Cron handler
- [x] SSE broadcasting
- [x] Unit tests
- [x] Complete documentation (6 files)
- [x] Implementation checklist
- [x] Setup guide

### Ready for
- [x] Production deployment
- [x] Scaling to multiple channels
- [x] Integration with researcher agents

---

## 🎓 Learning Resources

### To Understand the System
1. [YOUTUBE_README.md](YOUTUBE_README.md) — Overview and architecture
2. [YOUTUBE_IMPLEMENTATION_SUMMARY.md](YOUTUBE_IMPLEMENTATION_SUMMARY.md) — Component breakdown
3. [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) — Technical details

### To Set It Up
1. [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) — Step-by-step guide
2. [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md) — Verification steps

### To Use It
1. [YOUTUBE_README.md](YOUTUBE_README.md) → API Reference section
2. [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md) → API Examples section

### To Troubleshoot
1. [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) → Troubleshooting section
2. [YOUTUBE_README.md](YOUTUBE_README.md) → FAQ & Troubleshooting sections

---

## 🚀 Quick Commands Reference

### Setup
```bash
# 1. Create database tables
psql life_dashboard < sql/025_youtube_monitoring.sql

# 2. Add a channel
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{"name":"Channel","channelId":"UC...","channelUrl":"...","feedType":"rss","rssUrl":"...","checkIntervalMinutes":30}'

# 3. List channels
curl http://localhost:3000/api/youtube/channels
```

### Monitoring
```bash
# Trigger monitoring
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{"channelId":"uuid"}'

# List videos
curl "http://localhost:3000/api/youtube/videos"

# Check analysis
curl "http://localhost:3000/api/youtube/analysis"
```

### Debugging
```bash
# Check channels
psql life_dashboard -c "SELECT * FROM youtube_channels;"

# Check videos
psql life_dashboard -c "SELECT * FROM youtube_videos ORDER BY discovered_at DESC LIMIT 10;"

# Check monitoring runs
psql life_dashboard -c "SELECT * FROM youtube_monitoring_runs ORDER BY run_at DESC LIMIT 10;"

# Check task queue
psql life_dashboard -c "SELECT * FROM task_queue WHERE type = 'youtube_video_analysis';"
```

---

## 📞 Support

- **Setup issues?** → [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md)
- **API questions?** → [docs/youtube-monitoring-system.md](docs/youtube-monitoring-system.md)
- **Troubleshooting?** → [YOUTUBE_README.md](YOUTUBE_README.md) FAQ
- **Implementation help?** → [YOUTUBE_CHECKLIST.md](YOUTUBE_CHECKLIST.md)

---

**System Version:** 1.0
**Documentation Version:** 1.0
**Last Updated:** 2024-02-27
**Status:** ✅ Production Ready
