import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pg to prevent native Pool from loading
vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: vi.fn() })),
}));

// Shared mock for db query/queryOne functions
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock("@/lib/db", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  pool: {},
}));

// ============================================================
// Part 1: generateRequestTitle 유닛 테스트
// ============================================================
describe("generateRequestTitle: 키워드 매칭 기반 제목 생성", () => {
  let generateRequestTitle: (content: string) => string;

  beforeEach(async () => {
    const mod = await import("@/lib/request-group");
    generateRequestTitle = mod.generateRequestTitle;
  });

  it("리팩토링 키워드가 포함되면 '리팩토링' 제목 생성", () => {
    // "refactor the auth module"은 refactor→리팩토링, auth→인증 시스템 두 개 매칭
    expect(generateRequestTitle("refactor the auth module")).toBe("리팩토링 + 인증 시스템");
    expect(generateRequestTitle("리팩토링 작업을 수행하세요")).toBe("리팩토링");
  });

  it("여러 패턴이 매칭되면 상위 2개를 '+' 조합", () => {
    const title = generateRequestTitle("refactor the API endpoint tests");
    // "refactor" → 리팩토링, "API" → API, "test" → 테스트 → 상위 2개 조합
    expect(title).toBe("리팩토링 + API");
  });

  it("패턴 미매칭 시 원본 50자 이내이면 그대로 반환", () => {
    const short = "간단한 작업 수행";
    expect(generateRequestTitle(short)).toBe(short);
  });

  it("패턴 미매칭 시 50자 초과이면 단어 경계에서 잘라서 '...' 추가", () => {
    const long = "이것은 매우 긴 내용입니다 어떤 특정 패턴도 매칭되지 않는 일반적인 텍스트를 작성하고 있습니다";
    const result = generateRequestTitle(long);
    expect(result.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("마크다운 포맷이 제거된 후 매칭됨", () => {
    const markdown = "```js\nconsole.log('hello')\n```\n\nPlease **refactor** this code";
    const result = generateRequestTitle(markdown);
    expect(result).toBe("리팩토링");
  });

  it("인라인 코드가 제거된 후 매칭됨", () => {
    const content = "Fix the `api` endpoint `login` function";
    const result = generateRequestTitle(content);
    expect(result).toContain("API");
  });

  it("빈 문자열은 빈 문자열 반환", () => {
    expect(generateRequestTitle("")).toBe("");
  });

  it("공백만 있는 문자열은 빈 문자열 반환", () => {
    expect(generateRequestTitle("   \n\n  ")).toBe("");
  });

  it("deploy 키워드 매칭", () => {
    expect(generateRequestTitle("배포 작업을 진행합니다")).toBe("배포");
    expect(generateRequestTitle("deploy to production")).toBe("배포");
  });

  it("데이터베이스 관련 키워드 매칭", () => {
    expect(generateRequestTitle("database migration 실행")).toBe("DB 작업");
  });

  it("config/설정 키워드 매칭", () => {
    expect(generateRequestTitle("설정 변경 작업")).toBe("설정 변경");
    expect(generateRequestTitle("Update the configuration")).toBe("설정 변경");
  });
});

// ============================================================
// Part 2: createRequestGroupId 유닛 테스트
// ============================================================
describe("createRequestGroupId: UUID 생성", () => {
  it("유효한 UUID v4 형식 반환", async () => {
    const { createRequestGroupId } = await import("@/lib/request-group");
    const id = createRequestGroupId();
    // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("매 호출마다 다른 UUID 생성", async () => {
    const { createRequestGroupId } = await import("@/lib/request-group");
    const ids = new Set(Array.from({ length: 100 }, () => createRequestGroupId()));
    expect(ids.size).toBe(100);
  });
});

// ============================================================
// Part 3: getHistoryDetail 이웃 조회 테스트
// ============================================================
describe("getHistoryDetail: requestGroupId 기반 이웃 조회", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requestGroupId가 있는 항목의 이웃 항목을 조회함", async () => {
    const { getHistoryDetail } = await import("@/lib/history");
    const testGroupId = "aaa-bbb-ccc";
    const entryId = "entry-1";

    // Main entry query
    mockQueryOne.mockResolvedValueOnce({
      id: entryId,
      agentId: "dev",
      type: "task_started",
      content: "Test content",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: testGroupId,
      requestTitle: "Test Group",
      content_total_length: "12",
    });

    // Neighbors query
    mockQuery.mockResolvedValueOnce([
      {
        id: "entry-2",
        agentId: "qa",
        type: "task_completed",
        content: "Neighbor",
        metadata: null,
        timestamp: "2025-01-01T00:01:00Z",
        requestGroupId: testGroupId,
        requestTitle: "Test Group",
      },
    ]);

    const result = await getHistoryDetail(entryId);

    expect(result).not.toBeNull();
    expect(result!.entry.requestGroupId).toBe(testGroupId);
    expect(result!.neighbors).toHaveLength(1);
    expect(result!.neighbors[0].id).toBe("entry-2");
  });

  it("requestGroupId가 없는 항목은 이웃 조회하지 않음", async () => {
    const { getHistoryDetail } = await import("@/lib/history");

    mockQueryOne.mockResolvedValueOnce({
      id: "entry-solo",
      agentId: "dev",
      type: "output",
      content: "Standalone content",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: null,
      requestTitle: null,
      content_total_length: "18",
    });

    const result = await getHistoryDetail("entry-solo");

    expect(result).not.toBeNull();
    expect(result!.neighbors).toEqual([]);
    // query should NOT be called for neighbors (only queryOne for main entry)
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("includeNeighbors=false 시 이웃 조회 생략", async () => {
    const { getHistoryDetail } = await import("@/lib/history");
    const testGroupId = "aaa-bbb-ccc";

    mockQueryOne.mockResolvedValueOnce({
      id: "entry-1",
      agentId: "dev",
      type: "task_started",
      content: "Test",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: testGroupId,
      requestTitle: "Test",
      content_total_length: "4",
    });

    const result = await getHistoryDetail("entry-1", { includeNeighbors: false });

    expect(result).not.toBeNull();
    expect(result!.neighbors).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("존재하지 않는 entryId는 null 반환", async () => {
    const { getHistoryDetail } = await import("@/lib/history");

    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getHistoryDetail("non-existent-id");
    expect(result).toBeNull();
  });

  it("contentLimit > 0 시 SUBSTRING으로 content 자름", async () => {
    const { getHistoryDetail } = await import("@/lib/history");

    mockQueryOne.mockResolvedValueOnce({
      id: "entry-1",
      agentId: "dev",
      type: "output",
      content: "First 100 chars",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: null,
      requestTitle: null,
      content_total_length: "5000",
    });

    const result = await getHistoryDetail("entry-1", {
      contentOffset: 0,
      contentLimit: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.hasMoreContent).toBe(true);
    expect(result!.contentTotalLength).toBe(5000);

    // Verify SQL uses SUBSTRING
    const sql = mockQueryOne.mock.calls[0][0] as string;
    expect(sql).toContain("SUBSTRING");
  });
});

// ============================================================
// Part 4: getGroupedHistory 추가 엣지 케이스
// ============================================================
describe("getGroupedHistory: 엣지 케이스", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("동일 requestGroupId에 여러 에이전트 항목이 섞여 있어도 올바르게 그룹화", async () => {
    const { getGroupedHistory } = await import("@/lib/history");
    const groupId = "multi-agent-group";

    mockQuery.mockResolvedValueOnce([
      {
        id: "e1", agentId: "dev", type: "task_started", content: "Dev started",
        metadata: null, timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: groupId, requestTitle: "Cross Agent Group",
        total_count: "4", completed_count: "2", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:03:00Z", group_title: "Cross Agent Group",
      },
      {
        id: "e2", agentId: "qa", type: "task_started", content: "QA started",
        metadata: null, timestamp: "2025-01-01T00:01:00Z",
        requestGroupId: groupId, requestTitle: "Cross Agent Group",
        total_count: "4", completed_count: "2", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:03:00Z", group_title: "Cross Agent Group",
      },
      {
        id: "e3", agentId: "dev", type: "task_completed", content: "Dev done",
        metadata: null, timestamp: "2025-01-01T00:02:00Z",
        requestGroupId: groupId, requestTitle: "Cross Agent Group",
        total_count: "4", completed_count: "2", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:03:00Z", group_title: "Cross Agent Group",
      },
      {
        id: "e4", agentId: "qa", type: "task_completed", content: "QA done",
        metadata: null, timestamp: "2025-01-01T00:03:00Z",
        requestGroupId: groupId, requestTitle: "Cross Agent Group",
        total_count: "4", completed_count: "2", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:03:00Z", group_title: "Cross Agent Group",
      },
    ]);

    const result = await getGroupedHistory(20);

    expect(result).toHaveLength(1);
    expect(result[0].entries).toHaveLength(4);
    // 항목에 dev와 qa 모두 포함
    const agentIds = new Set(result[0].entries.map(e => e.agentId));
    expect(agentIds.has("dev")).toBe(true);
    expect(agentIds.has("qa")).toBe(true);
  });

  it("여러 requestGroupId가 있을 때 각각 올바르게 그룹화", async () => {
    const { getGroupedHistory } = await import("@/lib/history");
    const groupA = "group-a";
    const groupB = "group-b";

    mockQuery.mockResolvedValueOnce([
      // Group A entries
      {
        id: "a1", agentId: "dev", type: "task_started", content: "A start",
        metadata: null, timestamp: "2025-01-02T00:00:00Z",
        requestGroupId: groupA, requestTitle: "Group A",
        total_count: "1", completed_count: "0", failed_count: "0",
        in_progress_count: "1", group_started_at: "2025-01-02T00:00:00Z",
        group_last_activity_at: "2025-01-02T00:00:00Z", group_title: "Group A",
      },
      // Group B entries
      {
        id: "b1", agentId: "qa", type: "task_completed", content: "B done",
        metadata: null, timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: groupB, requestTitle: "Group B",
        total_count: "1", completed_count: "1", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:00:00Z", group_title: "Group B",
      },
    ]);

    const result = await getGroupedHistory(20);

    expect(result).toHaveLength(2);
    expect(result[0].requestGroupId).toBe(groupA);
    expect(result[1].requestGroupId).toBe(groupB);
    expect(result[0].entries).toHaveLength(1);
    expect(result[1].entries).toHaveLength(1);
  });

  it("group_title이 null인 경우 '제목 없음' 폴백", async () => {
    const { getGroupedHistory } = await import("@/lib/history");

    mockQuery.mockResolvedValueOnce([
      {
        id: "e1", agentId: "dev", type: "task_started", content: "No title",
        metadata: null, timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: "no-title-group", requestTitle: null,
        total_count: "1", completed_count: "0", failed_count: "0",
        in_progress_count: "1", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:00:00Z", group_title: null,
      },
    ]);

    const result = await getGroupedHistory(20);

    expect(result[0].requestTitle).toBe("제목 없음");
  });
});

// ============================================================
// Part 5: getFilteredHistory - requestGroupId 빈 문자열 핸들링
// ============================================================
describe("getFilteredHistory: requestGroupId falsy 값 처리", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requestGroupId가 undefined이면 필터 미적용", async () => {
    const { getFilteredHistory } = await import("@/lib/history");

    mockQuery
      .mockResolvedValueOnce([{ count: "0" }])
      .mockResolvedValueOnce([]);

    await getFilteredHistory({ requestGroupId: undefined });

    for (const call of mockQuery.mock.calls) {
      expect(call[0]).not.toContain("request_group_id = $");
    }
  });

  it("requestGroupId 필터와 types + excludeTypes 동시 적용 시 올바른 SQL 생성", async () => {
    const { getFilteredHistory } = await import("@/lib/history");
    const testGroupId = "combo-test-group";

    mockQuery
      .mockResolvedValueOnce([{ count: "1" }])
      .mockResolvedValueOnce([{
        id: "e1", agentId: "dev", type: "task_started", content: "Test",
        metadata: null, timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: testGroupId, requestTitle: "Combo Test",
      }]);

    await getFilteredHistory({
      types: ["task_started"],
      excludeTypes: ["output"],
      requestGroupId: testGroupId,
    });

    const selectCall = mockQuery.mock.calls[1];
    const sql = selectCall[0] as string;
    const params = selectCall[1] as unknown[];

    // 3 필터 조건이 모두 존재
    expect(sql).toContain("type = ANY($");
    expect(sql).toContain("type != ALL($");
    expect(sql).toContain("request_group_id = $");
    expect(params).toContain(testGroupId);
  });
});

// ============================================================
// Part 6: POST /api/history requestGroupId 전달 테스트
// ============================================================
describe("API Route: POST /api/history with requestGroupId", () => {
  vi.mock("@/lib/auth", () => ({
    getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requestGroupId와 requestTitle이 body에서 addHistoryEntry로 전달됨", async () => {
    const testGroupId = "post-test-group";
    const testTitle = "POST Test Title";

    mockQuery.mockResolvedValueOnce([{
      id: "new-entry",
      agentId: "dev",
      type: "task_started",
      content: "Test POST",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: testGroupId,
      requestTitle: testTitle,
    }]);

    const { POST } = await import("@/app/api/history/route");
    const request = new Request("http://localhost:3000/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "dev",
        type: "task_started",
        content: "Test POST",
        requestGroupId: testGroupId,
        requestTitle: testTitle,
      }),
    });

    // Next.js의 NextRequest 생성을 위해 NextRequest로 래핑
    const { NextRequest } = await import("next/server");
    const nextReq = new NextRequest(request);
    const response = await POST(nextReq);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // addHistoryEntry에 전달된 인자 확인
    const insertCall = mockQuery.mock.calls[0];
    const sql = insertCall[0] as string;
    const params = insertCall[1] as unknown[];
    expect(sql).toContain("request_group_id");
    expect(sql).toContain("request_title");
    expect(params).toContain(testGroupId);
    expect(params).toContain(testTitle);
  });

  it("requestGroupId 없이 POST하면 null로 전달됨", async () => {
    mockQuery.mockResolvedValueOnce([{
      id: "new-entry-2",
      agentId: "dev",
      type: "output",
      content: "No group",
      metadata: null,
      timestamp: "2025-01-01T00:00:00Z",
      requestGroupId: null,
      requestTitle: null,
    }]);

    const { POST } = await import("@/app/api/history/route");
    const { NextRequest } = await import("next/server");
    const request = new NextRequest(
      new Request("http://localhost:3000/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "dev",
          type: "output",
          content: "No group",
        }),
      })
    );

    await POST(request);

    const insertCall = mockQuery.mock.calls[0];
    const params = insertCall[1] as unknown[];
    // Indices 4 and 5 should be null (requestGroupId and requestTitle)
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
  });
});

// ============================================================
// Part 7: /api/history/grouped 엔드포인트 테스트
// ============================================================
describe("API Route: GET /api/history/grouped", () => {
  vi.mock("@/lib/auth", () => ({
    getCurrentUser: vi.fn().mockResolvedValue({ email: "test@test.com" }),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grouped 엔드포인트가 그룹 데이터를 반환", async () => {
    const { GET } = await import("@/app/api/history/grouped/route");
    const { NextRequest } = await import("next/server");

    mockQuery.mockResolvedValueOnce([
      {
        id: "e1", agentId: "dev", type: "task_started", content: "Start",
        metadata: null, timestamp: "2025-01-01T00:00:00Z",
        requestGroupId: "group-1", requestTitle: "Group One",
        total_count: "2", completed_count: "1", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:01:00Z", group_title: "Group One",
      },
      {
        id: "e2", agentId: "dev", type: "task_completed", content: "Done",
        metadata: null, timestamp: "2025-01-01T00:01:00Z",
        requestGroupId: "group-1", requestTitle: "Group One",
        total_count: "2", completed_count: "1", failed_count: "0",
        in_progress_count: "0", group_started_at: "2025-01-01T00:00:00Z",
        group_last_activity_at: "2025-01-01T00:01:00Z", group_title: "Group One",
      },
    ]);

    const req = new NextRequest(
      new URL("/api/history/grouped", "http://localhost:3000")
    );
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].requestGroupId).toBe("group-1");
    expect(body.groups[0].entries).toHaveLength(2);
  });

  it("limit 쿼리 파라미터가 SQL에 전달됨", async () => {
    const { GET } = await import("@/app/api/history/grouped/route");
    const { NextRequest } = await import("next/server");

    mockQuery.mockResolvedValueOnce([]);

    const req = new NextRequest(
      new URL("/api/history/grouped?limit=5", "http://localhost:3000")
    );
    await GET(req);

    const call = mockQuery.mock.calls[0];
    const params = call[1] as unknown[];
    expect(params[0]).toBe(5);
  });
});
