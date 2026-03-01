/**
 * Fix 5: ILIKE Escaping
 *
 * Tests that special characters %, _, \ in search queries are properly escaped
 * before being used in ILIKE patterns.
 */

import { describe, it, expect } from "vitest";
import { escapeIlike } from "@/lib/sql-utils";

describe("escapeIlike", () => {
  it("should escape % character", () => {
    expect(escapeIlike("100%")).toBe("100\\%");
  });

  it("should escape _ character", () => {
    expect(escapeIlike("user_name")).toBe("user\\_name");
  });

  it("should escape \\ character", () => {
    expect(escapeIlike("path\\to")).toBe("path\\\\to");
  });

  it("should escape all special characters together", () => {
    expect(escapeIlike("100%_test\\end")).toBe("100\\%\\_test\\\\end");
  });

  it("should leave normal strings unchanged", () => {
    expect(escapeIlike("hello world")).toBe("hello world");
  });

  it("should handle empty string", () => {
    expect(escapeIlike("")).toBe("");
  });

  it("should ensure searching '100%' does not match '100something'", () => {
    // The escaped pattern should be "100\%" which in ILIKE only matches literal "100%"
    const escaped = escapeIlike("100%");
    // The pattern should contain escaped %, not bare %
    expect(escaped).not.toBe("100%");
    expect(escaped).toBe("100\\%");
  });
});
