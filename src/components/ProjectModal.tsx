"use client";

import { useState, useEffect } from "react";
import type { Project } from "@/hooks/useDashboardData";

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ProjectFormData) => Promise<void>;
  project?: Project | null; // null = create, Project = edit
}

export interface ProjectFormData {
  name: string;
  description: string;
  status: string;
  progress: number;
  url: string;
  kpis: Array<{ label: string; value: string }>;
}

export default function ProjectModal({
  isOpen,
  onClose,
  onSubmit,
  project,
}: ProjectModalProps) {
  const isEdit = !!project;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<ProjectFormData>({
    name: "",
    description: "",
    status: "active",
    progress: 0,
    url: "",
    kpis: [],
  });

  // Initialize form data when project changes
  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name,
        description: project.description,
        status: project.status,
        progress: project.progress,
        url: project.url || "",
        kpis: project.kpis || [],
      });
    } else {
      setFormData({
        name: "",
        description: "",
        status: "active",
        progress: 0,
        url: "",
        kpis: [],
      });
    }
  }, [project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      console.error("Failed to submit:", error);
      alert(
        `프로젝트 ${isEdit ? "수정" : "생성"} 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddKPI = () => {
    setFormData((prev) => ({
      ...prev,
      kpis: [...prev.kpis, { label: "", value: "" }],
    }));
  };

  const handleRemoveKPI = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      kpis: prev.kpis.filter((_, i) => i !== index),
    }));
  };

  const handleKPIChange = (
    index: number,
    field: "label" | "value",
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      kpis: prev.kpis.map((kpi, i) =>
        i === index ? { ...kpi, [field]: value } : kpi
      ),
    }));
  };

  if (!isOpen) return null;

  return (
    <div
      className="
        fixed inset-0 z-40
        bg-black/60 backdrop-blur-sm
        flex items-center justify-center
        p-4
        animate-in fade-in duration-150
      "
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal */}
      <div
        className="
          relative z-50
          bg-gray-850
          rounded-2xl
          border border-gray-700
          shadow-2xl
          w-full max-w-2xl
          max-h-[90vh]
          overflow-hidden
          animate-in zoom-in-95 duration-150
        "
      >
        {/* Header */}
        <div
          className="
            flex items-center justify-between
            px-6 py-4 lg:px-5 lg:py-3
            border-b border-gray-700
          "
        >
          <h2 className="text-xl lg:text-lg font-bold text-white">
            {isEdit ? "프로젝트 수정" : "새 프로젝트 생성"}
          </h2>
          <button
            onClick={onClose}
            className="
              w-8 h-8
              flex items-center justify-center
              text-gray-400 hover:text-white
              rounded-lg hover:bg-gray-800
              transition-colors duration-150
              focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
            "
            aria-label="닫기"
            disabled={isSubmitting}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 lg:px-5 lg:py-4 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="space-y-5 lg:space-y-4">
              {/* Project Name */}
              <div>
                <label
                  htmlFor="project-name"
                  className="block text-sm font-medium text-gray-400 mb-2"
                >
                  프로젝트 이름 <span className="text-red-500">*</span>
                </label>
                <input
                  id="project-name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="
                    w-full
                    px-4 py-2.5 lg:px-3 lg:py-2
                    bg-gray-900
                    border border-gray-700
                    text-white placeholder-gray-500
                    rounded-lg
                    text-base lg:text-sm
                    transition-colors duration-150
                    focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
                    disabled:opacity-50 disabled:cursor-not-allowed
                    min-h-[44px] lg:min-h-0
                  "
                  placeholder="예: Life Dashboard"
                  disabled={isSubmitting}
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="project-description"
                  className="block text-sm font-medium text-gray-400 mb-2"
                >
                  설명
                </label>
                <textarea
                  id="project-description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                  className="
                    w-full
                    px-4 py-3 lg:px-3 lg:py-2
                    bg-gray-900
                    border border-gray-700
                    text-white placeholder-gray-500
                    rounded-lg
                    text-base lg:text-sm
                    resize-none
                    transition-colors duration-150
                    focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
                    disabled:opacity-50
                  "
                  placeholder="프로젝트에 대한 간단한 설명을 입력하세요"
                  disabled={isSubmitting}
                />
              </div>

              {/* Status & Progress */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Status */}
                <div>
                  <label
                    htmlFor="project-status"
                    className="block text-sm font-medium text-gray-400 mb-2"
                  >
                    상태
                  </label>
                  <select
                    id="project-status"
                    value={formData.status}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: e.target.value,
                      }))
                    }
                    className="
                      w-full
                      px-4 py-2.5 lg:px-3 lg:py-2
                      bg-gray-900
                      border border-gray-700
                      text-white
                      rounded-lg
                      text-base lg:text-sm
                      transition-colors duration-150
                      focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
                      min-h-[44px] lg:min-h-0
                    "
                    disabled={isSubmitting}
                  >
                    <option value="active">진행 중</option>
                    <option value="paused">일시 중지</option>
                    <option value="completed">완료</option>
                    <option value="archived">보관됨</option>
                  </select>
                </div>

                {/* Progress */}
                <div>
                  <label
                    htmlFor="project-progress"
                    className="block text-sm font-medium text-gray-400 mb-2"
                  >
                    진행률: {formData.progress}%
                  </label>
                  <input
                    id="project-progress"
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={formData.progress}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        progress: Number(e.target.value),
                      }))
                    }
                    className="
                      w-full
                      h-2
                      bg-gray-700
                      rounded-full
                      appearance-none
                      cursor-pointer
                      accent-blue-600
                      disabled:opacity-50
                    "
                    disabled={isSubmitting}
                  />
                  <div className="mt-2 w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${formData.progress}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* URL */}
              <div>
                <label
                  htmlFor="project-url"
                  className="block text-sm font-medium text-gray-400 mb-2"
                >
                  URL
                </label>
                <input
                  id="project-url"
                  type="url"
                  value={formData.url}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, url: e.target.value }))
                  }
                  className="
                    w-full
                    px-4 py-2.5 lg:px-3 lg:py-2
                    bg-gray-900
                    border border-gray-700
                    text-white placeholder-gray-500
                    rounded-lg
                    text-base lg:text-sm
                    transition-colors duration-150
                    focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 focus:outline-none
                    disabled:opacity-50
                    min-h-[44px] lg:min-h-0
                  "
                  placeholder="https://example.com"
                  disabled={isSubmitting}
                />
              </div>

              {/* KPIs */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-400">
                    KPI 지표
                  </label>
                  <button
                    type="button"
                    onClick={handleAddKPI}
                    disabled={isSubmitting}
                    className="
                      text-sm text-blue-400 hover:text-blue-300
                      font-medium
                      transition-colors duration-150
                      focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
                      rounded
                      disabled:opacity-50
                    "
                  >
                    + 지표 추가
                  </button>
                </div>

                {formData.kpis.length === 0 ? (
                  <div className="text-sm text-gray-500 text-center py-4 bg-gray-900/50 rounded-lg border border-dashed border-gray-700">
                    추가된 KPI 지표가 없습니다
                  </div>
                ) : (
                  <div className="space-y-3">
                    {formData.kpis.map((kpi, index) => (
                      <div
                        key={index}
                        className="flex gap-2 items-start bg-gray-900/50 p-3 rounded-lg border border-gray-700"
                      >
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={kpi.label}
                            onChange={(e) =>
                              handleKPIChange(index, "label", e.target.value)
                            }
                            placeholder="라벨 (예: 월 사용자)"
                            className="
                              w-full
                              px-3 py-2
                              bg-gray-900
                              border border-gray-700
                              text-white placeholder-gray-500
                              rounded-lg
                              text-sm
                              transition-colors duration-150
                              focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none
                            "
                            disabled={isSubmitting}
                          />
                          <input
                            type="text"
                            value={kpi.value}
                            onChange={(e) =>
                              handleKPIChange(index, "value", e.target.value)
                            }
                            placeholder="값 (예: 1,234명)"
                            className="
                              w-full
                              px-3 py-2
                              bg-gray-900
                              border border-gray-700
                              text-white placeholder-gray-500
                              rounded-lg
                              text-sm
                              transition-colors duration-150
                              focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none
                            "
                            disabled={isSubmitting}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveKPI(index)}
                          disabled={isSubmitting}
                          className="
                            w-8 h-8
                            flex items-center justify-center
                            text-gray-400 hover:text-red-400
                            rounded-lg hover:bg-red-500/10
                            transition-colors duration-150
                            focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none
                            disabled:opacity-50
                          "
                          aria-label="KPI 제거"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="
              flex items-center justify-end gap-3
              px-6 py-4 lg:px-5 lg:py-3
              border-t border-gray-700
            "
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="
                px-4 py-2.5 lg:px-3 lg:py-2
                bg-gray-800 hover:bg-gray-700 active:bg-gray-750
                text-white font-medium text-sm
                border border-gray-700
                rounded-lg
                transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none
                disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[44px] lg:min-h-0
              "
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.name.trim()}
              className="
                px-4 py-2.5 lg:px-3 lg:py-2
                bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                text-white font-medium text-sm
                rounded-lg
                transition-colors duration-150
                focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
                focus-visible:ring-offset-gray-850 focus-visible:outline-none
                disabled:opacity-50 disabled:cursor-not-allowed
                min-h-[44px] lg:min-h-0
              "
            >
              {isSubmitting
                ? "처리 중..."
                : isEdit
                  ? "수정하기"
                  : "생성하기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
