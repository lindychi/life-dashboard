import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

// Mock fs/promises
vi.mock("fs/promises");

// Mock dotenv config
vi.mock("dotenv", () => ({
  config: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("MCP Health Check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    // Reset environment variables
    delete process.env.DASHBOARD_URL;
    delete process.env.RELAY_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Config validation", () => {
    it("should pass when .mcp.json is valid", async () => {
      const validConfig = JSON.stringify({
        mcpServers: {
          "life-dashboard": {
            type: "stdio",
            command: "npx",
            args: ["tsx", "scripts/mcp-server.ts"],
          },
        },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(validConfig);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      // Set valid env vars
      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      // Mock require.resolve for dependencies
      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const mcpConfigResult = report.results.find((r) => r.name === ".mcp.json");
      expect(mcpConfigResult?.passed).toBe(true);
      expect(mcpConfigResult?.detail).toBe("valid config");
    });

    it("should fail when .mcp.json is missing life-dashboard entry", async () => {
      const invalidConfig = JSON.stringify({
        mcpServers: {
          "other-server": {},
        },
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(invalidConfig);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const mcpConfigResult = report.results.find((r) => r.name === ".mcp.json");
      expect(mcpConfigResult?.passed).toBe(false);
      expect(mcpConfigResult?.detail).toContain("Missing life-dashboard");
    });

    it("should fail when .mcp.json does not exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(
        new Error("ENOENT: no such file or directory")
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const mcpConfigResult = report.results.find((r) => r.name === ".mcp.json");
      expect(mcpConfigResult?.passed).toBe(false);
    });
  });

  describe("Environment validation", () => {
    it("should pass when DASHBOARD_URL is valid", async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const urlResult = report.results.find(
        (r) => r.name === ".env.local" && r.detail?.includes("DASHBOARD_URL")
      );
      expect(urlResult?.passed).toBe(true);
      expect(urlResult?.detail).toContain("https://example.com");
    });

    it("should fail when DASHBOARD_URL is not a valid URL", async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "${DASHBOARD_URL}"; // Unexpanded variable
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const urlResult = report.results.find(
        (r) => r.name === ".env.local" && r.detail?.includes("DASHBOARD_URL")
      );
      expect(urlResult?.passed).toBe(false);
      expect(urlResult?.detail).toContain("not a valid URL");
    });

    it("should fail when RELAY_API_KEY is missing", async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      // RELAY_API_KEY not set

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const keyResult = report.results.find(
        (r) => r.name === ".env.local" && r.detail?.includes("RELAY_API_KEY")
      );
      expect(keyResult?.passed).toBe(false);
      expect(keyResult?.detail).toContain("not set");
    });

    it("should fail when .env.local does not exist", async () => {
      // .mcp.json exists and is valid
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );

      // .env.local access fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

      // Unset env vars to simulate missing .env.local
      delete process.env.DASHBOARD_URL;
      delete process.env.RELAY_API_KEY;

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const envResult = report.results.find(
        (r) => r.name === ".env.local" && r.detail === "File not found"
      );
      expect(envResult?.passed).toBe(false);
    });
  });

  describe("Dependencies check", () => {
    it("should pass when all dependencies are installed", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );

      // Mock package checker to simulate installed packages
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const mcpSdkResult = report.results.find(
        (r) =>
          r.name === "Dependencies" &&
          r.detail?.includes("@modelcontextprotocol/sdk")
      );
      const zodResult = report.results.find(
        (r) => r.name === "Dependencies" && r.detail?.includes("zod")
      );

      expect(mcpSdkResult?.passed).toBe(true);
      expect(zodResult?.passed).toBe(true);
    });

    it("should fail when dependencies are missing", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );

      // Mock package checker to simulate missing packages
      setPackageChecker(async () => false);

      const report = await runHealthChecks({ offline: true });

      const dependencyResults = report.results.filter(
        (r) => r.name === "Dependencies" && !r.passed
      );
      expect(dependencyResults.length).toBeGreaterThan(0);
    });
  });

  describe("Offline mode", () => {
    it("should skip API connectivity check when --offline is set", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const connectivityResult = report.results.find(
        (r) => r.name === "API connectivity"
      );
      expect(connectivityResult).toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should run API connectivity check when offline is false", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const originalRequireResolve = require.resolve;
      require.resolve = vi.fn(() => "/path/to/module") as typeof require.resolve;

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const { runHealthChecks } = await import("../mcp-healthcheck");
      const report = await runHealthChecks({ offline: false });

      require.resolve = originalRequireResolve;

      const connectivityResult = report.results.find(
        (r) => r.name === "API connectivity"
      );
      expect(connectivityResult?.passed).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/api/relay/status",
        expect.objectContaining({
          method: "GET",
          headers: { "x-relay-key": "test-key" },
        })
      );
    });
  });

  describe("API connectivity", () => {
    it("should pass when API returns 200", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const originalRequireResolve = require.resolve;
      require.resolve = vi.fn(() => "/path/to/module") as typeof require.resolve;

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
      } as Response);

      const { runHealthChecks } = await import("../mcp-healthcheck");
      const report = await runHealthChecks({ offline: false });

      require.resolve = originalRequireResolve;

      const connectivityResult = report.results.find(
        (r) => r.name === "API connectivity"
      );
      expect(connectivityResult?.passed).toBe(true);
      expect(connectivityResult?.detail).toContain("200 OK");
    });

    it("should fail when API returns non-200", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const originalRequireResolve = require.resolve;
      require.resolve = vi.fn(() => "/path/to/module") as typeof require.resolve;

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);

      const { runHealthChecks } = await import("../mcp-healthcheck");
      const report = await runHealthChecks({ offline: false });

      require.resolve = originalRequireResolve;

      const connectivityResult = report.results.find(
        (r) => r.name === "API connectivity"
      );
      expect(connectivityResult?.passed).toBe(false);
      expect(connectivityResult?.detail).toContain("401");
    });

    it("should fail when API connection times out", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const originalRequireResolve = require.resolve;
      require.resolve = vi.fn(() => "/path/to/module") as typeof require.resolve;

      vi.mocked(global.fetch).mockRejectedValueOnce(
        new Error("Network timeout")
      );

      const { runHealthChecks } = await import("../mcp-healthcheck");
      const report = await runHealthChecks({ offline: false });

      require.resolve = originalRequireResolve;

      const connectivityResult = report.results.find(
        (r) => r.name === "API connectivity"
      );
      expect(connectivityResult?.passed).toBe(false);
      expect(connectivityResult?.detail).toContain("timeout");
    });
  });

  describe("Tool registration", () => {
    it("should pass when all 9 tools are registered", async () => {
      const serverContent = `
        name: "dashboard_get_history"
        name: "dashboard_get_agents"
        name: "dashboard_get_status"
        name: "dashboard_get_messages"
        name: "dashboard_add_history"
        name: "dashboard_send_message"
        name: "dashboard_send_command"
        name: "dashboard_search_history"
        name: "dashboard_upload_attachment"
      `;

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ mcpServers: { "life-dashboard": {} } })
        )
        .mockResolvedValueOnce(serverContent);

      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const toolResult = report.results.find((r) => r.name === "Tool count");
      expect(toolResult?.passed).toBe(true);
      expect(toolResult?.detail).toContain("9 tools registered");
    });

    it("should fail when tools are missing", async () => {
      const serverContent = `
        name: "dashboard_get_history"
        name: "dashboard_get_agents"
      `;

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ mcpServers: { "life-dashboard": {} } })
        )
        .mockResolvedValueOnce(serverContent);

      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      const toolResult = report.results.find((r) => r.name === "Tool count");
      expect(toolResult?.passed).toBe(false);
      expect(toolResult?.detail).toContain("Missing tools");
    });
  });

  describe("Summary report", () => {
    it("should count passed and failed checks correctly", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ mcpServers: { "life-dashboard": {} } })
      );
      vi.mocked(fs.access).mockResolvedValue(undefined);

      process.env.DASHBOARD_URL = "https://example.com";
      process.env.RELAY_API_KEY = "test-key";

      const { runHealthChecks, setPackageChecker } = await import(
        "../mcp-healthcheck"
      );
      setPackageChecker(async () => true);

      const report = await runHealthChecks({ offline: true });

      expect(report.passed).toBeGreaterThan(0);
      expect(report.passed + report.failed).toBe(report.results.length);
    });
  });
});
