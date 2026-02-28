/**
 * OKR (Objectives and Key Results) Library
 * PostgreSQL-backed CRUD operations for objectives and key results
 */

import { query, queryOne } from "./db";

// ============================================================================
// Types
// ============================================================================

export type PeriodType = "quarterly" | "annual" | "custom";
export type ObjectiveStatus = "active" | "completed" | "cancelled" | "archived";
export type KeyResultStatus = "active" | "completed" | "at_risk" | "off_track";
export type MetricType = "percentage" | "number" | "boolean" | "currency";

export interface Objective {
  id: string;
  title: string;
  description: string | null;
  period_type: PeriodType;
  start_date: string;
  end_date: string;
  status: ObjectiveStatus;
  overall_progress: number;
  owner: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  description: string | null;
  metric_type: MetricType;
  target_value: number;
  current_value: number;
  unit: string | null;
  progress: number;
  status: KeyResultStatus;
  weight: number;
  created_at: string;
  updated_at: string;
}

export interface ObjectiveWithKeyResults extends Objective {
  key_results: KeyResult[];
}

export interface ProjectObjective {
  id: string;
  project_id: string;
  objective_id: string;
  relevant_key_result_ids: string[];
  created_at: string;
}

export interface CreateObjectiveInput {
  title: string;
  description?: string;
  period_type: PeriodType;
  start_date: string;
  end_date: string;
  status?: ObjectiveStatus;
  owner?: string;
  tags?: string[];
}

export interface UpdateObjectiveInput {
  title?: string;
  description?: string;
  period_type?: PeriodType;
  start_date?: string;
  end_date?: string;
  status?: ObjectiveStatus;
  owner?: string;
  tags?: string[];
}

export interface CreateKeyResultInput {
  objective_id: string;
  title: string;
  description?: string;
  metric_type: MetricType;
  target_value: number;
  current_value?: number;
  unit?: string;
  status?: KeyResultStatus;
  weight?: number;
}

export interface UpdateKeyResultInput {
  title?: string;
  description?: string;
  metric_type?: MetricType;
  target_value?: number;
  current_value?: number;
  unit?: string;
  status?: KeyResultStatus;
  weight?: number;
}

// ============================================================================
// Objectives CRUD
// ============================================================================

/**
 * Get all objectives
 */
export async function getObjectives(
  status?: ObjectiveStatus
): Promise<Objective[]> {
  const sql = status
    ? `SELECT * FROM objectives WHERE status = $1 ORDER BY start_date DESC, created_at DESC`
    : `SELECT * FROM objectives ORDER BY start_date DESC, created_at DESC`;

  const params = status ? [status] : [];
  const result = await query<Objective>(sql, params);
  return result;
}

/**
 * Get objective by ID
 */
export async function getObjectiveById(
  id: string
): Promise<Objective | null> {
  const result = await queryOne<Objective>(
    `SELECT * FROM objectives WHERE id = $1`,
    [id]
  );
  return result || null;
}

/**
 * Get objective with its key results
 */
export async function getObjectiveWithKeyResults(
  id: string
): Promise<ObjectiveWithKeyResults | null> {
  const objective = await getObjectiveById(id);
  if (!objective) return null;

  const keyResults = await getKeyResultsByObjective(id);

  return {
    ...objective,
    key_results: keyResults,
  };
}

/**
 * Create new objective
 */
export async function createObjective(
  input: CreateObjectiveInput
): Promise<Objective> {
  const {
    title,
    description,
    period_type,
    start_date,
    end_date,
    status = "active",
    owner,
    tags = [],
  } = input;

  const result = await queryOne<Objective>(
    `INSERT INTO objectives (title, description, period_type, start_date, end_date, status, owner, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      title,
      description || null,
      period_type,
      start_date,
      end_date,
      status,
      owner || null,
      JSON.stringify(tags),
    ]
  );

  if (!result) {
    throw new Error("Failed to create objective");
  }

  return result;
}

/**
 * Update existing objective
 */
export async function updateObjective(
  id: string,
  input: UpdateObjectiveInput
): Promise<Objective | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(input.description || null);
  }
  if (input.period_type !== undefined) {
    fields.push(`period_type = $${paramIndex++}`);
    values.push(input.period_type);
  }
  if (input.start_date !== undefined) {
    fields.push(`start_date = $${paramIndex++}`);
    values.push(input.start_date);
  }
  if (input.end_date !== undefined) {
    fields.push(`end_date = $${paramIndex++}`);
    values.push(input.end_date);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }
  if (input.owner !== undefined) {
    fields.push(`owner = $${paramIndex++}`);
    values.push(input.owner || null);
  }
  if (input.tags !== undefined) {
    fields.push(`tags = $${paramIndex++}`);
    values.push(JSON.stringify(input.tags));
  }

  if (fields.length === 0) {
    return getObjectiveById(id);
  }

  values.push(id);

  const result = await queryOne<Objective>(
    `UPDATE objectives
     SET ${fields.join(", ")}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result || null;
}

/**
 * Delete objective (cascades to key results)
 */
export async function deleteObjective(id: string): Promise<boolean> {
  const result = await query<{ count: number }>(`DELETE FROM objectives WHERE id = $1 RETURNING 1 as count`, [id]);
  return result.length > 0;
}

// ============================================================================
// Key Results CRUD
// ============================================================================

/**
 * Get all key results for an objective
 */
export async function getKeyResultsByObjective(
  objectiveId: string
): Promise<KeyResult[]> {
  const result = await query<KeyResult>(
    `SELECT * FROM key_results WHERE objective_id = $1 ORDER BY created_at ASC`,
    [objectiveId]
  );
  return result;
}

/**
 * Get key result by ID
 */
export async function getKeyResultById(id: string): Promise<KeyResult | null> {
  const result = await queryOne<KeyResult>(
    `SELECT * FROM key_results WHERE id = $1`,
    [id]
  );
  return result || null;
}

/**
 * Create new key result
 * Note: Progress is auto-calculated by trigger based on current_value/target_value
 * Objective progress is auto-updated by trigger
 */
export async function createKeyResult(
  input: CreateKeyResultInput
): Promise<KeyResult> {
  const {
    objective_id,
    title,
    description,
    metric_type,
    target_value,
    current_value = 0,
    unit,
    status = "active",
    weight = 25,
  } = input;

  const result = await queryOne<KeyResult>(
    `INSERT INTO key_results (objective_id, title, description, metric_type, target_value, current_value, unit, status, weight)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      objective_id,
      title,
      description || null,
      metric_type,
      target_value,
      current_value,
      unit || null,
      status,
      weight,
    ]
  );

  if (!result) {
    throw new Error("Failed to create key result");
  }

  return result;
}

/**
 * Update existing key result
 * Note: Progress auto-recalculates on current_value/target_value change
 * Objective progress auto-updates via trigger
 */
export async function updateKeyResult(
  id: string,
  input: UpdateKeyResultInput
): Promise<KeyResult | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    fields.push(`title = $${paramIndex++}`);
    values.push(input.title);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(input.description || null);
  }
  if (input.metric_type !== undefined) {
    fields.push(`metric_type = $${paramIndex++}`);
    values.push(input.metric_type);
  }
  if (input.target_value !== undefined) {
    fields.push(`target_value = $${paramIndex++}`);
    values.push(input.target_value);
  }
  if (input.current_value !== undefined) {
    fields.push(`current_value = $${paramIndex++}`);
    values.push(input.current_value);
  }
  if (input.unit !== undefined) {
    fields.push(`unit = $${paramIndex++}`);
    values.push(input.unit || null);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }
  if (input.weight !== undefined) {
    fields.push(`weight = $${paramIndex++}`);
    values.push(input.weight);
  }

  if (fields.length === 0) {
    return getKeyResultById(id);
  }

  values.push(id);

  const result = await queryOne<KeyResult>(
    `UPDATE key_results
     SET ${fields.join(", ")}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  return result || null;
}

/**
 * Delete key result
 * Note: Objective progress auto-updates via trigger
 */
export async function deleteKeyResult(id: string): Promise<boolean> {
  const result = await query<{ count: number }>(`DELETE FROM key_results WHERE id = $1 RETURNING 1 as count`, [id]);
  return result.length > 0;
}

// ============================================================================
// Project-Objective Linkage
// ============================================================================

/**
 * Link project to objective
 */
export async function linkProjectToObjective(
  projectId: string,
  objectiveId: string,
  relevantKeyResultIds: string[] = []
): Promise<ProjectObjective> {
  const result = await queryOne<ProjectObjective>(
    `INSERT INTO project_objectives (project_id, objective_id, relevant_key_result_ids)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, objective_id)
     DO UPDATE SET relevant_key_result_ids = $3
     RETURNING *`,
    [projectId, objectiveId, JSON.stringify(relevantKeyResultIds)]
  );

  if (!result) {
    throw new Error("Failed to link project to objective");
  }

  return result;
}

/**
 * Unlink project from objective
 */
export async function unlinkProjectFromObjective(
  projectId: string,
  objectiveId: string
): Promise<boolean> {
  const result = await query(
    `DELETE FROM project_objectives WHERE project_id = $1 AND objective_id = $2`,
    [projectId, objectiveId]
  );
  return result.length > 0;
}

/**
 * Get all objectives linked to a project
 */
export async function getObjectivesByProject(
  projectId: string
): Promise<ObjectiveWithKeyResults[]> {
  const result = await query<Objective>(
    `SELECT o.*
     FROM objectives o
     INNER JOIN project_objectives po ON o.id = po.objective_id
     WHERE po.project_id = $1
     ORDER BY o.start_date DESC`,
    [projectId]
  );

  // Fetch key results for each objective
  const objectivesWithKeyResults = await Promise.all(
    result.map(async (obj) => {
      const keyResults = await getKeyResultsByObjective(obj.id);
      return { ...obj, key_results: keyResults };
    })
  );

  return objectivesWithKeyResults;
}

/**
 * Get all projects linked to an objective
 */
export async function getProjectsByObjective(
  objectiveId: string
): Promise<string[]> {
  const result = await query<{ project_id: string }>(
    `SELECT project_id FROM project_objectives WHERE objective_id = $1`,
    [objectiveId]
  );
  return result.map((row) => row.project_id);
}
