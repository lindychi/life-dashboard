-- OKR (Objectives and Key Results) System
-- Supports quarterly/annual objectives with measurable key results
-- Can be linked to projects for progress tracking

-- Objectives table
CREATE TABLE IF NOT EXISTS objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,

  -- Time period
  period_type TEXT NOT NULL CHECK (period_type IN ('quarterly', 'annual', 'custom')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  -- Status and progress
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'archived')),
  overall_progress INTEGER NOT NULL DEFAULT 0 CHECK (overall_progress >= 0 AND overall_progress <= 100),

  -- Metadata
  owner TEXT,
  tags JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Key Results table
CREATE TABLE IF NOT EXISTS key_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,

  -- Measurement
  metric_type TEXT NOT NULL CHECK (metric_type IN ('percentage', 'number', 'boolean', 'currency')),
  target_value NUMERIC NOT NULL,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit TEXT, -- e.g., "users", "revenue", "%", etc.

  -- Progress
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'at_risk', 'off_track')),

  -- Weight for calculating objective progress (should sum to 100 within an objective)
  weight INTEGER NOT NULL DEFAULT 25 CHECK (weight >= 0 AND weight <= 100),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Project-Objective linkage
CREATE TABLE IF NOT EXISTS project_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objective_id UUID NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,

  -- Optional: which key results are most relevant to this project
  relevant_key_result_ids JSONB DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate linkage
  UNIQUE(project_id, objective_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_objectives_status ON objectives(status);
CREATE INDEX IF NOT EXISTS idx_objectives_period ON objectives(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_objectives_created ON objectives(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_key_results_objective ON key_results(objective_id);
CREATE INDEX IF NOT EXISTS idx_key_results_status ON key_results(status);

CREATE INDEX IF NOT EXISTS idx_project_objectives_project ON project_objectives(project_id);
CREATE INDEX IF NOT EXISTS idx_project_objectives_objective ON project_objectives(objective_id);

-- Trigger to auto-update updated_at for objectives
CREATE OR REPLACE FUNCTION update_objectives_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER objectives_updated_at
  BEFORE UPDATE ON objectives
  FOR EACH ROW
  EXECUTE FUNCTION update_objectives_updated_at();

-- Trigger to auto-update updated_at for key_results
CREATE OR REPLACE FUNCTION update_key_results_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER key_results_updated_at
  BEFORE UPDATE ON key_results
  FOR EACH ROW
  EXECUTE FUNCTION update_key_results_updated_at();

-- Function to calculate key result progress based on current vs target value
CREATE OR REPLACE FUNCTION calculate_key_result_progress(
  p_metric_type TEXT,
  p_current_value NUMERIC,
  p_target_value NUMERIC
)
RETURNS INTEGER AS $$
BEGIN
  IF p_metric_type = 'boolean' THEN
    -- Boolean: 0 or 100
    RETURN CASE WHEN p_current_value >= 1 THEN 100 ELSE 0 END;
  ELSE
    -- Percentage, number, currency: (current / target) * 100, capped at 100
    IF p_target_value <= 0 THEN
      RETURN 0;
    END IF;
    RETURN LEAST(100, GREATEST(0, ROUND((p_current_value / p_target_value) * 100)));
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to auto-calculate objective overall_progress from key results
CREATE OR REPLACE FUNCTION recalculate_objective_progress(p_objective_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_total_weight INTEGER;
  v_weighted_progress NUMERIC;
BEGIN
  -- Get sum of (progress * weight) and total weight
  SELECT
    COALESCE(SUM(progress * weight), 0),
    COALESCE(SUM(weight), 0)
  INTO v_weighted_progress, v_total_weight
  FROM key_results
  WHERE objective_id = p_objective_id;

  -- If no key results or total weight is 0, return 0
  IF v_total_weight = 0 THEN
    RETURN 0;
  END IF;

  -- Return weighted average
  RETURN ROUND(v_weighted_progress / v_total_weight);
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update key result progress when current_value changes
CREATE OR REPLACE FUNCTION auto_update_key_result_progress()
RETURNS TRIGGER AS $$
BEGIN
  NEW.progress := calculate_key_result_progress(
    NEW.metric_type,
    NEW.current_value,
    NEW.target_value
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER key_result_auto_progress
  BEFORE INSERT OR UPDATE OF current_value, target_value, metric_type
  ON key_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_key_result_progress();

-- Trigger to auto-update objective progress when key results change
CREATE OR REPLACE FUNCTION auto_update_objective_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_objective_id UUID;
BEGIN
  -- Get objective_id from NEW or OLD
  v_objective_id := COALESCE(NEW.objective_id, OLD.objective_id);

  -- Recalculate and update objective progress
  UPDATE objectives
  SET overall_progress = recalculate_objective_progress(v_objective_id)
  WHERE id = v_objective_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER key_result_updates_objective
  AFTER INSERT OR UPDATE OR DELETE
  ON key_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_objective_progress();
