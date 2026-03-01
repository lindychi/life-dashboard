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

const SSE_CONNECTED_POLL_INTERVAL = 30000; // 30 s when SSE is active

export function usePermissionApprovals(
  options: UsePermissionApprovalsOptions = {}
) {
  const { pollInterval = 5000, autoFetch = true } = options;

  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

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

  // Listen to SSE events for new approvals; track connection state to adjust poll interval
  useSSE({
    onConnect: () => setSseConnected(true),
    onDisconnect: () => setSseConnected(false),
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

  // Auto-fetch on mount and poll periodically.
  // When SSE is connected, fall back to a 30 s interval (SSE handles real-time updates).
  // When SSE is disconnected, poll at the shorter configured interval.
  useEffect(() => {
    if (!autoFetch) return;

    fetchPendingApprovals();

    const effectiveInterval = sseConnected ? SSE_CONNECTED_POLL_INTERVAL : pollInterval;
    if (effectiveInterval > 0) {
      const interval = setInterval(fetchPendingApprovals, effectiveInterval);
      return () => clearInterval(interval);
    }
  }, [autoFetch, pollInterval, sseConnected, fetchPendingApprovals]);

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
