/**
 * Performance utilities for optimizing the History tab rendering
 */

export interface HistoryEntry {
  id: string;
  agentId: string;
  type: string;
  content: string;
  timestamp: string;
}

export interface VisibleRange {
  start: number;
  end: number;
  totalHeight: number;
}

/**
 * Calculate which items are visible in a virtual scrolling container
 *
 * @param scrollTop - Current scroll position
 * @param containerHeight - Height of the scrollable container
 * @param itemHeight - Fixed height of each item
 * @param totalItems - Total number of items in the list
 * @param overscan - Number of extra items to render above/below viewport (default: 5)
 * @returns Object with start index, end index, and total height
 */
export function getVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  overscan: number = 5
): VisibleRange {
  // Handle edge cases
  if (totalItems === 0 || itemHeight <= 0 || containerHeight <= 0) {
    return { start: 0, end: 0, totalHeight: 0 };
  }

  // Ensure scrollTop is non-negative
  const safeScrollTop = Math.max(0, scrollTop);

  // Calculate visible range
  const firstVisibleIndex = Math.floor(safeScrollTop / itemHeight);
  const lastVisibleIndex = Math.ceil((safeScrollTop + containerHeight) / itemHeight);

  // Apply overscan and clamp to valid range
  const start = Math.max(0, firstVisibleIndex - overscan);
  const end = Math.min(totalItems, lastVisibleIndex + overscan);

  const totalHeight = totalItems * itemHeight;

  return { start, end, totalHeight };
}

/**
 * Filter history entries by agent and type
 *
 * @param entries - Array of history entries
 * @param filterAgent - Agent ID to filter by, or "all" for no filtering
 * @param filterType - Type to filter by, or "all" for no filtering
 * @returns Filtered array sorted newest-first (by timestamp descending)
 */
export function filterEntries(
  entries: HistoryEntry[],
  filterAgent: string,
  filterType: string
): HistoryEntry[] {
  let filtered = entries;

  // Filter by agent if not "all"
  if (filterAgent !== "all") {
    filtered = filtered.filter(entry => entry.agentId === filterAgent);
  }

  // Filter by type if not "all"
  if (filterType !== "all") {
    filtered = filtered.filter(entry => entry.type === filterType);
  }

  // Sort by timestamp descending (newest first)
  return filtered.sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

/**
 * Detect if content looks like a question or request that needs user response
 *
 * @param content - Text content to analyze
 * @returns true if content appears to be a question
 */
export function looksLikeQuestion(content: string): boolean {
  // Skip short messages
  if (content.length < 30) {
    return false;
  }

  // Exclude completion patterns
  const completionPatterns = /^(completed|task completed|done|완료|성공|실패|error|timeout)/i;
  if (completionPatterns.test(content)) {
    return false;
  }

  // Exclude orchestrator emoji prefixes
  const orchestratorEmojiPattern = /^[🏁📊📋📨⏳]/;
  if (orchestratorEmojiPattern.test(content)) {
    return false;
  }

  // Check for question/request patterns (Korean + English)
  const questionPatterns = [
    /\?/, // Question mark
    /기다리/, // Waiting (Korean)
    /확인.*(?:필요|싶|주세요|할까)/, // Confirmation needed (Korean)
    /알려.*주/, // Please let me know (Korean)
    /어떤.*(?:할까|좋을까|원하)/, // Which to do (Korean)
    /선택.*(?:해주|필요)/, // Please select (Korean)
    /의견/, // Opinion (Korean)
    /피드백/, // Feedback (Korean)
    /결정.*(?:필요|해주)/, // Decision needed (Korean)
    /(?:which|what|how|should|would you|please|let me know)/i // English patterns
  ];

  return questionPatterns.some(pattern => pattern.test(content));
}

/**
 * Truncate content for preview display
 *
 * @param content - Text to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string with "..." if too long, or original if within limit
 */
export function truncateForPreview(content: string, maxLength: number): string {
  if (content.length === 0) {
    return content;
  }

  if (content.length <= maxLength) {
    return content;
  }

  return content.slice(0, maxLength) + "...";
}
