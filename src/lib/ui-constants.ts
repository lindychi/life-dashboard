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
 * Unified agent status styles used across all components.
 * Provides badge class, dot/indicator color, pulse animation flag, and Korean labels.
 */
export const STATUS_STYLES: Record<
  string,
  { class: string; bg: string; pulse: boolean; label: string }
> = {
  running: {
    class: "bg-green-500/20 text-green-400 border-green-500/30",
    bg: "bg-green-500",
    pulse: true,
    label: "🟢 실행중",
  },
  idle: {
    class: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    bg: "bg-gray-500",
    pulse: false,
    label: "⚫ 대기",
  },
  waiting: {
    class: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    bg: "bg-yellow-500",
    pulse: true,
    label: "🟡 대기중",
  },
  error: {
    class: "bg-red-500/20 text-red-400 border-red-500/30",
    bg: "bg-red-500",
    pulse: false,
    label: "🔴 에러",
  },
  stale: {
    class: "bg-amber-600/20 text-amber-400 border-amber-600/30",
    bg: "bg-amber-600",
    pulse: false,
    label: "🟠 비활성",
  },
};

/**
 * Unified agent category styles used across all components.
 * Badge class for category pills, and card border accent.
 */
export const CATEGORY_STYLES: Record<
  string,
  { badge: string; card: string }
> = {
  dev: {
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    card: "border-blue-500/30 bg-blue-500/5",
  },
  business: {
    badge: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    card: "border-purple-500/30 bg-purple-500/5",
  },
  ops: {
    badge: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    card: "border-orange-500/30 bg-orange-500/5",
  },
};
