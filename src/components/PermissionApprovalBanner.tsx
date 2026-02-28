/**
 * PermissionApprovalBanner Component
 *
 * Notification banner for pending permission approval requests
 */

"use client";

import { useState } from "react";
import type { ApprovalRequest } from "@/lib/permissions";
import PermissionApprovalModal from "./PermissionApprovalModal";

interface PermissionApprovalBannerProps {
  pendingApprovals: ApprovalRequest[];
  onApprove: (approvalId: string) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
}

export default function PermissionApprovalBanner({
  pendingApprovals,
  onApprove,
  onDeny,
}: PermissionApprovalBannerProps) {
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  if (pendingApprovals.length === 0) {
    return null;
  }

  const actionEmoji: Record<string, string> = {
    read: "📖",
    write: "✏️",
    delete: "🗑️",
    execute: "⚡",
  };

  const actionLabel: Record<string, string> = {
    read: "읽기",
    write: "쓰기",
    delete: "삭제",
    execute: "실행",
  };

  return (
    <>
      <div className="bg-yellow-900/20 border-l-4 border-yellow-500 p-4 mb-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <svg
              className="w-6 h-6 text-yellow-400 animate-pulse"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Content */}
          <div className="flex-1">
            <h3 className="text-lg font-bold text-yellow-400">
              🔐 권한 승인 필요 ({pendingApprovals.length}건)
            </h3>
            <p className="text-sm text-yellow-300 mt-1">
              에이전트가 민감한 작업을 수행하기 위해 승인을 대기하고 있습니다
            </p>

            {/* Approval List (Collapsed/Expanded) */}
            <div className="mt-3 space-y-2">
              {(isExpanded ? pendingApprovals : pendingApprovals.slice(0, 2)).map((approval) => (
                <div
                  key={approval.id}
                  className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-yellow-500/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg" aria-label={actionLabel[approval.action]}>
                          {actionEmoji[approval.action] || "📝"}
                        </span>
                        <span className="text-sm font-medium text-yellow-400">
                          {actionLabel[approval.action] || approval.action}
                        </span>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-400">{approval.agentId}</span>
                      </div>
                      <code className="text-xs text-gray-300 font-mono break-all">
                        {approval.path}
                      </code>
                      <p className="text-xs text-gray-400 mt-1">{approval.reason}</p>
                    </div>
                    <button
                      onClick={() => setSelectedApproval(approval)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-yellow-600 text-white hover:bg-yellow-500 transition-colors whitespace-nowrap"
                    >
                      검토
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Expand/Collapse Button */}
            {pendingApprovals.length > 2 && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="mt-2 text-sm text-yellow-400 hover:text-yellow-300 transition-colors underline"
              >
                {isExpanded
                  ? "접기"
                  : `+${pendingApprovals.length - 2}건 더 보기`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {selectedApproval && (
        <PermissionApprovalModal
          approval={selectedApproval}
          onApprove={onApprove}
          onDeny={onDeny}
          onClose={() => setSelectedApproval(null)}
        />
      )}
    </>
  );
}
