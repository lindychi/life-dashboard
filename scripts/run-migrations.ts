#!/usr/bin/env node

/**
 * Database Migration Runner
 *
 * Automatically runs all SQL migrations in the sql/ directory.
 * Tracks applied migrations in _migrations table to prevent re-running.
 *
 * Usage:
 *   npx tsx scripts/run-migrations.ts [--dry-run] [--reset]
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";

const dryRun = process.argv.includes("--dry-run");
const reset = process.argv.includes("--reset");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("❌ DATABASE_URL environment variable is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function getMigrations(): Promise<string[]> {
  const sqlDir = path.join(process.cwd(), "sql");

  if (!fs.existsSync(sqlDir)) {
    console.warn("⚠️  sql/ directory not found");
    return [];
  }

  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files;
}

async function createMigrationsTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW(),
        executed_by TEXT DEFAULT 'system',
        checksum TEXT
      );
    `);
    console.log("✅ Migrations table ready");
  } catch (error) {
    console.error("❌ Failed to create migrations table:", error);
    throw error;
  }
}

async function getAppliedMigrations(): Promise<Set<string>> {
  try {
    const result = await pool.query(
      "SELECT filename FROM _migrations ORDER BY applied_at"
    );
    return new Set(result.rows.map((r) => r.filename));
  } catch {
    return new Set();
  }
}

async function calculateChecksum(filePath: string): Promise<string> {
  const crypto = await import("crypto");
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .substring(0, 8);
}

async function runMigration(filename: string, filePath: string): Promise<void> {
  const content = fs.readFileSync(filePath, "utf-8");
  const checksum = await calculateChecksum(filePath);

  if (dryRun) {
    console.log(`📝 [DRY RUN] Would apply: ${filename}`);
    return;
  }

  try {
    console.log(`⏳ Applying: ${filename}...`);
    await pool.query(content);

    await pool.query(
      "INSERT INTO _migrations (filename, checksum, executed_by) VALUES ($1, $2, $3)",
      [filename, checksum, "migration-runner"]
    );

    console.log(`✅ Applied: ${filename}`);
  } catch (error) {
    console.error(`❌ Failed to apply ${filename}:`, error);
    throw error;
  }
}

async function resetMigrations(): Promise<void> {
  if (dryRun) {
    console.log("📝 [DRY RUN] Would reset all migrations");
    return;
  }

  try {
    console.log("⚠️  Resetting migrations table...");
    await pool.query("DROP TABLE IF EXISTS _migrations CASCADE");
    await createMigrationsTable();
    console.log("✅ Migrations reset");
  } catch (error) {
    console.error("❌ Failed to reset migrations:", error);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    console.log("🚀 Database Migration Runner");
    console.log(`📊 Database: ${databaseUrl.replace(/:[^@]*@/, ":***@")}`);
    console.log(`🔧 Mode: ${dryRun ? "DRY RUN" : "EXECUTE"}`);
    console.log();

    // Create migrations table
    await createMigrationsTable();

    // Reset if requested
    if (reset) {
      await resetMigrations();
    }

    // Get list of SQL files
    const migrations = await getMigrations();
    if (migrations.length === 0) {
      console.log("ℹ️  No migrations found");
      process.exit(0);
    }

    console.log(`📁 Found ${migrations.length} migration(s)`);
    console.log();

    // Get applied migrations
    const applied = await getAppliedMigrations();

    // Run pending migrations
    let pendingCount = 0;
    for (const filename of migrations) {
      if (applied.has(filename)) {
        console.log(`⏭️  Already applied: ${filename}`);
      } else {
        const filePath = path.join(process.cwd(), "sql", filename);
        await runMigration(filename, filePath);
        pendingCount++;
      }
    }

    console.log();
    console.log(`✨ Migration complete: ${pendingCount} new, ${applied.size} existing`);
  } catch (error) {
    console.error("💥 Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
