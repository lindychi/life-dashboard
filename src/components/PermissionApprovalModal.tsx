/**
 * PermissionApprovalModal Component
 *
 * Modal UI for reviewing and responding to permission approval requests
 */

"use client";

import { useState } from "react";
import type { ApprovalRequest } from "@/lib/permissions";

interface PermissionApprovalModalProps {
  approval: ApprovalRequest;
  onApprove: (approvalId: string) => Promise<void>;
  onDeny: (approvalId: string) => Promise<void>;
  onClose: () => void;
}

export default function PermissionApprovalModal({
  approval,
  onApprove,
  onDeny,
  onClose,
}: PermissionApprovalModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await onApprove(approval.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "승인 실패");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeny = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await onDeny(approval.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "거부 실패");
    } finally {
      setIsProcessing(false);
    }
  };

  const actionLabel: Record<string, string> = {
    read: "읽기",
    write: "쓰기",
    delete: "삭제",
    execute: "실행",
  };

  const timeRemaining = () => {
    const expires = new Date(approval.expiresAt);
    const now = new Date();
    const diff = expires.getTime() - now.getTime();

    if (diff <= 0) return "만료됨";

    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}분 ${seconds}초 남음`;
    }
    return `${seconds}초 남음`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl max-w-2xl w-full border border-gray-700 shadow-2xl">
        {/* Header */}
        <div className="border-b border-gray-700 px-6 py-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">🔐 권한 승인 요청</h2>
              <p className="text-sm text-gray-400 mt-1">
                에이전트가 민감한 작업을 수행하려고 합니다
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="닫기"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Agent & Gateway Info */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">에이전트:</span>
                <span className="ml-2 text-white font-medium">{approval.agentId}</span>
              </div>
              <div>
                <span className="text-gray-400">게이트웨이:</span>
                <span className="ml-2 text-white font-medium">{approval.gatewayId}</span>
              </div>
            </div>
          </div>

          {/* Operation Details */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">작업 유형</label>
              <div className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                <span className="text-lg font-bold text-yellow-400">
                  {actionLabel[approval.action] || approval.action}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">대상 경로</label>
              <div className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                <code className="text-white font-mono text-sm break-all">{approval.path}</code>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">사유</label>
              <div className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                <p className="text-white text-sm">{approval.reason}</p>
              </div>
            </div>
          </div>

          {/* Metadata (if exists) */}
          {approval.metadata && Object.keys(approval.metadata).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">추가 정보</label>
              <div className="bg-gray-900 rounded-lg px-4 py-3 border border-gray-700">
                <pre className="text-xs text-gray-300 font-mono overflow-x-auto">
                  {JSON.stringify(approval.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Time Remaining */}
          <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-blue-300">
                {timeRemaining()}
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-4 py-3">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Warning */}
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-4 py-3">
            <div className="flex gap-3">
              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-sm text-yellow-300">
                <p className="font-medium">승인하기 전에 확인하세요</p>
                <ul className="mt-2 space-y-1 list-disc list-inside text-yellow-300/80">
                  <li>작업이 의도한 것인지 확인</li>
                  <li>경로가 올바른지 검증</li>
                  <li>에이전트의 신뢰성 확인</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 px-6 py-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            취소
          </button>
          <button
            onClick={handleDeny}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "처리 중..." : "거부"}
          </button>
          <button
            onClick={handleApprove}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? "처리 중..." : "승인"}
          </button>
        </div>
      </div>
    </div>
  );
}
