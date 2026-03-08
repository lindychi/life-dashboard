-- 029: Seed suggestion_scan_configs for all data domains
-- Ensures the suggestion scheduler has configs for every scan type

INSERT INTO suggestion_scan_configs (agent_id, scan_type, interval_seconds, enabled, config_params)
VALUES
  -- Original 5 scan types
  ('suggestion-scanner', 'okr_progress',          3600,  TRUE, '{}'),   -- every 1 hour
  ('suggestion-scanner', 'project_stale',          7200,  TRUE, '{}'),   -- every 2 hours
  ('suggestion-scanner', 'task_failures',          1800,  TRUE, '{}'),   -- every 30 min
  ('suggestion-scanner', 'feedback_patterns',      3600,  TRUE, '{}'),   -- every 1 hour
  ('suggestion-scanner', 'dead_letter_queue',       900,  TRUE, '{}'),   -- every 15 min

  -- New scan types
  ('suggestion-scanner', 'conversation_health',    7200,  TRUE, '{}'),   -- every 2 hours
  ('suggestion-scanner', 'gateway_health',          300,  TRUE, '{}'),   -- every 5 min (critical)
  ('suggestion-scanner', 'token_usage_spikes',     3600,  TRUE, '{}'),   -- every 1 hour
  ('suggestion-scanner', 'queue_backlog',           600,  TRUE, '{}'),   -- every 10 min
  ('suggestion-scanner', 'relay_command_failures',  600,  TRUE, '{}'),   -- every 10 min
  ('suggestion-scanner', 'permission_backlog',     1800,  TRUE, '{}'),   -- every 30 min
  ('suggestion-scanner', 'metrics_regression',     3600,  TRUE, '{}')    -- every 1 hour
ON CONFLICT DO NOTHING;
