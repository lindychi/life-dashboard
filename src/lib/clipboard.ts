/**
 * Format content for clipboard copy
 * Strips emoji prefixes and delegation arrows while preserving the actual content
 */
export function formatContentForCopy(content: string): string {
  if (!content) return "";

  let result = content;

  // Strip leading emoji characters (common status emojis used in history)
  result = result.replace(/^[📋📨✅❌🔄🧠📊🏁⚠️📡🔌🚀💬🔑⏱️🎯]\s*/u, "");

  // Strip delegation arrow patterns: "AgentName → AgentName: "
  result = result.replace(/^\S+\s*→\s*\S+:\s*/, "");

  // Strip quoted delegation content pattern
  result = result.replace(/^[""](.+)[""]$/, "$1");

  return result.trim();
}

/**
 * Copy text content to clipboard
 * Returns true on success, false on failure
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  const formatted = formatContentForCopy(content);

  try {
    if (!navigator?.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(formatted);
    return true;
  } catch {
    return false;
  }
}
