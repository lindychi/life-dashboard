/**
 * Shared formatting utilities for displaying dates, times, and file sizes.
 * Used across multiple frontend components to ensure consistent formatting.
 */

/**
 * Convert a timestamp to a relative time string (e.g., "3분 전", "2시간 전").
 * Returns Korean localized strings.
 */
export function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  if (diff < 0) return "방금";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

/**
 * Format byte count as human-readable string (e.g., "1.5KB", "256B").
 */
export function formatBytes(n: number): string {
  if (n < 1024) return n + "B";
  return (n / 1024).toFixed(1) + "KB";
}
