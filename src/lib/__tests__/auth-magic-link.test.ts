/**
 * Fix 4: Magic-link Token Type Validation
 *
 * Tests that verifyMagicLinkToken rejects tokens without type: "magic-link" claim.
 * A regular session token should NOT be usable as a magic-link token.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers cookies
vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
    })
  ),
}));

describe("Magic Link Token Type Validation", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.JWT_SECRET = "test-secret-for-magic-link-tests";
  });

  it("verifyMagicLinkToken should accept tokens with type: magic-link", async () => {
    const { createMagicLinkToken, verifyMagicLinkToken } = await import("@/lib/auth");

    const token = await createMagicLinkToken("test@example.com");
    const result = await verifyMagicLinkToken(token);

    expect(result).not.toBeNull();
    expect(result?.email).toBe("test@example.com");
  });

  it("verifyMagicLinkToken should reject regular session tokens", async () => {
    const { createToken, verifyMagicLinkToken } = await import("@/lib/auth");

    // Create a regular session token (no type: "magic-link" claim)
    const sessionToken = await createToken("test@example.com");
    const result = await verifyMagicLinkToken(sessionToken);

    // Session token should NOT be accepted as magic-link token
    expect(result).toBeNull();
  });

  it("verifyMagicLinkToken should reject expired magic-link tokens", async () => {
    const { verifyMagicLinkToken } = await import("@/lib/auth");

    // An invalid/expired token
    const result = await verifyMagicLinkToken("expired.invalid.token");

    expect(result).toBeNull();
  });

  it("verifyToken should NOT return type field (session tokens only)", async () => {
    const { createToken, verifyToken } = await import("@/lib/auth");

    const token = await createToken("test@example.com");
    const result = await verifyToken(token);

    expect(result).not.toBeNull();
    expect(result?.email).toBe("test@example.com");
    // Regular verifyToken should NOT expose type field
    expect((result as unknown as Record<string, unknown>)?.type).toBeUndefined();
  });
});
