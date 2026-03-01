"use client";

import type { ToastType } from "@/hooks/useToast";

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

const TOAST_STYLES: Record<ToastType, { border: string; icon: string; text: string }> = {
  error: {
    border: "border-red-500/50 bg-red-500/10",
    icon: "text-red-400",
    text: "text-red-200",
  },
  success: {
    border: "border-green-500/50 bg-green-500/10",
    icon: "text-green-400",
    text: "text-green-200",
  },
  info: {
    border: "border-blue-500/50 bg-blue-500/10",
    icon: "text-blue-400",
    text: "text-blue-200",
  },
};

const TOAST_ICONS: Record<ToastType, string> = {
  error: "\u274C",
  success: "\u2705",
  info: "\u2139\uFE0F",
};

export function Toast({ message, type, onClose }: ToastProps) {
  const styles = TOAST_STYLES[type];

  return (
    <div
      role="alert"
      className={`
        flex items-start gap-3
        px-4 py-3
        rounded-lg border
        shadow-lg backdrop-blur-sm
        ${styles.border}
        animate-in slide-in-from-right duration-200
      `}
    >
      <span className={`text-base flex-shrink-0 ${styles.icon}`}>
        {TOAST_ICONS[type]}
      </span>
      <p className={`text-sm flex-1 ${styles.text}`}>{message}</p>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-white text-sm flex-shrink-0 transition-colors"
        aria-label="닫기"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
