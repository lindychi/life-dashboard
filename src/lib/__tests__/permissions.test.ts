import { describe, it, expect } from "vitest";
import {
  matchPattern,
  findMatchingRule,
  checkPermission,
  checkPermissions,
  isApprovalExpired,
  getApprovalExpiration,
  type PermissionRule,
} from "../permissions";

describe("permissions", () => {
  describe("matchPattern", () => {
    it("should match exact paths", () => {
      expect(matchPattern("src/lib/auth.ts", "src/lib/auth.ts")).toBe(true);
      expect(matchPattern("src/lib/auth.ts", "src/lib/db.ts")).toBe(false);
    });

    it("should match single wildcard (*)", () => {
      expect(matchPattern("src/*.ts", "src/auth.ts")).toBe(true);
      expect(matchPattern("src/*.ts", "src/lib/auth.ts")).toBe(false); // * doesn't match /
    });

    it("should match double wildcard (**) across multiple path segments", () => {
      // ** requires at least one intermediate segment in this implementation
      expect(matchPattern("src/**/*.ts", "src/lib/auth.ts")).toBe(true);
      expect(matchPattern("src/**/*.ts", "src/lib/nested/auth.ts")).toBe(true);
      expect(matchPattern("src/**/*.ts", "src/lib/auth.js")).toBe(false);
    });

    it("should match .git paths with subdirectory", () => {
      // .git/**/* requires at least one subdirectory segment after .git/
      expect(matchPattern(".git/**/*", ".git/objects/abc123")).toBe(true);
      expect(matchPattern(".git/**/*", ".git/refs/heads/main")).toBe(true);
      expect(matchPattern(".git/**/*", "src/.git/config")).toBe(false);
    });

    it("should normalize leading ./", () => {
      expect(matchPattern("./src/auth.ts", "src/auth.ts")).toBe(true);
      expect(matchPattern("src/auth.ts", "./src/auth.ts")).toBe(true);
    });

    it("should match environment files", () => {
      expect(matchPattern(".env*", ".env")).toBe(true);
      expect(matchPattern(".env*", ".env.local")).toBe(true);
      expect(matchPattern(".env*", ".env.production")).toBe(true);
      expect(matchPattern(".env*", "src/.env")).toBe(false);
    });
  });

  describe("findMatchingRule", () => {
    const testRules: PermissionRule[] = [
      {
        pattern: ".git/**/*",
        actions: ["write", "delete"],
        level: "require_approval",
        reason: "Git files require approval",
        priority: 100,
      },
      {
        pattern: "**/*.ts",
        actions: ["write"],
        level: "allow",
        reason: "TypeScript files allowed",
        priority: 50,
      },
      {
        pattern: "**/*",
        actions: ["read", "write", "delete"],
        level: "allow",
        reason: "Default allow",
        priority: 0,
      },
    ];

    it("should find highest priority matching rule for nested git paths", () => {
      // .git/**/* matches .git/objects/abc (has subdirectory), not .git/config (flat)
      const rule = findMatchingRule(".git/objects/abc", "write", testRules);
      expect(rule).toBeDefined();
      expect(rule?.pattern).toBe(".git/**/*");
      expect(rule?.priority).toBe(100);
    });

    it("should fall back to default rule for .git/config (single segment)", () => {
      // .git/**/* doesn't match .git/config because ** requires a segment
      const rule = findMatchingRule(".git/config", "write", testRules);
      expect(rule).toBeDefined();
      // Falls through to **/*.ts (no match for .git/config) then **/*
      expect(rule?.pattern).toBe("**/*");
    });

    it("should respect action matching", () => {
      const rule = findMatchingRule(".git/objects/abc", "read", testRules);
      // .git rule doesn't match "read" action, should fall back to default
      expect(rule).toBeDefined();
      expect(rule?.pattern).toBe("**/*");
    });

    it("should return default rule if no specific match", () => {
      const rule = findMatchingRule("src/lib/auth.ts", "read", testRules);
      expect(rule).toBeDefined();
      expect(rule?.pattern).toBe("**/*");
    });

    it("should return null if no rules match", () => {
      const rule = findMatchingRule("src/lib/auth.ts", "write", [
        {
          pattern: ".git/**/*",
          actions: ["write"],
          level: "deny",
          reason: "Git only",
          priority: 100,
        },
      ]);
      expect(rule).toBeNull();
    });
  });

  describe("checkPermission", () => {
    const testRules: PermissionRule[] = [
      {
        pattern: ".git/**/*",
        actions: ["write", "delete"],
        level: "require_approval",
        reason: "Git files require approval",
        priority: 100,
      },
      {
        pattern: "**/*.pem",
        actions: ["read", "write", "delete"],
        level: "deny",
        reason: "Private keys forbidden",
        priority: 110,
      },
      {
        pattern: "src/**/*.ts",
        actions: ["write"],
        level: "allow",
        reason: "TypeScript files allowed",
        priority: 50,
      },
      {
        pattern: "**/*",
        actions: ["read", "write", "delete"],
        level: "allow",
        reason: "Default allow",
        priority: 0,
      },
    ];

    it("should allow normal file writes in nested directories", () => {
      const result = checkPermission("src/lib/auth.ts", "write", testRules);
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("should require approval for deeply nested .git files", () => {
      // .git/**/* matches paths with at least one subdirectory after .git/
      const result = checkPermission(".git/objects/pack/file.idx", "write", testRules);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.rule?.reason).toContain("Git");
    });

    it("should deny private key access", () => {
      const result = checkPermission("secrets/private.pem", "read", testRules);
      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.rule?.reason).toBeDefined();
    });

    it("should allow read on .git files (not in write/delete rule)", () => {
      const result = checkPermission(".git/config", "read", testRules);
      expect(result.allowed).toBe(true); // Falls back to default allow
    });

    it("should return allowed:false with no rule when action has no match", () => {
      const result = checkPermission("src/lib/auth.ts", "execute", [
        {
          pattern: "src/**/*.ts",
          actions: ["write"],
          level: "allow",
          reason: "TS files",
          priority: 50,
        },
      ]);
      expect(result.allowed).toBe(false);
      expect(result.rule).toBeNull();
    });
  });

  describe("checkPermissions (batch)", () => {
    const testRules: PermissionRule[] = [
      {
        pattern: ".git/**/*",
        actions: ["write"],
        level: "require_approval",
        reason: "Git files",
        priority: 100,
      },
      {
        pattern: "**/*",
        actions: ["read", "write"],
        level: "allow",
        reason: "Default",
        priority: 0,
      },
    ];

    it("should check multiple paths/actions and return results for each", () => {
      const results = checkPermissions(
        [
          { path: "src/lib/auth.ts", action: "write" },
          { path: ".git/objects/abc", action: "write" }, // nested - matches .git/**/* (requires subdir)
          { path: "src/README.md", action: "read" }, // has a slash so **/* matches it
        ],
        testRules
      );

      expect(results).toHaveLength(3);
      expect(results[0].allowed).toBe(true);
      expect(results[1].requiresApproval).toBe(true);
      expect(results[2].allowed).toBe(true);
    });

    it("should include path and action in each result", () => {
      const results = checkPermissions(
        [{ path: "src/lib/auth.ts", action: "read" }],
        testRules
      );

      expect(results[0].path).toBe("src/lib/auth.ts");
      expect(results[0].action).toBe("read");
    });
  });

  describe("approval expiration", () => {
    it("should generate future expiration", () => {
      const expiration = getApprovalExpiration(60000); // 1 minute
      const expiresAt = new Date(expiration);
      const now = new Date();

      expect(expiresAt > now).toBe(true);
      expect(expiresAt.getTime() - now.getTime()).toBeGreaterThan(50000); // ~1 min
      expect(expiresAt.getTime() - now.getTime()).toBeLessThan(70000);
    });

    it("should detect expired approvals", () => {
      const pastTime = new Date(Date.now() - 60000).toISOString(); // 1 minute ago
      expect(isApprovalExpired(pastTime)).toBe(true);
    });

    it("should detect non-expired approvals", () => {
      const futureTime = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      expect(isApprovalExpired(futureTime)).toBe(false);
    });
  });
});
