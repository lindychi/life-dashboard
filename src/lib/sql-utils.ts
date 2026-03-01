/**
 * SQL utility functions
 */

/**
 * Escape special characters for PostgreSQL ILIKE/LIKE patterns.
 * Escapes \, %, and _ so they are treated as literal characters.
 */
export function escapeIlike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
