// Agent 설정 관리 (In-memory store, Railway 재시작 시 초기화됨)
import agentsConfig from "../../agents.json";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  emoji: string;
  category: "dev" | "business" | "ops";
  systemPrompt: string;
  enabled: boolean;
  allowBash?: boolean; // Bash 도구 사용 허용 여부 (기본값: false)
  defaultModel?: "haiku" | "sonnet" | "opus"; // 기본 모델 (smart routing용)
  projects?: string[];
}

// In-memory store (agents.json에서 초기화, 런타임에 수정 가능)
const agents: AgentConfig[] = [...(agentsConfig as AgentConfig[])];

/**
 * 활성화된 에이전트 목록 반환
 */
export function getAgents(): AgentConfig[] {
  return agents.filter((a) => a.enabled);
}

/**
 * 모든 에이전트 반환 (비활성화 포함)
 */
export function getAllAgents(): AgentConfig[] {
  return [...agents];
}

/**
 * ID로 에이전트 조회
 */
export function getAgent(id: string): AgentConfig | undefined {
  return agents.find((a) => a.id === id);
}

/**
 * 카테고리별 에이전트 조회 (활성화된 것만)
 */
export function getAgentsByCategory(
  category: AgentConfig["category"]
): AgentConfig[] {
  return agents.filter((a) => a.enabled && a.category === category);
}

/**
 * 새 에이전트 추가
 */
export function addAgent(agent: AgentConfig): AgentConfig {
  // ID 중복 체크
  if (agents.some((a) => a.id === agent.id)) {
    throw new Error(`Agent with id "${agent.id}" already exists`);
  }

  agents.push(agent);
  return agent;
}

/**
 * 에이전트 정보 업데이트
 */
export function updateAgent(
  id: string,
  updates: Partial<Omit<AgentConfig, "id">>
): AgentConfig | null {
  const index = agents.findIndex((a) => a.id === id);
  if (index === -1) return null;

  agents[index] = {
    ...agents[index],
    ...updates,
  };

  return agents[index];
}

/**
 * 에이전트 제거
 */
export function removeAgent(id: string): boolean {
  const index = agents.findIndex((a) => a.id === id);
  if (index === -1) return false;

  agents.splice(index, 1);
  return true;
}

/**
 * 활성화된 에이전트 ID 목록 (메시지, 히스토리 등에서 사용)
 */
export function getAgentIds(): string[] {
  return agents.filter((a) => a.enabled).map((a) => a.id);
}
