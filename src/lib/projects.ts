/**
 * Projects Library
 * PostgreSQL-backed CRUD operations for user projects
 */

import { query, queryOne } from "./db";

export interface ProjectKPI {
  label: string;
  value: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  progress: number;
  url?: string | null;
  kpis: ProjectKPI[];
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  status?: string;
  progress?: number;
  url?: string;
  kpis?: ProjectKPI[];
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  progress?: number;
  url?: string;
  kpis?: ProjectKPI[];
}

/**
 * Get all projects
 */
export async function getProjects(): Promise<Project[]> {
  const result = await query<Project>(
    `SELECT id, name, description, status, progress, url, kpis,
            created_at, updated_at
     FROM projects
     ORDER BY created_at DESC`
  );
  return result;
}

/**
 * Get project by ID
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const result = await queryOne<Project>(
    `SELECT id, name, description, status, progress, url, kpis,
            created_at, updated_at
     FROM projects
     WHERE id = $1`,
    [id]
  );
  return result || null;
}

/**
 * Create new project
 */
export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const {
    name,
    description,
    status = "idea",
    progress = 0,
    url,
    kpis = [],
  } = input;

  const result = await queryOne<Project>(
    `INSERT INTO projects (name, description, status, progress, url, kpis)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, description, status, progress, url, kpis,
               created_at, updated_at`,
    [name, description, status, progress, url || null, JSON.stringify(kpis)]
  );

  if (!result) {
    throw new Error("Failed to create project");
  }

  return result;
}

/**
 * Update existing project
 */
export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project | null> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }
  if (input.progress !== undefined) {
    fields.push(`progress = $${paramIndex++}`);
    values.push(input.progress);
  }
  if (input.url !== undefined) {
    fields.push(`url = $${paramIndex++}`);
    values.push(input.url || null);
  }
  if (input.kpis !== undefined) {
    fields.push(`kpis = $${paramIndex++}`);
    values.push(JSON.stringify(input.kpis));
  }

  if (fields.length === 0) {
    // No fields to update, just return existing project
    return getProjectById(id);
  }

  values.push(id);

  const result = await queryOne<Project>(
    `UPDATE projects
     SET ${fields.join(", ")}
     WHERE id = $${paramIndex}
     RETURNING id, name, description, status, progress, url, kpis,
               created_at, updated_at`,
    values
  );

  return result || null;
}

/**
 * Delete project
 */
export async function deleteProject(id: string): Promise<boolean> {
  const result = await query<{ count: number }>(
    `DELETE FROM projects WHERE id = $1 RETURNING 1 as count`,
    [id]
  );
  return result.length > 0;
}
