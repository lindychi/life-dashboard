// 요청 그룹 관리 유틸리티

import type { HistoryEntry } from "./history";

export interface RequestGroup {
  requestGroupId: string;
  requestTitle: string;
  entries: HistoryEntry[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
  };
  startedAt: string;
  lastActivityAt: string;
}

/**
 * 새로운 요청 그룹 ID 생성
 */
export function createRequestGroupId(): string {
  return crypto.randomUUID();
}

/**
 * 태스크/커맨드 내용에서 간결한 한글 요약 제목 생성 (최대 50자)
 *
 * 키워드 매칭 기반 패턴 인식:
 * - 공통 작업 패턴 감지 (리팩토링, 인증, API, 테스트, 배포, 버그 수정, 빌드, DB, UI, 설정)
 * - 여러 패턴 매칭 시 상위 2개를 조합
 * - 패턴 미매칭 시 원본 내용을 50자로 축약
 */
export function generateRequestTitle(content: string): string {
  // 마크다운, 코드 블록, 과도한 공백 제거
  const cleaned = content
    .replace(/```[\s\S]*?```/g, "") // 코드 블록 제거
    .replace(/`[^`]+`/g, "") // 인라인 코드 제거
    .replace(/[*_~]/g, "") // 마크다운 포맷 제거
    .replace(/\s+/g, " ") // 연속 공백 제거
    .trim();

  const lower = cleaned.toLowerCase();

  // 패턴 매칭 (우선순위 순)
  const patterns: Array<{ keywords: string[]; title: string }> = [
    { keywords: ["refactor", "리팩토링", "리팩터링"], title: "리팩토링" },
    { keywords: ["auth", "인증", "로그인", "login"], title: "인증 시스템" },
    { keywords: ["api", "endpoint", "엔드포인트"], title: "API" },
    { keywords: ["test", "테스트", "testing"], title: "테스트" },
    { keywords: ["deploy", "배포", "deployment"], title: "배포" },
    { keywords: ["fix", "bug", "수정", "버그"], title: "버그 수정" },
    { keywords: ["build", "빌드"], title: "빌드" },
    { keywords: ["database", "db", "migration", "데이터베이스", "마이그레이션"], title: "DB 작업" },
    { keywords: ["ui", "frontend", "컴포넌트", "component"], title: "UI 작업" },
    { keywords: ["config", "설정", "configuration"], title: "설정 변경" },
  ];

  const matched: string[] = [];

  for (const pattern of patterns) {
    if (pattern.keywords.some((keyword) => lower.includes(keyword))) {
      matched.push(pattern.title);
      if (matched.length >= 2) break; // 최대 2개 조합
    }
  }

  if (matched.length > 0) {
    return matched.join(" + ");
  }

  // 패턴 미매칭 시 원본 내용 축약
  if (cleaned.length <= 50) {
    return cleaned;
  }

  // 50자로 자르되, 단어 경계에서 자르기
  const truncated = cleaned.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > 30) {
    // 30자 이상 위치에서 공백이 있으면 거기서 자름
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated + "...";
}
