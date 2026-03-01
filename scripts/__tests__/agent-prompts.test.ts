import { describe, it, expect, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

const AGENTS_JSON_PATH = path.resolve(__dirname, "../../agents.json");

interface Agent {
  id: string;
  name: string;
  role: string;
  defaultModel: string;
  systemPrompt: string;
  enabled?: boolean;
  [key: string]: unknown;
}

function loadAgents(): Agent[] {
  const raw = fs.readFileSync(AGENTS_JSON_PATH, "utf-8");
  return JSON.parse(raw) as Agent[];
}

describe("agents.json — baseline validation", () => {
  it("all agents have non-empty systemPrompt", () => {
    const agents = loadAgents();
    for (const agent of agents) {
      expect(
        agent.systemPrompt,
        `Agent ${agent.id} must have a non-empty systemPrompt`
      ).toBeTruthy();
      expect(
        agent.systemPrompt.trim().length,
        `Agent ${agent.id} systemPrompt must not be blank`
      ).toBeGreaterThan(0);
    }
  });

  it("all agents have valid defaultModel", () => {
    const agents = loadAgents();
    const validModels = ["haiku", "sonnet", "opus"];
    for (const agent of agents) {
      expect(
        validModels,
        `Agent ${agent.id} has invalid defaultModel: ${agent.defaultModel}`
      ).toContain(agent.defaultModel);
    }
  });
});

describe("QA agent — A-3 completion protocol", () => {
  let qa: Agent;

  beforeEach(() => {
    const agents = loadAgents();
    const found = agents.find((a) => a.id === "qa");
    if (!found) throw new Error("QA agent not found in agents.json");
    qa = found;
  });

  it("systemPrompt contains 완료 프로토콜 section", () => {
    expect(qa.systemPrompt).toContain("완료 프로토콜");
  });

  it("systemPrompt mentions exit code requirement", () => {
    expect(qa.systemPrompt).toContain("exit code");
  });

  it("systemPrompt prohibits should pass / should work assumptions", () => {
    expect(qa.systemPrompt).toMatch(/should pass|should work/i);
    // The prohibition text must appear
    expect(qa.systemPrompt).toContain("가정형 표현 금지");
  });

  it("systemPrompt requires explicit failure reporting", () => {
    expect(qa.systemPrompt).toContain("실패 시 반드시 명시");
  });
});

describe("Growth agent — A-4 stuck fix", () => {
  let growth: Agent;

  beforeEach(() => {
    const agents = loadAgents();
    const found = agents.find((a) => a.id === "growth");
    if (!found) throw new Error("Growth agent not found in agents.json");
    growth = found;
  });

  it("systemPrompt contains external access restriction", () => {
    expect(growth.systemPrompt).toContain("외부 URL 직접 접근 금지");
  });

  it("systemPrompt prohibits approval request loops", () => {
    expect(growth.systemPrompt).toContain("사용자 승인 대기 루프 금지");
  });

  it("systemPrompt contains timeout/stuck policy", () => {
    expect(growth.systemPrompt).toContain("10분 이상");
  });
});

describe("Learner agent — cost optimization", () => {
  it("learner agent uses sonnet model (not opus)", () => {
    const agents = loadAgents();
    const learner = agents.find((a) => a.id === "learner");
    expect(learner, "Learner agent not found").toBeTruthy();
    expect(learner!.defaultModel).toBe("sonnet");
  });
});

describe("Analyst / Researcher — role boundaries", () => {
  it("analyst role describes 정량 분석 전담", () => {
    const agents = loadAgents();
    const analyst = agents.find((a) => a.id === "analyst");
    expect(analyst, "Analyst agent not found").toBeTruthy();
    expect(analyst!.role).toContain("정량 분석 전담");
  });

  it("researcher role describes 정성 조사 전담", () => {
    const agents = loadAgents();
    const researcher = agents.find((a) => a.id === "researcher");
    expect(researcher, "Researcher agent not found").toBeTruthy();
    expect(researcher!.role).toContain("정성 조사 전담");
  });
});
