/**
 * Permission System for Life Dashboard
 *
 * Provides fine-grained access control for sensitive file operations.
 * Protects critical paths (.git/, config files, production data) from
 * unauthorized modifications.
 */

// ─── Permission Rules ─────────────────────────────────────────

export type PermissionAction = "read" | "write" | "delete" | "execute";
export type PermissionLevel = "allow" | "deny" | "require_approval";

export interface PermissionRule {
  /** Pattern to match against file paths (supports glob-like wildcards) */
  pattern: string;
  /** Actions this rule applies to */
  actions: PermissionAction[];
  /** Permission level for matched paths */
  level: PermissionLevel;
  /** Human-readable reason for the restriction */
  reason: string;
  /** Priority (higher number = higher priority, default: 0) */
  priority?: number;
}

/**
 * Default permission rules
 * Rules are evaluated in priority order (highest first).
 */
export const DEFAULT_PERMISSION_RULES: PermissionRule[] = [
  // ─── Critical System Files (Deny) ───────────────────────
  {
    pattern: ".git/**/*",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "Git 저장소 무결성 보호 - 변경 시 승인 필요",
    priority: 100,
  },
  {
    pattern: ".git/config",
    actions: ["read", "write", "delete"],
    level: "require_approval",
    reason: "Git 설정 파일 - 읽기/쓰기 모두 승인 필요",
    priority: 110,
  },
  {
    pattern: ".git/HEAD",
    actions: ["write", "delete"],
    level: "deny",
    reason: "Git HEAD 참조 - 직접 수정 금지",
    priority: 120,
  },

  // ─── Environment & Secrets ──────────────────────────────
  {
    pattern: ".env*",
    actions: ["read", "write", "delete"],
    level: "require_approval",
    reason: "환경 변수 파일 - 민감 정보 포함 가능",
    priority: 90,
  },
  {
    pattern: "**/*.pem",
    actions: ["read", "write", "delete"],
    level: "deny",
    reason: "암호화 키 파일 - 접근 금지",
    priority: 100,
  },
  {
    pattern: "**/*.key",
    actions: ["read", "write", "delete"],
    level: "deny",
    reason: "개인 키 파일 - 접근 금지",
    priority: 100,
  },
  {
    pattern: "**/credentials.json",
    actions: ["read", "write", "delete"],
    level: "deny",
    reason: "인증 정보 파일 - 접근 금지",
    priority: 100,
  },

  // ─── Database & Production Data ─────────────────────────
  {
    pattern: "**/*.db",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "데이터베이스 파일 - 변경 시 승인 필요",
    priority: 80,
  },
  {
    pattern: "sql/**/*",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "마이그레이션 스크립트 - 변경 시 승인 필요",
    priority: 75,
  },

  // ─── Build & Deployment ─────────────────────────────────
  {
    pattern: "package.json",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "패키지 의존성 변경 - 승인 필요",
    priority: 70,
  },
  {
    pattern: "package-lock.json",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "잠금 파일 변경 - 승인 필요",
    priority: 70,
  },
  {
    pattern: "Dockerfile",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "배포 설정 변경 - 승인 필요",
    priority: 70,
  },
  {
    pattern: "railway.toml",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "배포 설정 변경 - 승인 필요",
    priority: 70,
  },

  // ─── Node Modules (Deny) ────────────────────────────────
  {
    pattern: "node_modules/**/*",
    actions: ["write", "delete"],
    level: "deny",
    reason: "의존성 패키지 - 직접 수정 금지 (npm/pnpm 사용)",
    priority: 60,
  },

  // ─── System Directories ─────────────────────────────────
  {
    pattern: "/etc/**/*",
    actions: ["write", "delete", "execute"],
    level: "deny",
    reason: "시스템 설정 디렉토리 - 접근 금지",
    priority: 100,
  },
  {
    pattern: "/var/**/*",
    actions: ["write", "delete"],
    level: "require_approval",
    reason: "시스템 데이터 디렉토리 - 승인 필요",
    priority: 90,
  },

  // ─── Default Allow (lowest priority) ────────────────────
  {
    pattern: "**/*",
    actions: ["read", "write", "delete", "execute"],
    level: "allow",
    reason: "일반 파일 - 접근 허용",
    priority: 0,
  },
];

// ─── Pattern Matching ─────────────────────────────────────

/**
 * Simple glob-like pattern matching
 * Supports: *, **, ?
 */
export function matchPattern(pattern: string, path: string): boolean {
  // Normalize paths (remove leading ./)
  const normalizedPath = path.replace(/^\.\//, "");
  const normalizedPattern = pattern.replace(/^\.\//, "");

  // Convert glob pattern to regex
  const regexPattern = normalizedPattern
    .replace(/\./g, "\\.")  // Escape dots
    .replace(/\*\*/g, "%%%DOUBLESTAR%%%")  // Temporarily replace **
    .replace(/\*/g, "[^/]*")  // * matches anything except /
    .replace(/%%%DOUBLESTAR%%%/g, ".*")  // ** matches anything including /
    .replace(/\?/g, "[^/]");  // ? matches single char except /

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedPath);
}

/**
 * Find the highest-priority matching rule for a path and action
 */
export function findMatchingRule(
  path: string,
  action: PermissionAction,
  rules: PermissionRule[] = DEFAULT_PERMISSION_RULES
): PermissionRule | null {
  // Sort rules by priority (descending)
  const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of sortedRules) {
    if (rule.actions.includes(action) && matchPattern(rule.pattern, path)) {
      return rule;
    }
  }

  return null;
}

/**
 * Check if an operation is allowed without approval
 */
export function checkPermission(
  path: string,
  action: PermissionAction,
  rules?: PermissionRule[]
): { allowed: boolean; requiresApproval: boolean; rule: PermissionRule | null } {
  const matchedRule = findMatchingRule(path, action, rules);

  if (!matchedRule) {
    // No matching rule - deny by default
    return { allowed: false, requiresApproval: false, rule: null };
  }

  return {
    allowed: matchedRule.level === "allow",
    requiresApproval: matchedRule.level === "require_approval",
    rule: matchedRule,
  };
}

// ─── Approval Request ─────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  id: string;
  agentId: string;
  gatewayId: string;
  commandId: string;
  path: string;
  action: PermissionAction;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

export interface CreateApprovalRequest {
  agentId: string;
  gatewayId: string;
  commandId: string;
  path: string;
  action: PermissionAction;
  reason: string;
  metadata?: Record<string, unknown>;
}

// ─── Batch Permission Check ───────────────────────────────

export interface BatchPermissionCheck {
  path: string;
  action: PermissionAction;
}

export interface BatchPermissionResult {
  path: string;
  action: PermissionAction;
  allowed: boolean;
  requiresApproval: boolean;
  rule: PermissionRule | null;
}

/**
 * Check multiple paths/actions in a single call
 */
export function checkPermissions(
  checks: BatchPermissionCheck[],
  rules?: PermissionRule[]
): BatchPermissionResult[] {
  return checks.map((check) => {
    const result = checkPermission(check.path, check.action, rules);
    return {
      path: check.path,
      action: check.action,
      ...result,
    };
  });
}

// ─── Approval Timeout ─────────────────────────────────────

/** Default approval expiration: 5 minutes */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Calculate expiration timestamp for an approval request
 */
export function getApprovalExpiration(
  timeoutMs: number = DEFAULT_APPROVAL_TIMEOUT_MS
): string {
  const expiresAt = new Date(Date.now() + timeoutMs);
  return expiresAt.toISOString();
}

/**
 * Check if an approval request has expired
 */
export function isApprovalExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date();
}
