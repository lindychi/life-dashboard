import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/life_dashboard",
  connectionTimeoutMillis: 5000,
  max: 20,                    // Max connections (default 10 → 20 for concurrent agent polling)
  min: 2,                     // Keep 2 warm connections ready
  idleTimeoutMillis: 30000,   // Return idle connections after 30s (default 10s)
  statement_timeout: 10000,   // 10s query timeout safety net
});

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export function isDbConnectionError(error: unknown): boolean {
  if (!error) return false;

  const connectionCodes = [
    "ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT",
    "EHOSTUNREACH", "EPIPE", "EAI_AGAIN",
    "57P01", "57P02", "57P03",  // PostgreSQL shutdown/startup codes
  ];

  // Check if error has a code property
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: string }).code;
    if (connectionCodes.includes(code)) return true;
  }

  // Check if error is an AggregateError with nested errors
  if (
    typeof error === "object" &&
    error !== null &&
    "errors" in error &&
    Array.isArray((error as { errors: unknown[] }).errors)
  ) {
    return (error as { errors: unknown[] }).errors.some((err) => {
      if (typeof err === "object" && err !== null && "code" in err) {
        const code = (err as { code: string }).code;
        return connectionCodes.includes(code);
      }
      return false;
    });
  }

  return false;
}

export async function withDbFallback<T>(
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isDbConnectionError(error)) {
      console.warn("Database connection failed, using fallback");
      return fallback;
    }
    throw error;
  }
}

export { pool };
