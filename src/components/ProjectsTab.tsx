"use client";

import { useState, useCallback } from "react";
import type { Project } from "@/hooks/useDashboardData";
import ProjectModal, { type ProjectFormData } from "./ProjectModal";
import KPIDashboard, { type KPIMetric, generateSampleKPIs } from "./KPIDashboard";
import OKRView, { type Objective, generateSampleOKRs } from "./OKRView";

interface ProjectsTabProps {
  projects: Project[];
  isLoading: boolean;
  onRefresh: () => void;
}

type ViewMode = "grid" | "kpi" | "okr";

export default function ProjectsTab({
  projects,
  isLoading,
  onRefresh,
}: ProjectsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Mock data for KPI and OKR (replace with real API calls)
  const [kpiMetrics] = useState<KPIMetric[]>(generateSampleKPIs());
  const [objectives] = useState<Objective[]>(generateSampleOKRs());

  const handleCreateProject = useCallback(async (data: ProjectFormData) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "프로젝트 생성 실패");
      }

      onRefresh();
    } catch (error) {
      console.error("Failed to create project:", error);
      throw error;
    }
  }, [onRefresh]);

  const handleUpdateProject = useCallback(
    async (data: ProjectFormData) => {
      if (!editingProject) return;

      try {
        const response = await fetch(`/api/projects/${editingProject.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "프로젝트 수정 실패");
        }

        onRefresh();
        setEditingProject(null);
      } catch (error) {
        console.error("Failed to update project:", error);
        throw error;
      }
    },
    [editingProject, onRefresh]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (!confirm("정말로 이 프로젝트를 삭제하시겠습니까?")) return;

      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "프로젝트 삭제 실패");
        }

        onRefresh();
      } catch (error) {
        console.error("Failed to delete project:", error);
        alert(
          `프로젝트 삭제 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
        );
      }
    },
    [onRefresh]
  );

  const openCreateModal = () => {
    setEditingProject(null);
    setIsModalOpen(true);
  };

  const openEditModal = (project: Project) => {
    setEditingProject(project);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingProject(null);
  };

  return (
    <div className="space-y-6 lg:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl lg:text-xl font-bold text-white mb-1">
            프로젝트 관리
          </h2>
          <p className="text-sm text-gray-400">
            {projects.length}개의 프로젝트가 진행 중입니다
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex bg-gray-800 rounded-lg border border-gray-700 p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`
                px-3 py-1.5 lg:px-2 lg:py-1
                text-xs font-medium rounded
                transition-colors duration-150
                ${viewMode === "grid" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}
              `}
            >
              그리드
            </button>
            <button
              onClick={() => setViewMode("kpi")}
              className={`
                px-3 py-1.5 lg:px-2 lg:py-1
                text-xs font-medium rounded
                transition-colors duration-150
                ${viewMode === "kpi" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}
              `}
            >
              KPI
            </button>
            <button
              onClick={() => setViewMode("okr")}
              className={`
                px-3 py-1.5 lg:px-2 lg:py-1
                text-xs font-medium rounded
                transition-colors duration-150
                ${viewMode === "okr" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}
              `}
            >
              OKR
            </button>
          </div>

          <button
            onClick={openCreateModal}
            className="
              px-4 py-2.5 lg:px-3 lg:py-2
              bg-blue-600 hover:bg-blue-700 active:bg-blue-800
              text-white font-medium text-sm
              rounded-lg
              transition-colors duration-150
              focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
              min-h-[44px] lg:min-h-0
              whitespace-nowrap
            "
          >
            + 프로젝트 생성
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center text-gray-400 py-12">
          <div className="inline-block w-8 h-8 border-4 border-gray-700 border-t-blue-600 rounded-full animate-spin mb-4" />
          <p>프로젝트 로딩 중...</p>
        </div>
      ) : viewMode === "grid" ? (
        projects.length === 0 ? (
          <EmptyState onCreateClick={openCreateModal} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={() => openEditModal(project)}
                onDelete={() => handleDeleteProject(project.id)}
                onClick={() => setSelectedProject(project)}
              />
            ))}
          </div>
        )
      ) : viewMode === "kpi" ? (
        <KPIDashboard metrics={kpiMetrics} columns={3} />
      ) : (
        <OKRView
          objectives={objectives}
          onObjectiveClick={(obj) => console.log("Objective clicked:", obj)}
          onKeyResultUpdate={(objId, krId, value) =>
            console.log("Key result updated:", objId, krId, value)
          }
        />
      )}

      {/* Modal */}
      <ProjectModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSubmit={editingProject ? handleUpdateProject : handleCreateProject}
        project={editingProject}
      />
    </div>
  );
}

function ProjectCard({
  project,
  onEdit,
  onDelete,
  onClick,
}: {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const statusColors = {
    active: "bg-green-500/10 border-green-500/20 text-green-500",
    paused: "bg-yellow-500/10 border-yellow-500/20 text-yellow-500",
    completed: "bg-blue-500/10 border-blue-500/20 text-blue-500",
    archived: "bg-gray-500/10 border-gray-500/20 text-gray-500",
  };

  const statusLabels = {
    active: "진행 중",
    paused: "일시 중지",
    completed: "완료",
    archived: "보관됨",
  };

  return (
    <div className="bg-gray-800 rounded-xl p-5 lg:p-3.5 border border-gray-700 hover:bg-gray-750 hover:border-gray-600 transition-all duration-150 relative group">
      {/* Menu Button */}
      <div className="absolute top-4 right-4 lg:top-3 lg:right-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="
            w-8 h-8
            flex items-center justify-center
            text-gray-400 hover:text-white
            rounded-lg hover:bg-gray-700
            transition-colors duration-150
            opacity-0 group-hover:opacity-100
            focus:opacity-100
          "
          aria-label="메뉴"
        >
          <svg
            className="w-5 h-5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute top-full right-0 mt-1 w-36 bg-gray-850 border border-gray-700 rounded-lg shadow-xl z-10">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onEdit();
              }}
              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-800 rounded-t-lg transition-colors"
            >
              수정
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete();
              }}
              className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-800 rounded-b-lg transition-colors"
            >
              삭제
            </button>
          </div>
        )}
      </div>

      <button
        onClick={onClick}
        className="w-full text-left focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded-lg"
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-3 lg:mb-2 pr-8">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg lg:text-base font-bold text-white truncate mb-1">
              {project.name}
            </h2>
            <p className="text-gray-400 text-xs line-clamp-2">
              {project.description}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <span
          className={`
            inline-flex items-center gap-1.5
            px-2.5 py-1 lg:px-2 lg:py-0.5
            text-xs font-medium rounded-full
            mb-3 lg:mb-2
            ${statusColors[project.status as keyof typeof statusColors] || statusColors.active}
          `}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {statusLabels[project.status as keyof typeof statusLabels] || project.status}
        </span>

        {/* Progress */}
        <div className="mb-3 lg:mb-2">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>진행률</span>
            <span className="font-medium text-white">{project.progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>

        {/* KPIs */}
        {project.kpis && project.kpis.length > 0 && (
          <div className="space-y-1 lg:space-y-0.5">
            {project.kpis.slice(0, 3).map((kpi, i) => (
              <div key={i} className="flex justify-between text-sm lg:text-xs">
                <span className="text-gray-400">{kpi.label}</span>
                <span className="text-white font-medium">{kpi.value}</span>
              </div>
            ))}
            {project.kpis.length > 3 && (
              <div className="text-xs text-gray-500 text-center pt-1">
                +{project.kpis.length - 3}개 더보기
              </div>
            )}
          </div>
        )}

        {/* Link */}
        {project.url && (
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="
              mt-3 lg:mt-2
              flex items-center justify-center gap-2
              text-sm lg:text-xs
              text-blue-400
              hover:text-blue-300
              transition-colors duration-150
              py-2
            "
          >
            방문하기
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        )}
      </button>
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 lg:py-12 text-center">
      <div className="w-16 h-16 lg:w-12 lg:h-12 flex items-center justify-center bg-gray-800 rounded-full mb-4">
        <span className="text-3xl lg:text-2xl">🚀</span>
      </div>
      <h3 className="text-lg lg:text-base font-semibold text-white mb-2">
        프로젝트가 없습니다
      </h3>
      <p className="text-sm text-gray-400 mb-6 max-w-sm">
        첫 번째 프로젝트를 생성하여 목표를 추적하고 관리하세요.
      </p>
      <button
        onClick={onCreateClick}
        className="
          px-5 py-2.5
          bg-blue-600 hover:bg-blue-700 active:bg-blue-800
          text-white font-medium text-sm
          rounded-lg
          transition-colors duration-150
          focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none
        "
      >
        + 첫 프로젝트 만들기
      </button>
    </div>
  );
}
