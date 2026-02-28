# YouTube Monitoring System - Implementation Checklist

## Pre-Implementation
- [ ] Read `YOUTUBE_README.md` for overview
- [ ] Review `docs/youtube-monitoring-system.md` for architecture details
- [ ] Backup PostgreSQL database
- [ ] Ensure researcher agent is working and connected

## Phase 1: Database Setup (5 minutes)

### 1.1 Create Tables
```bash
psql life_dashboard < sql/025_youtube_monitoring.sql
```
- [ ] Command executed without errors
- [ ] Verify tables created: `psql life_dashboard -c "\dt youtube_*"`
- [ ] See output with 3 tables (youtube_channels, youtube_videos, youtube_monitoring_runs)

### 1.2 Verify Schema
```bash
psql life_dashboard << EOF
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name LIKE 'youtube_%'
ORDER BY table_name, ordinal_position;
EOF
```
- [ ] All expected columns present
- [ ] Data types correct (UUID, TEXT, INT, TIMESTAMP, JSONB, etc.)
- [ ] Primary keys and foreign keys defined

### 1.3 Check Indexes
```bash
psql life_dashboard << EOF
SELECT indexname, tablename
FROM pg_indexes
WHERE tablename LIKE 'youtube_%';
EOF
```
- [ ] Indexes created on enabled, last_checked_at, channel_status, published_at
- [ ] At least 4 indexes present

## Phase 2: Code Integration (10 minutes)

### 2.1 Add Libraries
Verify files exist:
- [ ] `src/lib/youtube-monitor.ts` — Main orchestration
- [ ] `src/lib/youtube-parser.ts` — RSS parsing
- [ ] `src/lib/youtube-api.ts` — YouTube API integration
- [ ] `src/lib/youtube-video-analyzer.ts` — Researcher workflow
- [ ] `src/lib/cron-handlers/youtube-monitoring.ts` — Cron handler

### 2.2 Add API Routes
Verify files exist:
- [ ] `src/app/api/youtube/channels/route.ts`
- [ ] `src/app/api/youtube/videos/route.ts`
- [ ] `src/app/api/youtube/monitor/route.ts`
- [ ] `src/app/api/youtube/analysis/route.ts`

### 2.3 Add Tests
- [ ] `src/lib/__tests__/youtube-monitor.test.ts` exists
- [ ] Tests compile without errors: `pnpm test -- youtube-monitor.test.ts`

## Phase 3: Configuration (10 minutes)

### 3.1 Environment Variables
Edit `.env.local`:

For RSS-only (simple):
```env
# No additional variables needed
```

For API support:
```env
YOUTUBE_API_KEY=your_api_key_from_google_cloud
```

- [ ] `.env.local` updated (if using API)
- [ ] Variables exported to current shell: `source .env.local`
- [ ] Verify: `echo $YOUTUBE_API_KEY` shows value (if set)

### 3.2 Add to Cron Handlers
Edit `src/lib/cron-handlers.ts`:

```typescript
import { handleYouTubeMonitoring } from "@/lib/cron-handlers/youtube-monitoring";

export const CRON_JOBS = [
  // ... existing jobs ...
  {
    id: "youtube-monitoring",
    schedule: "*/5 * * * *", // Every 5 minutes
    handler: handleYouTubeMonitoring,
    description: "Monitor YouTube channels for new videos",
  },
];
```

- [ ] Import statement added
- [ ] CRON_JOBS array updated
- [ ] Schedule configured appropriately
- [ ] File saves without TypeScript errors

### 3.3 Build Check
```bash
pnpm build
```
- [ ] Build succeeds
- [ ] No TypeScript errors
- [ ] No import resolution errors

## Phase 4: Adding Channels (15 minutes)

### 4.1 Get YouTube Channel IDs

Find channels to monitor:
- [ ] Anthropic: `UCVHFbqXqoYvEWM1Ddxl0QDg`
- [ ] 3Blue1Brown: `UCYO_jab_esuFRV4b-je9pww`
- [ ] (Add your own channels)

### 4.2 Start Dev Server
```bash
pnpm dev
```
- [ ] Server starts on localhost:3000
- [ ] No errors in console

### 4.3 Add First Channel (RSS)

Via HTTP API:
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

- [ ] HTTP 201 response received
- [ ] Response contains channel ID and name
- [ ] Status is `enabled: true`

### 4.4 Verify in Database
```bash
psql life_dashboard -c "SELECT id, name, feed_type, enabled FROM youtube_channels;"
```
- [ ] Anthropic channel appears in list
- [ ] feed_type is "rss"
- [ ] enabled is true

### 4.5 Add More Channels (Optional)

Add 1-2 more test channels:
```bash
curl -X POST http://localhost:3000/api/youtube/channels \
  -H "Content-Type: application/json" \
  -d '{
    "name": "3Blue1Brown",
    "channelId": "UCYO_jab_esuFRV4b-je9pww",
    "channelUrl": "https://www.youtube.com/@3blue1brown",
    "feedType": "rss",
    "rssUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b-je9pww",
    "checkIntervalMinutes": 60
  }'
```

- [ ] At least 2 channels added
- [ ] Both appear in database query

## Phase 5: Testing Monitoring (20 minutes)

### 5.1 Get Channel UUID
```bash
psql life_dashboard -c "SELECT id FROM youtube_channels LIMIT 1;"
```
- [ ] Copy the UUID for next steps

### 5.2 Trigger Manual Monitoring
```bash
curl -X POST http://localhost:3000/api/youtube/monitor \
  -H "Content-Type: application/json" \
  -d '{ "channelId": "YOUR_CHANNEL_UUID" }'
```

- [ ] HTTP 200 response
- [ ] Response shows `"success": true`
- [ ] Shows number of videos found
- [ ] Shows number of new videos detected

### 5.3 Check Videos Were Discovered
```bash
curl "http://localhost:3000/api/youtube/videos?status=pending"
```

- [ ] HTTP 200 response
- [ ] Videos array not empty
- [ ] Each video has: id, video_id, title, watch_url, status

### 5.4 Check Task Queue
```bash
psql life_dashboard -c "SELECT COUNT(*) FROM task_queue WHERE type = 'youtube_video_analysis';"
```

- [ ] Count > 0 (tasks were created)
- [ ] Each pending video has a task entry

### 5.5 Check Conversations Created
```bash
psql life_dashboard -c "SELECT COUNT(*) FROM conversations WHERE title LIKE 'YouTube Video Analysis%';"
```

- [ ] Count > 0 (conversations were created)
- [ ] Matches number of new videos

### 5.6 Verify Video Status
```bash
psql life_dashboard << EOF
SELECT title, status, discovered_at
FROM youtube_videos
ORDER BY discovered_at DESC
LIMIT 5;
EOF
```

- [ ] Videos have status "analyzing" or "pending"
- [ ] discovered_at is recent (within last minute)

## Phase 6: Researcher Agent Integration (15 minutes)

### 6.1 Verify Researcher Agent Running
```bash
curl http://localhost:3000/api/relay/status
```

- [ ] HTTP 200 response
- [ ] Shows researcher agent in connected status
- [ ] Agent health looks good

### 6.2 Check Gateway Connection
```bash
psql life_dashboard -c "SELECT * FROM gateway_connections ORDER BY connected_at DESC LIMIT 1\gx"
```

- [ ] At least one gateway connected
- [ ] Connected recently

### 6.3 Monitor Agent Activity
```bash
curl "http://localhost:3000/api/messages/researcher?limit=10"
```

- [ ] Messages appear (if agent is active)
- [ ] Check for any error messages

### 6.4 Watch Conversation Messages

In another terminal:
```bash
# Keep polling conversation messages
while true; do
  psql life_dashboard << EOF
SELECT from, content, created_at FROM conversation_messages
WHERE conversation_id IN (
  SELECT conversation_id FROM youtube_videos
  WHERE status = 'analyzing' LIMIT 1
)
ORDER BY created_at DESC LIMIT 5;
EOF
  sleep 10
done
```

- [ ] System message sent (analysis request)
- [ ] Researcher responds with analysis
- [ ] Response contains JSON with insights

### 6.5 Check Video Status Updates
```bash
psql life_dashboard << EOF
SELECT id, title, status, analyzed_at
FROM youtube_videos
WHERE analyzed_at IS NOT NULL
ORDER BY analyzed_at DESC
LIMIT 1\gx
EOF
```

- [ ] At least one video has status "analyzed"
- [ ] analyzed_at timestamp is recent
- [ ] analysis_result is populated

## Phase 7: Verify Analysis Results (10 minutes)

### 7.1 Get Single Video Analysis
```bash
psql life_dashboard << EOF
SELECT analysis_result
FROM youtube_videos
WHERE status = 'analyzed'
LIMIT 1;
EOF
```

- [ ] JSON is well-formed
- [ ] Contains: summary, keyInsights, topics, sentiment
- [ ] metadata includes analyzedAt, model, tokensUsed

### 7.2 Get Analysis via API
```bash
curl "http://localhost:3000/api/youtube/analysis?limit=5"
```

- [ ] HTTP 200 response
- [ ] Videos array contains analyzed videos
- [ ] Each video has: id, title, watchUrl, analysis, analyzedAt

### 7.3 Get Channel Insights
```bash
psql life_dashboard -c "SELECT id FROM youtube_channels LIMIT 1;" > channel_id.txt

curl "http://localhost:3000/api/youtube/analysis?channelId=$(cat channel_id.txt)&type=insights"
```

- [ ] HTTP 200 response
- [ ] Returns totalAnalyzed count
- [ ] commonTopics list present
- [ ] sentimentDistribution showing breakdown

### 7.4 Verify SSE Events

Open browser console:
```javascript
const es = new EventSource('/api/sse');
es.addEventListener('youtube:video:analyzed', (e) => {
  console.log('Video analyzed:', JSON.parse(e.data));
});
```

- [ ] Event received when video analysis completes
- [ ] Data contains videoId and analysis result

## Phase 8: Verify Cron Scheduling (Optional)

### 8.1 Check Cron is Running

If you've integrated cron handlers:
```bash
# Check for cron logs
grep -i "youtube" .next/server.log | tail -20
```

- [ ] Cron job appears in logs
- [ ] No errors reported

### 8.2 Wait for Next Scheduled Run

If cron is running every 5 minutes:
- [ ] Wait 5 minutes
- [ ] Check if new videos are auto-discovered
```bash
curl "http://localhost:3000/api/youtube/videos?status=pending"
```

- [ ] New videos appear (if channel has published since setup)

### 8.3 Check Monitoring History
```bash
psql life_dashboard << EOF
SELECT c.name, r.status, r.videos_found, r.new_videos, r.run_at
FROM youtube_monitoring_runs r
JOIN youtube_channels c ON r.channel_id = c.id
ORDER BY r.run_at DESC
LIMIT 10;
EOF
```

- [ ] Multiple monitoring runs appear (if cron is active)
- [ ] Status is "success" for all (or expected failures)
- [ ] Times show cron schedule was executed

## Phase 9: Documentation & Setup (5 minutes)

### 9.1 Save Configuration
Create `youtube-channels-backup.sql`:
```bash
psql life_dashboard -c "\copy (SELECT * FROM youtube_channels) TO 'youtube-channels-backup.sql' WITH (FORMAT CSV, HEADER)"
```
- [ ] Backup file created

### 9.2 Document Setup
Create a private note with:
- [ ] Channels added and their IDs
- [ ] API key location (if using API)
- [ ] Cron schedule configured
- [ ] Expected monitoring frequency per channel

### 9.3 Review Documentation
- [ ] Read `YOUTUBE_README.md` overview
- [ ] Bookmark `YOUTUBE_SETUP.md` for reference
- [ ] Bookmark `docs/youtube-monitoring-system.md` for technical details

## Phase 10: Production Readiness (10 minutes)

### 10.1 Monitoring Health
```bash
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

- [ ] All channels show next check time
- [ ] At least one has recent last_checked_at

### 10.2 Error Check
```bash
psql life_dashboard -c "SELECT COUNT(*) FROM youtube_videos WHERE status = 'failed';"
```

- [ ] Count is 0 (or acceptable number)
- [ ] If failed videos exist, check error_message field

### 10.3 Task Queue Status
```bash
psql life_dashboard << EOF
SELECT status, COUNT(*) as count
FROM task_queue
WHERE type = 'youtube_video_analysis'
GROUP BY status;
EOF
```

- [ ] Completed > 0 (tasks have finished)
- [ ] Failed = 0 (or acceptable number)
- [ ] Processing ≤ (number of videos being analyzed)

### 10.4 Database Backup
```bash
pg_dump life_dashboard > life_dashboard_youtube_backup.sql
```

- [ ] Backup file created successfully
- [ ] File size > 1MB (contains data)

### 10.5 Load Testing (Optional)

Add 10 channels and trigger monitoring:
```bash
# Monitor the system under load
watch -n 1 'psql life_dashboard -c "SELECT status, COUNT(*) FROM youtube_videos GROUP BY status;"'
```

- [ ] System handles multiple monitoring requests
- [ ] No database locks or timeouts
- [ ] Proper task queue concurrency

## Final Verification Checklist

### ✅ Core Functionality
- [ ] Channels can be added via API
- [ ] Monitoring detects new videos
- [ ] Videos are stored in database
- [ ] Analysis tasks are created
- [ ] Researcher agent processes analysis
- [ ] Results are stored and retrievable

### ✅ Integration
- [ ] Task queue integration working
- [ ] Conversation system integration working
- [ ] SSE events broadcasting
- [ ] History entries recorded
- [ ] API routes accessible

### ✅ Monitoring & Maintenance
- [ ] Monitoring history tracked
- [ ] Error handling working
- [ ] Cron schedule configured
- [ ] Database backups created
- [ ] Health checks passing

### ✅ Documentation
- [ ] README.md read and understood
- [ ] Setup guide reviewed
- [ ] Architecture docs available
- [ ] Configuration documented
- [ ] Backup of channels created

## Post-Implementation

### Things to Monitor
1. Check monitoring runs daily: `SELECT COUNT(*) FROM youtube_monitoring_runs WHERE run_at > NOW() - INTERVAL '24 hours';`
2. Monitor failed videos: `SELECT COUNT(*) FROM youtube_videos WHERE status = 'failed';`
3. Check task queue: `SELECT COUNT(*) FROM task_queue WHERE type = 'youtube_video_analysis' AND status != 'completed';`
4. Review database size: `SELECT pg_size_pretty(pg_total_relation_size('youtube_videos'));`

### Maintenance Schedule
- **Daily**: Check for failed videos and error messages
- **Weekly**: Review monitoring statistics and trends
- **Monthly**: Archive old analyzed videos, verify API quotas
- **Quarterly**: Review and update channel list, assess performance

### When to Optimize
- If monitoring 10+ channels → consider switching to API
- If 20+ videos/day → implement batch analysis
- If database grows large → archive videos older than 90 days

---

## ✅ Implementation Complete!

Once all checkboxes are marked:
1. YouTube monitoring system is fully operational
2. Researcher agent is analyzing new videos automatically
3. Historical data is being tracked
4. Real-time SSE updates are active
5. System is production-ready

**Next Steps:**
- Add more channels as desired
- Monitor system health daily
- Consider UI dashboard for video/analysis visualization
- Plan for enhancements (transcripts, comments, etc.)

**Support Resources:**
- Technical questions → `docs/youtube-monitoring-system.md`
- Setup help → `YOUTUBE_SETUP.md`
- Troubleshooting → `YOUTUBE_README.md` FAQ section

---

**Checklist Version:** 1.0
**Last Updated:** 2024-02-27
**Estimated Time:** 90 minutes total
