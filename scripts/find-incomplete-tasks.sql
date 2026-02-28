-- Find incomplete tasks in agent_history
-- Identifies tasks with 'task_started' or 'in_progress' status that lack 'task_completed'
-- Prioritizes items from the last 7 days

WITH task_groups AS (
  -- Group related task events by request_group_id
  SELECT
    ah.id,
    ah.agent_id,
    ah.type,
    ah.content,
    ah.metadata,
    ah.created_at,
    ah.request_group_id,
    ah.request_title,
    -- Count task lifecycle events for this request group
    COUNT(*) FILTER (WHERE ah.type = 'task_started') OVER (PARTITION BY ah.request_group_id) as started_count,
    COUNT(*) FILTER (WHERE ah.type = 'task_completed') OVER (PARTITION BY ah.request_group_id) as completed_count,
    COUNT(*) FILTER (WHERE ah.type = 'task_failed') OVER (PARTITION BY ah.request_group_id) as failed_count,
    -- Determine recency category
    CASE
      WHEN ah.created_at >= NOW() - INTERVAL '7 days' THEN 1  -- Recent (priority)
      WHEN ah.created_at >= NOW() - INTERVAL '30 days' THEN 2 -- Last month
      ELSE 3                                                   -- Older
    END as recency_priority
  FROM agent_history ah
  WHERE ah.type IN ('task_started', 'task_completed', 'task_failed')
)
SELECT
  tg.request_group_id,
  tg.request_title,
  tg.agent_id,
  tg.type,
  tg.created_at,
  tg.id as entry_id,
  tg.started_count,
  tg.completed_count,
  tg.failed_count,
  tg.recency_priority,
  -- Determine if this task group is incomplete
  (tg.started_count > 0 AND tg.completed_count = 0 AND tg.failed_count = 0) as is_incomplete,
  -- Time since start
  NOW() - MIN(tg.created_at) OVER (PARTITION BY tg.request_group_id) as duration_since_start
FROM task_groups tg
WHERE
  -- Only show groups with unmatched task_started events
  (tg.started_count > 0 AND tg.completed_count = 0 AND tg.failed_count = 0)
  -- Prioritize recent items (last 7 days), but include older incomplete tasks too
ORDER BY
  tg.recency_priority ASC,           -- Recent first
  tg.created_at DESC,                 -- Most recent within priority
  tg.agent_id ASC
;

-- Summary statistics
SELECT
  'INCOMPLETE TASK SUMMARY' as report_type,
  COUNT(DISTINCT request_group_id) as total_incomplete_groups,
  COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN request_group_id END) as recent_7days,
  COUNT(DISTINCT agent_id) as affected_agents,
  STRING_AGG(DISTINCT agent_id, ', ' ORDER BY agent_id) as agent_list,
  MIN(created_at) as oldest_incomplete_task,
  MAX(created_at) as newest_incomplete_task
FROM (
  SELECT
    ah.request_group_id,
    ah.created_at,
    ah.agent_id,
    COUNT(*) FILTER (WHERE ah.type = 'task_started') OVER (PARTITION BY ah.request_group_id) as started_count,
    COUNT(*) FILTER (WHERE ah.type = 'task_completed') OVER (PARTITION BY ah.request_group_id) as completed_count,
    COUNT(*) FILTER (WHERE ah.type = 'task_failed') OVER (PARTITION BY ah.request_group_id) as failed_count
  FROM agent_history ah
  WHERE ah.type IN ('task_started', 'task_completed', 'task_failed')
) summary
WHERE started_count > 0 AND completed_count = 0 AND failed_count = 0
;
