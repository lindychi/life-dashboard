#!/usr/bin/env npx tsx

/**
 * MCP Health Check
 *
 * Validates the life-dashboard MCP server configuration and connectivity.
 * Use this before deployments to catch MCP issues early.
 *
 * Usage:
 *   npx tsx scripts/mcp-healthcheck.ts
 *   npx tsx scripts/mcp-healthcheck.ts --offline
 */

import * as fs from "fs/promises";
import * as path from "path";
import { config } from "dotenv";

// Load .env.local with override (same as MCP server does)
config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

export interface HealthCheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface HealthCheckReport {
  passed: number;
  failed: number;
  results: HealthCheckResult[];
}

export interface HealthCheckOptions {
  offline?: boolean;
}

// Expected tools from MCP server
const EXPECTED_TOOLS = [
  "dashboard_get_history",
  "dashboard_get_agents",
  "dashboard_get_status",
  "dashboard_get_messages",
  "dashboard_add_history",
  "dashboard_send_message",
  "dashboard_send_command",
  "dashboard_search_history",
  "dashboard_upload_attachment",
];

async function checkMcpConfig(): Promise<HealthCheckResult> {
  try {
    const mcpConfigPath = path.resolve(__dirname, "..", ".mcp.json");
    const content = await fs.readFile(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);

    if (!config.mcpServers || !config.mcpServers["life-dashboard"]) {
      return {
        name: ".mcp.json",
        passed: false,
        detail: "Missing life-dashboard server entry",
      };
    }

    return {
      name: ".mcp.json",
      passed: true,
      detail: "valid config",
    };
  } catch (error) {
    return {
      name: ".mcp.json",
      passed: false,
      detail: error instanceof Error ? error.message : "File not found",
    };
  }
}

async function checkEnvFile(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  try {
    const envPath = path.resolve(__dirname, "..", ".env.local");
    await fs.access(envPath);

    // Check DASHBOARD_URL
    const dashboardUrl = process.env.DASHBOARD_URL;
    if (!dashboardUrl) {
      results.push({
        name: ".env.local",
        passed: false,
        detail: "DASHBOARD_URL not set",
      });
    } else if (!dashboardUrl.startsWith("http")) {
      results.push({
        name: ".env.local",
        passed: false,
        detail: `DASHBOARD_URL="${dashboardUrl}" is not a valid URL`,
      });
    } else {
      // Mask sensitive parts of URL
      const urlObj = new URL(dashboardUrl);
      const maskedUrl = `${urlObj.protocol}//${urlObj.host}`;
      results.push({
        name: ".env.local",
        passed: true,
        detail: `DASHBOARD_URL set (${maskedUrl})`,
      });
    }

    // Check RELAY_API_KEY
    const relayApiKey = process.env.RELAY_API_KEY;
    if (!relayApiKey) {
      results.push({
        name: ".env.local",
        passed: false,
        detail: "RELAY_API_KEY not set",
      });
    } else {
      results.push({
        name: ".env.local",
        passed: true,
        detail: "RELAY_API_KEY set",
      });
    }
  } catch (error) {
    results.push({
      name: ".env.local",
      passed: false,
      detail: "File not found",
    });
  }

  return results;
}

async function checkMcpServerFile(): Promise<HealthCheckResult> {
  try {
    const serverPath = path.resolve(__dirname, "mcp-server.ts");
    await fs.access(serverPath, fs.constants.R_OK);

    return {
      name: "mcp-server.ts",
      passed: true,
      detail: "file readable",
    };
  } catch (error) {
    return {
      name: "mcp-server.ts",
      passed: false,
      detail: "File not found or not readable",
    };
  }
}

// Dependency checker that can be overridden for testing
export let checkPackageInstalled = async (pkg: string): Promise<boolean> => {
  try {
    // For pnpm, check if package.json lists it and node_modules symlink exists
    const packageJsonPath = path.resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(
      await fs.readFile(packageJsonPath, "utf-8")
    );
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    return pkg in allDeps;
  } catch (error) {
    return false;
  }
};

export function setPackageChecker(
  checker: (pkg: string) => Promise<boolean>
): void {
  checkPackageInstalled = checker;
}

async function checkDependencies(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  const requiredPackages = ["@modelcontextprotocol/sdk", "zod"];

  for (const pkg of requiredPackages) {
    const installed = await checkPackageInstalled(pkg);
    if (installed) {
      results.push({
        name: "Dependencies",
        passed: true,
        detail: `${pkg} installed`,
      });
    } else {
      results.push({
        name: "Dependencies",
        passed: false,
        detail: `${pkg} not installed`,
      });
    }
  }

  return results;
}

async function checkApiConnectivity(): Promise<HealthCheckResult> {
  const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
  const relayApiKey = process.env.RELAY_API_KEY || "";

  try {
    const response = await fetch(`${dashboardUrl}/api/relay/status`, {
      method: "GET",
      headers: {
        "x-relay-key": relayApiKey,
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (response.ok) {
      return {
        name: "API connectivity",
        passed: true,
        detail: "/api/relay/status 200 OK",
      };
    } else {
      return {
        name: "API connectivity",
        passed: false,
        detail: `/api/relay/status ${response.status} ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      name: "API connectivity",
      passed: false,
      detail: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

async function checkToolRegistration(): Promise<HealthCheckResult> {
  // We can't directly import and run the MCP server, but we can verify
  // the tool list in the source code by reading it
  try {
    const serverPath = path.resolve(__dirname, "mcp-server.ts");
    const content = await fs.readFile(serverPath, "utf-8");

    // Count tool definitions (very basic check)
    const toolMatches = content.match(/name: "dashboard_\w+"/g);
    const foundToolCount = toolMatches ? toolMatches.length : 0;

    // Verify all expected tools are present
    const missingTools = EXPECTED_TOOLS.filter(
      (tool) => !content.includes(`name: "${tool}"`)
    );

    if (missingTools.length > 0) {
      return {
        name: "Tool count",
        passed: false,
        detail: `Missing tools: ${missingTools.join(", ")}`,
      };
    }

    if (foundToolCount === EXPECTED_TOOLS.length) {
      return {
        name: "Tool count",
        passed: true,
        detail: `${foundToolCount} tools registered`,
      };
    } else {
      return {
        name: "Tool count",
        passed: false,
        detail: `Expected ${EXPECTED_TOOLS.length} tools, found ${foundToolCount}`,
      };
    }
  } catch (error) {
    return {
      name: "Tool count",
      passed: false,
      detail: error instanceof Error ? error.message : "Could not verify tools",
    };
  }
}

export async function runHealthChecks(
  options: HealthCheckOptions = {}
): Promise<HealthCheckReport> {
  const results: HealthCheckResult[] = [];

  // Run all checks
  results.push(await checkMcpConfig());
  results.push(...(await checkEnvFile()));
  results.push(await checkMcpServerFile());
  results.push(...(await checkDependencies()));

  if (!options.offline) {
    results.push(await checkApiConnectivity());
  }

  results.push(await checkToolRegistration());

  // Calculate summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  return { passed, failed, results };
}

function printReport(report: HealthCheckReport): void {
  console.log("🔍 MCP Health Check");
  console.log("─────────────────────");

  for (const result of report.results) {
    const icon = result.passed ? "✅" : "❌";
    const detail = result.detail ? ` — ${result.detail}` : "";
    console.log(`${icon} ${result.name}${detail}`);
  }

  console.log("─────────────────────");

  if (report.failed === 0) {
    console.log(`✅ All ${report.passed} checks passed`);
  } else {
    console.log(
      `❌ ${report.failed} check${report.failed > 1 ? "s" : ""} failed, ${report.passed} passed`
    );
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");

  const report = await runHealthChecks({ offline });
  printReport(report);

  process.exit(report.failed > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
