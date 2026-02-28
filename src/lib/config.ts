/**
 * Lazy-initialized configuration constants
 * Ensures env vars are read at runtime, not build time
 */

let _relayApiKey: string | null = null;

export function getRelayApiKey(): string {
  if (_relayApiKey) return _relayApiKey;
  const key = process.env.RELAY_API_KEY;
  if (!key && process.env.NODE_ENV === "production") {
    throw new Error("RELAY_API_KEY environment variable is required in production");
  }
  _relayApiKey = key || "dev-relay-key";
  return _relayApiKey;
}

// Use getRelayApiKey() inside request handlers, not at module level
