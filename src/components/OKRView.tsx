"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useOKRSSE } from "@/hooks/useOKRSSE";

// ===== Objective Creation Modal =====

interface ObjectiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function ObjectiveModal({ isOpen, onClose, onCreated }: ObjectiveModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    period_type: "quarterly" as "quarterly" | "annual" | "custom",
    status: "active" as "active" | "completed" | "cancelled" | "archived",
    start_date: new Date().toISOString().split("T")[0],
    end_date: "",
    owner: "",
  });

  // Auto-set end_date based on period_type
  useEffect(() => {
    if (form.period_type === "quarterly") {
      const end = new Date(form.start_date);
      end.setMonth(end.getMonth() + 3);
      setForm((prev) => ({ ...prev, end_date: end.toISOString().split("T")[0] }));
    } else if (form.period_type === "annual") {
      const end = new Date(form.start_date);
      end.setFullYear(end.getFullYear() + 1);
      setForm((prev) => ({ ...prev, end_date: end.toISOString().split("T")[0] }));
    }
  }, [form.period_type, form.start_date]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/okr/objectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          period_type: form.period_type,
          status: form.status,
          start_date: form.start_date,
          end_date: form.end_date,
          owner: form.owner || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
      setForm({
        title: "",
        description: "",
        period_type: "quarterly",
        status: "active",
        start_date: new Date().toISOString().split("T")[0],
        end_date: "",
        owner: "",
      });
    } catch (err) {
      alert(`목표 생성 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative z-50 bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">새 목표 추가</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 overflow-y-auto max-h-[calc(90vh-140px)] space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                목표 제목 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="예: 올해 1분기 성장 목표"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">설명</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="목표에 대한 상세 설명"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm resize-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Period Type + Status */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">기간 유형</label>
                <select
                  value={form.period_type}
                  onChange={(e) => setForm((p) => ({ ...p, period_type: e.target.value as "quarterly" | "annual" | "custom" }))}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                >
                  <option value="quarterly">분기별</option>
                  <option value="annual">연간</option>
                  <option value="custom">커스텀</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">상태</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as "active" | "completed" | "cancelled" | "archived" }))}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                >
                  <option value="active">진행 중</option>
                  <option value="completed">완료</option>
                  <option value="cancelled">취소됨</option>
                  <option value="archived">보관됨</option>
                </select>
              </div>
            </div>

            {/* Start / End date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">시작일 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-sm [color-scheme:dark] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">종료일 <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  required
                  value={form.end_date}
                  onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-sm [color-scheme:dark] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>

            {/* Owner */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">담당자</label>
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm((p) => ({ ...p, owner: e.target.value }))}
                placeholder="예: hanchi"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.title.trim() || !form.start_date || !form.end_date}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "생성 중..." : "목표 생성"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== KeyResult Creation Modal =====

interface KeyResultModalProps {
  isOpen: boolean;
  objectiveId: string;
  onClose: () => void;
  onCreated: () => void;
}

function KeyResultModal({ isOpen, objectiveId, onClose, onCreated }: KeyResultModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    metric_type: "number" as "percentage" | "number" | "boolean" | "currency",
    target_value: "",
    current_value: "0",
    unit: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/okr/key-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective_id: objectiveId,
          title: form.title,
          description: form.description || undefined,
          metric_type: form.metric_type,
          target_value: Number(form.target_value),
          current_value: Number(form.current_value),
          unit: form.unit || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onCreated();
      onClose();
      setForm({ title: "", description: "", metric_type: "number", target_value: "", current_value: "0", unit: "" });
    } catch (err) {
      alert(`핵심결과 생성 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const metricPlaceholders: Record<string, string> = {
    percentage: "예: 80",
    number: "예: 1000",
    boolean: "1 (완료) 또는 0",
    currency: "예: 5000000",
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative z-50 bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">핵심결과 추가</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 overflow-y-auto max-h-[calc(90vh-140px)] space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                제목 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="예: 월간 활성 사용자 수"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">설명</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="측정 방법이나 기준 설명"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm resize-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Metric Type */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">측정 유형</label>
              <select
                value={form.metric_type}
                onChange={(e) => setForm((p) => ({ ...p, metric_type: e.target.value as "percentage" | "number" | "boolean" | "currency" }))}
                disabled={isSubmitting}
                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              >
                <option value="number">숫자</option>
                <option value="percentage">퍼센트 (%)</option>
                <option value="currency">금액 (원)</option>
                <option value="boolean">완료 여부</option>
              </select>
            </div>

            {/* Target / Current value */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">
                  목표값 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  value={form.target_value}
                  onChange={(e) => setForm((p) => ({ ...p, target_value: e.target.value }))}
                  placeholder={metricPlaceholders[form.metric_type]}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1.5">현재값</label>
                <input
                  type="number"
                  value={form.current_value}
                  onChange={(e) => setForm((p) => ({ ...p, current_value: e.target.value }))}
                  placeholder="0"
                  disabled={isSubmitting}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
                />
              </div>
            </div>

            {/* Unit */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">단위</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                placeholder="예: 명, 개, %, 원"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !form.title.trim() || !form.target_value}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "생성 중..." : "핵심결과 추가"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Types
export interface KeyResult {
  id: string;
  title: string;
  description?: string;
  currentValue: number;
  targetValue: number;
  unit: string;
  metricType: "percentage" | "number" | "boolean" | "currency";
  progress: number; // Auto-calculated: (current / target) * 100
  status: "active" | "completed" | "at_risk" | "off_track";
  weight?: number; // For weighted average in objective progress
}

export interface Objective {
  id: string;
  title: string;
  description?: string;
  periodType: "quarterly" | "annual" | "custom";
  startDate: string;
  endDate: string;
  status: "active" | "completed" | "cancelled" | "archived";
  owner?: string;
  tags?: string[];
  keyResults: KeyResult[];
  overallProgress: number; // Weighted average of key results
}

interface OKRViewProps {
  initialObjectives?: Objective[]; // Make optional as data will be fetched
  onObjectiveClick?: (objective: Objective) => void;
  onKeyResultUpdate?: (objectiveId: string, keyResultId: string, newValue: number) => void;
}

export default function OKRView({
  initialObjectives = [],
  onObjectiveClick,
  onKeyResultUpdate,
}: OKRViewProps) {
  const [objectives, setObjectives] = useState<Objective[]>(initialObjectives);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showObjectiveModal, setShowObjectiveModal] = useState(false);

  const fetchObjectives = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/okr/objectives");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transformedObjectives = data.objectives.map((obj: Record<string, any>) => ({
        id: obj.id,
        title: obj.title,
        description: obj.description,
        periodType: obj.period_type,
        startDate: obj.start_date,
        endDate: obj.end_date,
        status: obj.status,
        owner: obj.owner,
        tags: obj.tags,
        overallProgress: obj.overall_progress,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keyResults: obj.key_results.map((kr: Record<string, any>) => ({
          id: kr.id,
          title: kr.title,
          description: kr.description,
          currentValue: kr.current_value,
          targetValue: kr.target_value,
          unit: kr.unit,
          metricType: kr.metric_type,
          progress: kr.progress,
          status: kr.status,
          weight: kr.weight,
        })),
      }));
      setObjectives(transformedObjectives);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch objectives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialObjectives.length === 0) {
      fetchObjectives();
    } else {
      // If initial objectives are provided, use them and set loading to false
      setLoading(false);
    }
  }, [initialObjectives, fetchObjectives]);

  // Re-fetch when OKR SSE events arrive
  useOKRSSE({
    onObjectiveCreated: () => fetchObjectives(),
    onObjectiveUpdated: () => fetchObjectives(),
    onObjectiveDeleted: () => fetchObjectives(),
    onKeyResultCreated: () => fetchObjectives(),
    onKeyResultUpdated: () => fetchObjectives(),
    onKeyResultDeleted: () => fetchObjectives(),
  });
  const [expandedObjectives, setExpandedObjectives] = useState<Set<string>>(
    new Set()
  );

  const toggleObjective = (id: string) => {
    setExpandedObjectives((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const activeObjectives = useMemo(
    () => objectives.filter((obj) => obj.status === "active"),
    [objectives]
  );

    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 lg:py-12 text-center text-white">
          <svg
            className="animate-spin -ml-1 mr-3 h-8 w-8 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="mt-4 text-lg">OKR 불러오는 중...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center py-16 lg:py-12 text-center text-red-400">
          <span className="text-4xl mb-4">🚨</span>
          <h3 className="text-lg font-semibold mb-2">오류 발생</h3>
          <p className="text-sm">{error}</p>
          <p className="text-sm mt-2">OKR을 불러오는데 실패했습니다. 나중에 다시 시도해주세요.</p>
        </div>
      );
    }

    if (objectives.length === 0) {
    return (
      <>
        <ObjectiveModal
          isOpen={showObjectiveModal}
          onClose={() => setShowObjectiveModal(false)}
          onCreated={fetchObjectives}
        />
        <div className="flex flex-col items-center justify-center py-16 lg:py-12 text-center">
          <div className="w-16 h-16 lg:w-12 lg:h-12 flex items-center justify-center bg-gray-800 rounded-full mb-4">
            <span className="text-3xl lg:text-2xl">🎯</span>
          </div>
          <h3 className="text-lg lg:text-base font-semibold text-white mb-2">
            OKR이 없습니다
          </h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm">
            목표(Objective)와 핵심 결과(Key Results)를 설정하여 진행 상황을 추적하세요.
          </p>
          <button
            onClick={() => setShowObjectiveModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            목표 추가
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ObjectiveModal
        isOpen={showObjectiveModal}
        onClose={() => setShowObjectiveModal(false)}
        onCreated={fetchObjectives}
      />
    <div className="space-y-4 lg:space-y-3">
      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => setShowObjectiveModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          목표 추가
        </button>
      </div>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="활성 목표"
          value={activeObjectives.length}
          icon="🎯"
          color="blue"
        />
        <SummaryCard
          label="전체 진행률"
          value={`${calculateAverageProgress(activeObjectives)}%`}
          icon="📊"
          color="green"
        />
        <SummaryCard
          label="위험 상태"
          value={countAtRiskKeyResults(activeObjectives)}
          icon="⚠️"
          color="yellow"
        />
      </div>

      {/* Objectives List */}
      <div className="space-y-3">
        {objectives.map((objective) => (
          <ObjectiveCard
            key={objective.id}
            objective={objective}
            isExpanded={expandedObjectives.has(objective.id)}
            onToggle={() => toggleObjective(objective.id)}
            onClick={() => onObjectiveClick?.(objective)}
            onKeyResultUpdate={onKeyResultUpdate}
            onKeyResultAdded={fetchObjectives}
          />
        ))}
      </div>
    </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: "blue" | "green" | "yellow" | "red";
}) {
  const colorClasses = {
    blue: "border-blue-600/20 bg-blue-600/5",
    green: "border-green-600/20 bg-green-600/5",
    yellow: "border-yellow-600/20 bg-yellow-600/5",
    red: "border-red-600/20 bg-red-600/5",
  };

  return (
    <div
      className={`
      bg-gray-800 rounded-xl p-4 lg:p-3
      border ${colorClasses[color]}
    `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">{label}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="text-2xl lg:text-xl font-extrabold text-white">
        {value}
      </div>
    </div>
  );
}

function ObjectiveCard({
  objective,
  isExpanded,
  onToggle,
  onClick: _onClick,
  onKeyResultUpdate,
  onKeyResultAdded,
}: {
  objective: Objective;
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  onKeyResultUpdate?: (objectiveId: string, keyResultId: string, newValue: number) => void;
  onKeyResultAdded?: () => void;
}) {
  const [showKRModal, setShowKRModal] = useState(false);

  const statusColors = {
    active: "bg-green-500/10 border-green-500/20 text-green-500",
    completed: "bg-blue-500/10 border-blue-500/20 text-blue-500",
    cancelled: "bg-gray-500/10 border-gray-500/20 text-gray-500",
    archived: "bg-gray-600/10 border-gray-600/20 text-gray-600",
  };

  const daysRemaining = useMemo(() => {
    const end = new Date(objective.endDate);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  }, [objective.endDate]);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-5 py-4 lg:px-4 lg:py-3 text-left hover:bg-gray-750 transition-colors duration-150"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg lg:text-base font-bold text-white truncate">
                {objective.title}
              </h3>
              <span
                className={`
                  px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap
                  ${statusColors[objective.status]}
                `}
              >
                {objective.status === "active" && "진행 중"}
                {objective.status === "completed" && "완료"}
                {objective.status === "cancelled" && "취소됨"}
                {objective.status === "archived" && "보관됨"}
              </span>
            </div>

            {objective.description && (
              <p className="text-sm text-gray-400 mb-2 line-clamp-2">
                {objective.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>
                {objective.periodType === "quarterly" && "분기별"}
                {objective.periodType === "annual" && "연간"}
                {objective.periodType === "custom" && "커스텀"}
              </span>
              {objective.owner && <span>담당: {objective.owner}</span>}
              <span>
                {daysRemaining > 0
                  ? `${daysRemaining}일 남음`
                  : daysRemaining === 0
                    ? "오늘 마감"
                    : `${Math.abs(daysRemaining)}일 초과`}
              </span>
            </div>

            {objective.tags && objective.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {objective.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl lg:text-xl font-extrabold text-white">
                {objective.overallProgress}%
              </div>
              <div className="text-xs text-gray-400">전체 진행률</div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>

        {/* Overall Progress Bar */}
        <div className="mt-3 w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className={`
              h-2 rounded-full transition-all duration-500 ease-out
              ${objective.overallProgress >= 100 ? "bg-green-500" : objective.overallProgress >= 75 ? "bg-blue-600" : objective.overallProgress >= 50 ? "bg-yellow-500" : "bg-red-500"}
            `}
            style={{ width: `${objective.overallProgress}%` }}
          />
        </div>
      </button>

      {/* Key Results (Expanded) */}
      {isExpanded && (
        <div className="border-t border-gray-700 bg-gray-850">
          <KeyResultModal
            isOpen={showKRModal}
            objectiveId={objective.id}
            onClose={() => setShowKRModal(false)}
            onCreated={() => { onKeyResultAdded?.(); }}
          />
          <div className="px-5 py-4 lg:px-4 lg:py-3 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                핵심 결과 ({objective.keyResults.length})
              </h4>
              <button
                onClick={(e) => { e.stopPropagation(); setShowKRModal(true); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                핵심결과 추가
              </button>
            </div>

            {objective.keyResults.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-6">
                핵심 결과가 없습니다
              </div>
            ) : (
              <div className="space-y-3">
                {objective.keyResults.map((kr) => (
                  <KeyResultCard
                    key={kr.id}
                    keyResult={kr}
                    objectiveId={objective.id}
                    onUpdate={onKeyResultUpdate}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KeyResultCard({
  keyResult,
  objectiveId,
  onUpdate,
}: {
  keyResult: KeyResult;
  objectiveId: string;
  onUpdate?: (objectiveId: string, keyResultId: string, newValue: number) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(keyResult.currentValue);

  const statusColors = {
    active: "text-blue-400",
    completed: "text-green-400",
    at_risk: "text-yellow-400",
    off_track: "text-red-400",
  };

  const formattedCurrent = useMemo(() => {
    if (keyResult.metricType === "percentage") return `${keyResult.currentValue}%`;
    if (keyResult.metricType === "currency")
      return new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
        notation: "compact",
      }).format(keyResult.currentValue);
    if (keyResult.metricType === "boolean") return keyResult.currentValue ? "완료" : "미완료";
    return new Intl.NumberFormat("ko-KR").format(keyResult.currentValue);
  }, [keyResult.currentValue, keyResult.metricType]);

  const formattedTarget = useMemo(() => {
    if (keyResult.metricType === "percentage") return `${keyResult.targetValue}%`;
    if (keyResult.metricType === "currency")
      return new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
        notation: "compact",
      }).format(keyResult.targetValue);
    if (keyResult.metricType === "boolean") return "완료";
    return new Intl.NumberFormat("ko-KR").format(keyResult.targetValue);
  }, [keyResult.targetValue, keyResult.metricType]);

  const handleUpdate = () => {
    if (onUpdate && tempValue !== keyResult.currentValue) {
      onUpdate(objectiveId, keyResult.id, tempValue);
    }
    setIsEditing(false);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 lg:p-3 border border-gray-700">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h5 className="text-sm lg:text-xs font-semibold text-white mb-1">
            {keyResult.title}
          </h5>
          {keyResult.description && (
            <p className="text-xs text-gray-400 line-clamp-2">
              {keyResult.description}
            </p>
          )}
        </div>
        <span className={`text-xs font-medium ${statusColors[keyResult.status]}`}>
          {keyResult.status === "active" && "진행 중"}
          {keyResult.status === "completed" && "완료"}
          {keyResult.status === "at_risk" && "위험"}
          {keyResult.status === "off_track" && "이탈"}
        </span>
      </div>

      {/* Current / Target */}
      <div className="flex items-end justify-between mb-2">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={tempValue}
              onChange={(e) => setTempValue(Number(e.target.value))}
              className="w-24 px-2 py-1 bg-gray-900 border border-gray-700 text-white text-sm rounded focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUpdate();
                if (e.key === "Escape") {
                  setTempValue(keyResult.currentValue);
                  setIsEditing(false);
                }
              }}
            />
            <button
              onClick={handleUpdate}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
            >
              저장
            </button>
            <button
              onClick={() => {
                setTempValue(keyResult.currentValue);
                setIsEditing(false);
              }}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded transition-colors"
            >
              취소
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 hover:text-blue-400 transition-colors"
          >
            <span className="text-xl lg:text-lg font-extrabold text-white">
              {formattedCurrent}
            </span>
            <span className="text-xs text-gray-400">/ {formattedTarget}</span>
          </button>
        )}
        <span className="text-sm lg:text-xs text-gray-400">{keyResult.unit}</span>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`
            h-1.5 rounded-full transition-all duration-500 ease-out
            ${keyResult.progress >= 100 ? "bg-green-500" : keyResult.progress >= 75 ? "bg-blue-600" : keyResult.progress >= 50 ? "bg-yellow-500" : "bg-red-500"}
          `}
          style={{ width: `${Math.min(100, keyResult.progress)}%` }}
        />
      </div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs text-gray-500">진행률</span>
        <span className="text-xs font-medium text-white">
          {keyResult.progress.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// Utility functions
function calculateAverageProgress(objectives: Objective[]): number {
  if (objectives.length === 0) return 0;
  const total = objectives.reduce((sum, obj) => sum + obj.overallProgress, 0);
  return Math.round(total / objectives.length);
}

function countAtRiskKeyResults(objectives: Objective[]): number {
  return objectives.reduce((count, obj) => {
    return (
      count +
      obj.keyResults.filter((kr) => kr.status === "at_risk" || kr.status === "off_track")
        .length
    );
  }, 0);
}

