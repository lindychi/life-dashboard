/**
 * Shared UI constants for consistent styling across components.
 * Includes history type labels, status styles, and category styles.
 */

/**
 * Labels and colors for different history event types.
 * Used in HistoryPanel and HistoryEntryCard for consistent badges.
 */
export const HISTORY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  task_started: { label: "시작", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  task_completed: { label: "완료", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  task_failed: { label: "실패", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  message_sent: { label: "발신", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  message_received: { label: "수신", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  status_change: { label: "상태", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  command_received: { label: "명령", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  output: { label: "출력", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

/**
 * Agent status indicator styles.
 * Maps status values to Tailwind classes for consistent visual representation.
 */
export const STATUS_STYLES: Record<string, string> = {
  running: "bg-green-500/20 text-green-400 border-green-500/30",
  idle: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  waiting: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  error: "bg-red-500/20 text-red-400 border-red-500/30",
};

/**
 * Agent category styles for visual grouping.
 * Maps category values to Tailwind classes.
 */
export const CATEGORY_STYLES: Record<string, string> = {
  dev: "border-blue-500/30 bg-blue-500/5",
  business: "border-purple-500/30 bg-purple-500/5",
  ops: "border-orange-500/30 bg-orange-500/5",
};
