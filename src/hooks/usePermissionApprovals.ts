/**
 * usePermissionApprovals Hook
 *
 * React hook for managing permission approval requests
 */

import { useState, useEffect, useCallback } from "react";
import { useSSE } from "./useSSE";
import type { ApprovalRequest } from "@/lib/permissions";

export interface UsePermissionApprovalsOptions {
  pollInterval?: number;
  autoFetch?: boolean;
}

export function usePermissionApprovals(
  options: UsePermissionApprovalsOptions = {}
) {
  const { pollInterval = 5000, autoFetch = true } = options;

  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch pending approvals
  const fetchPendingApprovals = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/permissions/approvals?mode=pending");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setPendingApprovals(data.approvals || []);
    } catch (err) {
      console.error("[usePermissionApprovals] Failed to fetch pending approvals:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch approvals");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Approve a request
  const approveRequest = useCallback(async (approvalId: string) => {
    try {
      const response = await fetch(`/api/permissions/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Remove from pending list
      setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));

      return data.approval;
    } catch (err) {
      console.error("[usePermissionApprovals] Failed to approve request:", err);
      throw err;
    }
  }, []);

  // Deny a request
  const denyRequest = useCallback(async (approvalId: string) => {
    try {
      const response = await fetch(`/api/permissions/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "denied" }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Remove from pending list
      setPendingApprovals((prev) => prev.filter((a) => a.id !== approvalId));

      return data.approval;
    } catch (err) {
      console.error("[usePermissionApprovals] Failed to deny request:", err);
      throw err;
    }
  }, []);

  // Listen to SSE events for new approvals
  useSSE({
    onEvent: (event) => {
      if (event.type === "permission:approval:created") {
        // New approval request created
        fetchPendingApprovals();
      } else if (
        event.type === "permission:approval:updated" ||
        event.type === "permission:approval:responded"
      ) {
        // Approval status changed
        fetchPendingApprovals();
      }
    },
  });

  // Auto-fetch on mount and poll periodically
  useEffect(() => {
    if (!autoFetch) return;

    fetchPendingApprovals();

    if (pollInterval > 0) {
      const interval = setInterval(fetchPendingApprovals, pollInterval);
      return () => clearInterval(interval);
    }
  }, [autoFetch, pollInterval, fetchPendingApprovals]);

  return {
    pendingApprovals,
    isLoading,
    error,
    fetchPendingApprovals,
    approveRequest,
    denyRequest,
    hasPendingApprovals: pendingApprovals.length > 0,
    pendingCount: pendingApprovals.length,
  };
}
