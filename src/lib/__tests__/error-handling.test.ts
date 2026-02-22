import { describe, it, expect } from "vitest";

/**
 * Tests for the error extraction pattern used in page.tsx
 * When API calls fail, we need to read error details from response body,
 * not from response.statusText (which is empty in HTTP/2).
 */

// Helper that mirrors the error extraction pattern in page.tsx
async function extractErrorMessage(response: Response): Promise<string> {
  if (response.ok) return "";
  const errorData = await response.json().catch(() => ({}));
  return (errorData as { error?: string }).error || `HTTP ${response.status}`;
}

describe("API error message extraction", () => {
  it("should extract error from response body JSON", async () => {
    const response = new Response(
      JSON.stringify({ error: "No connected gateway" }),
      { status: 400 }
    );

    const message = await extractErrorMessage(response);
    expect(message).toBe("No connected gateway");
  });

  it("should handle HTTP/2 empty statusText gracefully", async () => {
    // HTTP/2 always returns empty statusText
    const response = new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, statusText: "" }
    );

    const message = await extractErrorMessage(response);
    expect(message).toBe("Unauthorized");
  });

  it("should fallback to HTTP status code when body has no error field", async () => {
    const response = new Response(
      JSON.stringify({ success: false }),
      { status: 500 }
    );

    const message = await extractErrorMessage(response);
    expect(message).toBe("HTTP 500");
  });

  it("should fallback to HTTP status code when body is not valid JSON", async () => {
    const response = new Response("Internal Server Error", { status: 500 });

    const message = await extractErrorMessage(response);
    expect(message).toBe("HTTP 500");
  });

  it("should return empty string for successful responses", async () => {
    const response = new Response(JSON.stringify({ success: true }), { status: 200 });

    const message = await extractErrorMessage(response);
    expect(message).toBe("");
  });

  it("should handle 400 Bad Request with error details", async () => {
    const response = new Response(
      JSON.stringify({ error: "type and payload required" }),
      { status: 400 }
    );

    const message = await extractErrorMessage(response);
    expect(message).toBe("type and payload required");
  });

  it("should handle empty response body", async () => {
    const response = new Response("", { status: 503 });

    const message = await extractErrorMessage(response);
    expect(message).toBe("HTTP 503");
  });

  it("should handle network-level error format", async () => {
    // Some API routes return { error: "Server error" }
    const response = new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500 }
    );

    const message = await extractErrorMessage(response);
    expect(message).toBe("Server error");
  });
});
