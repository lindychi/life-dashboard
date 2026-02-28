# oh-my-claudecode (OMC) 프로젝트 종합 분석 보고서

> **분석 대상**: oh-my-claudecode v3.6.0 (로컬 설치 + GitHub 소스 기반)
> **작성일**: 2026-02-25
> **레포지토리**: https://github.com/Yeachan-Heo/oh-my-claudecode

---

## 목차

1. [전체 스킬/명령어 목록](#1-전체-스킬명령어-목록)
2. [토큰 효율성 관련 기능 분석](#2-토큰-효율성-관련-기능-분석)
3. [에이전트 시스템 구조](#3-에이전트-시스템-구조)
4. [로컬 vs GitHub 최신 버전 차이점](#4-로컬-vs-github-최신-버전-차이점)
5. [토큰 최적화 메커니즘 전체 정리](#5-토큰-최적화-메커니즘-전체-정리)

---

## 1. 전체 스킬/명령어 목록

### 1.1 코어 스킬 (13개) — 실행 모드 및 워크플로우

| 스킬 | 명령어 | 트리거 키워드 | 기능 요약 |
|------|--------|---------------|-----------|
| `orchestrate` | — (항상 활성) | 자동 | 멀티 에이전트 오케스트레이션 코어. 모든 작업의 기본 위임 프로토콜 |
| `autopilot` | `/oh-my-claudecode:autopilot` | "autopilot", "build me", "I want a" | 아이디어→완성 코드 5단계 자율 실행 (Expansion→Planning→Execution→QA→Validation) |
| `ultrapilot` | `/oh-my-claudecode:ultrapilot` | "ultrapilot", "parallel build" | 최대 5개 병렬 워커로 3-5배 빠른 autopilot. 파일 소유권 분리로 충돌 방지 |
| `ultrawork` | `/oh-my-claudecode:ultrawork` | "ulw", "ultrawork" | 최대 병렬 에이전트 실행. 복잡한 작업에 Opus까지 활용 |
| `ecomode` | `/oh-my-claudecode:ecomode` | "eco", "efficient", "budget" | 토큰 절약 병렬 실행. Haiku 기본, Sonnet 폴백. Opus 미사용 |
| `swarm` | `/oh-my-claudecode:swarm` | "swarm N agents" | N개 에이전트가 공유 태스크 풀에서 원자적으로 작업 claim. SQLite 기반 |
| `pipeline` | `/oh-my-claudecode:pipeline` | "pipeline", "chain" | 에이전트 체이닝. 6개 빌트인 프리셋 (review/implement/debug/research/refactor/security) |
| `ralph` | `/oh-my-claudecode:ralph` | "ralph", "don't stop" | 완료 검증까지 반복 루프. PRD 기반 스토리 완료 추적 |
| `ralph-init` | `/oh-my-claudecode:ralph-init` | — | PRD (Product Requirements Document) 초기화. 구조화된 ralph 실행용 |
| `ultraqa` | `/oh-my-claudecode:ultraqa` | "test", "QA", "verify" | 자율 QA 사이클: test→verify→fix→repeat. 빌드/린트/테스트 통과까지 |
| `plan` | `/oh-my-claudecode:plan` | "plan this", "plan the" | 인터뷰 기반 계획 세션. AskUserQuestion UI로 선호도 수집 |
| `ralplan` | `/oh-my-claudecode:ralplan` | "ralplan" | Planner+Architect+Critic 3자 반복 합의 기반 계획 |
| `review` | `/oh-my-claudecode:review` | "review plan" | Critic 에이전트를 통한 계획 리뷰 |

### 1.2 향상(Enhancement) 스킬 (8개)

| 스킬 | 명령어 | 트리거 | 기능 요약 |
|------|--------|--------|-----------|
| `deepinit` | `/oh-my-claudecode:deepinit` | "index codebase" | 계층적 AGENTS.md 코드베이스 문서 자동 생성 |
| `deepsearch` | `/oh-my-claudecode:deepsearch` | "search", "find" | 멀티 전략 코드베이스 탐색 |
| `analyze` | `/oh-my-claudecode:analyze` | "analyze", "debug" | 딥 분석 및 조사 |
| `research` | `/oh-my-claudecode:research` | "research", "statistics" | 병렬 scientist 에이전트 오케스트레이션. AUTO 모드 지원 |
| `frontend-ui-ux` | — (자동 활성) | UI/컴포넌트 컨텍스트 | 디자이너 시각의 UI/UX 감각 주입 |
| `git-master` | — (자동 활성) | git/commit 컨텍스트 | 원자적 커밋, 리베이스, 이력 관리 전문가 |
| `tdd` | `/oh-my-claudecode:tdd` | "tdd", "test first" | 테스트 우선 개발 강제. Red→Green→Refactor 워크플로우 |
| `learner` | `/oh-my-claudecode:learner` | "extract skill" | 현재 세션에서 재사용 가능한 스킬 추출 |

### 1.3 유틸리티 스킬 (14개)

| 스킬 | 명령어 | 기능 요약 |
|------|--------|-----------|
| `note` | `/oh-my-claudecode:note` | 컴팩션 내성 노트패드에 메모 저장 (3계층: Priority/Working/Manual) |
| `cancel` | `/oh-my-claudecode:cancel` | 모든 모드 통합 취소 (autopilot/ultrapilot/ralph/ultrawork/ecomode/swarm/pipeline) |
| `omc-setup` | `/oh-my-claudecode:omc-setup` | 초기 설정 마법사. 프로젝트/글로벌 CLAUDE.md 생성. 기본 실행 모드 선택 |
| `doctor` | `/oh-my-claudecode:doctor` | 설치 문제 진단 및 수정 |
| `help` | `/oh-my-claudecode:help` | OMC 사용 가이드 |
| `hud` | `/oh-my-claudecode:hud` | HUD 상태바 구성 (minimal/focused/full 프리셋) |
| `release` | `/oh-my-claudecode:release` | 자동 릴리스 워크플로우 |
| `mcp-setup` | `/oh-my-claudecode:mcp-setup` | MCP 서버 구성 (Context7, Exa, Filesystem, GitHub) |
| `learn-about-omc` | `/oh-my-claudecode:learn-about-omc` | 사용 패턴 분석 |
| `build-fix` | `/oh-my-claudecode:build-fix` | 빌드/타입스크립트 에러 최소 변경으로 수정 |
| `code-review` | `/oh-my-claudecode:code-review` | 심각도 등급 포함 종합 코드 리뷰 |
| `security-review` | `/oh-my-claudecode:security-review` | OWASP Top 10 보안 취약점 탐지 |
| `local-skills-setup` | `/oh-my-claudecode:local-skills-setup` | 로컬 스킬 디렉토리 설정 마법사 |
| `skill` | `/oh-my-claudecode:skill` | 로컬 스킬 관리 (list/add/remove/edit/search/sync) |

**총 스킬 수: 35개** (코어 13 + 향상 8 + 유틸리티 14)

---

## 2. 토큰 효율성 관련 기능 분석

### 2.1 Ecomode: 토큰 절약 병렬 실행 모드

#### 핵심 원리

Ecomode는 **기본 모델 티어를 Haiku(LOW)로 다운그레이드**하여 토큰 비용을 30-50% 절감하는 실행 모드다.

#### Ultrawork와의 비교

| 측면 | Ecomode | Ultrawork |
|------|---------|-----------|
| **기본 티어** | Haiku (LOW) | Sonnet (MEDIUM) |
| **폴백 티어** | Sonnet (MEDIUM) | Opus (HIGH) |
| **Opus 사용** | 회피 (계획 단계만 필수시) | 복잡한 작업에 적극 사용 |
| **토큰 비용** | 낮음 | 높음 |
| **적합 작업** | 표준 개발 (기능, 버그 수정, 리팩토링) | 복잡한 추론 필요 작업 |

#### 에이전트 라우팅 차이

| 도메인 | Ecomode 사용 | Ultrawork 사용 |
|--------|-------------|----------------|
| Analysis | `architect-low` (haiku) | `architect` (opus) |
| Execution | `executor-low` (haiku) | `executor-high` (opus) |
| Frontend | `designer-low` (haiku) | `designer-high` (opus) |
| Search | `explore` (haiku) | `explore-medium` (sonnet) |

#### 활성화 방법

```
# 명시적 키워드 (항상 ecomode 활성화)
eco fix the login bug
ecomode: refactor the API
budget mode: add form validation

# 기본 모드로 설정
/oh-my-claudecode:omc-setup → defaultExecutionMode: "ecomode"
# 이후 "fast", "parallel" 입력 시 자동 ecomode 활성화
```

#### 키워드 충돌 해결 우선순위

| 우선순위 | 조건 | 결과 |
|----------|------|------|
| 1 (최고) | 양쪽 명시적 키워드 동시 존재 ("ulw eco") | **ecomode 승리** (더 제한적) |
| 2 | 단일 명시적 키워드 | 해당 모드 활성화 |
| 3 | "fast"/"parallel"만 있음 | config 파일 참조 |
| 4 (최저) | config 없음 | ultrawork 기본값 |

### 2.2 Smart Model Routing

#### 3-티어 모델 라우팅 시스템

```
사용자 요청
    │
    ├── 복잡도 신호 추출 ──→ 복잡도 점수 계산 ──→ 티어 결정
    │   (어휘적/구조적/컨텍스트)     (가중 점수)      │
    │                                              ├─ LOW → Haiku
    │                                              ├─ MEDIUM → Sonnet
    │                                              └─ HIGH → Opus
    │
    └── 에이전트 기본 모델 ──→ Delegation Enforcer가 자동 주입
```

#### 복잡도 신호 탐지

| 신호 유형 | 분석 내용 |
|-----------|-----------|
| **어휘적 (Lexical)** | 단어 수, 키워드 ("architecture", "debugging", "risk", "simple") |
| **구조적 (Structural)** | 서브태스크 수, 크로스파일 의존성, 영향 범위, 되돌림 가능성 |
| **컨텍스트 (Context)** | 이전 실패 횟수, 대화 깊이, 계획 복잡도 |

#### 에이전트별 적응형 라우팅 예시

| 에이전트 | Haiku (LOW) | Sonnet (MEDIUM) | Opus (HIGH) |
|----------|-------------|-----------------|-------------|
| architect | 단순 조회 | 추적/분석 | 디버깅/아키텍처 |
| planner | 분해 | 계획 수립 | 전략적 설계 |
| critic | 체크리스트 | 갭 분석 | 적대적 검증 |
| executor | 단순 수정 | 모듈 작업 | 위험한 리팩토링 |
| explore | 단순 검색 | 복잡한 검색 | 아키텍처 맵핑 |

#### Delegation Enforcer (자동 모델 주입 미들웨어)

```typescript
// Before (수동) — 매번 model 파라미터 필요
Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="...")

// After (자동) — Delegation Enforcer가 에이전트 정의에서 기본 모델 주입
Task(subagent_type="oh-my-claudecode:executor", prompt="...")
// → 자동으로 model="sonnet" 주입
```

- **pre-tool-use 훅**으로 동작: Task/Agent 도구 호출 인터셉트
- **명시적 모델 우선**: 사용자가 지정한 model은 절대 덮어쓰지 않음
- **O(1) 조회**: 해시맵 기반 에이전트 정의 참조
- **디버그 모드**: `OMC_DEBUG=true`로 주입 로그 확인

### 2.3 Delegation Categories (위임 카테고리)

#### 7개 시맨틱 카테고리

| 카테고리 | 티어 | Temperature | Thinking Budget | 용도 | 프롬프트 키워드 |
|----------|------|-------------|-----------------|------|-----------------|
| `visual-engineering` | HIGH | 0.7 | high | UI/UX, 프론트엔드, 디자인 시스템 | "design", "UI", "component", "dashboard" |
| `ultrabrain` | HIGH | 0.3 | **max** | 복잡한 추론, 아키텍처, 딥 디버깅 | "debug", "race condition", "architecture" |
| `artistry` | MEDIUM | 0.9 | medium | 창의적 솔루션, 브레인스토밍 | "creative", "innovative", "brainstorm" |
| `quick` | LOW | 0.1 | low | 단순 조회, 기본 연산 | "find", "what is", "lookup" |
| `writing` | MEDIUM | 0.5 | medium | 문서화, 기술 작문 | "document", "write", "explain" |
| `unspecified-low` | LOW | 0.3 | low | 단순 태스크 기본값 | — |
| `unspecified-high` | HIGH | 0.5 | high | 복잡한 태스크 기본값 | — |

#### 카테고리 해석 우선순위

```
명시적 카테고리 > 명시적 티어 > 자동 탐지(키워드 매칭)
```

#### 동작 흐름

```
사용자 요청
    │
    ├─▶ 명시적 카테고리 지정? ──▶ resolveCategory()
    │                              │
    ├─▶ 명시적 티어 지정? ─────────┤
    │                              │
    └─▶ 자동 탐지 ────────────────▶│
         (키워드 매칭)             │
                                   ▼
                            CategoryConfig
                            { tier, temperature, thinkingBudget }
                                   │
                                   ▼
                            ComplexityTier (LOW/MEDIUM/HIGH)
                                   │
                                   ▼
                            Model Selection (haiku/sonnet/opus)
```

#### 프롬프트 향상 기능

카테고리별로 프롬프트에 자동으로 가이던스 추가:

- `visual-engineering` → UX/접근성 가이던스 추가
- `ultrabrain` → "깊이 체계적으로 사고하라. 모든 엣지 케이스를 고려하라" 추가
- `artistry` → 창의적 접근법 권장
- `quick` → 간결하고 직접적인 응답 지시

---

## 3. 에이전트 시스템 구조

### 3.1 전체 32개 에이전트 매핑

#### 도메인별 티어 매트릭스

| 도메인 | LOW (Haiku) | MEDIUM (Sonnet) | HIGH (Opus) |
|--------|-------------|-----------------|-------------|
| **분석 (Analysis)** | `architect-low` | `architect-medium` | `architect` |
| **실행 (Execution)** | `executor-low` | `executor` | `executor-high` |
| **탐색 (Search)** | `explore` | `explore-medium` | `explore-high` |
| **연구 (Research)** | `researcher-low` | `researcher` | — |
| **프론트엔드 (Frontend)** | `designer-low` | `designer` | `designer-high` |
| **문서 (Docs)** | `writer` | — | — |
| **시각 (Visual)** | — | `vision` | — |
| **계획 (Planning)** | — | — | `planner` |
| **비평 (Critique)** | — | — | `critic` |
| **사전분석 (Pre-Planning)** | — | — | `analyst` |
| **테스팅 (Testing)** | — | `qa-tester` | `qa-tester-high` |
| **보안 (Security)** | `security-reviewer-low` | — | `security-reviewer` |
| **빌드 (Build)** | `build-fixer-low` | `build-fixer` | — |
| **TDD** | `tdd-guide-low` | `tdd-guide` | — |
| **코드 리뷰 (Code Review)** | `code-reviewer-low` | — | `code-reviewer` |
| **데이터 과학 (Data Science)** | `scientist-low` | `scientist` | `scientist-high` |

**티어별 집계**: LOW 11개 / MEDIUM 10개 / HIGH 11개

### 3.2 에이전트 세부 역할

#### HIGH 티어 (Opus) — 11개

| 에이전트 | 역할 | 핵심 제약 |
|----------|------|-----------|
| `architect` | 전략 어드바이저, 아키텍처 분석, 디버깅 | **READ-ONLY** (Write/Edit 불가) |
| `executor-high` | 복잡한 멀티파일 리팩토링 | Task 도구 **차단** (하위 위임 불가) |
| `explore-high` | 깊은 아키텍처 검색, 시스템 패턴 분석 | READ-ONLY |
| `designer-high` | 디자인 시스템 아키텍처, 복잡한 컴포넌트 계층 | 풀 크리에이티브 권한 |
| `planner` | 전략적 계획 수립, 인터뷰 워크플로우 | AskUserQuestion 도구 사용 필수 |
| `critic` | 계획 리뷰, 적대적 검증 | READ-ONLY |
| `analyst` | 사전 분석, 요구사항 분석 | READ-ONLY |
| `qa-tester-high` | 종합 통합 테스팅 | tmux 기반 인터랙티브 |
| `security-reviewer` | 보안 취약점 심층 분석 | READ-ONLY |
| `code-reviewer` | 종합 코드 리뷰, 심각도 등급 | READ-ONLY |
| `scientist-high` | 복잡한 ML, 가설 테스트, 통계 분석 | python_repl 도구 포함 |

#### MEDIUM 티어 (Sonnet) — 10개

| 에이전트 | 역할 |
|----------|------|
| `architect-medium` | 표준 분석, 의존성 추적 |
| `executor` | 표준 기능 구현 |
| `explore-medium` | 심층 검색, 교차 참조 |
| `researcher` | 종합 문서 연구, 외부 소스 합성 |
| `designer` | 표준 UI 컴포넌트 작업 |
| `vision` | 이미지/다이어그램 분석 |
| `qa-tester` | CLI 인터랙티브 테스팅 |
| `build-fixer` | 빌드 에러 진단 및 수정 |
| `tdd-guide` | TDD 워크플로우 가이드 |
| `scientist` | 데이터 분석, 통계, 연구 실행 |

#### LOW 티어 (Haiku) — 11개

| 에이전트 | 역할 |
|----------|------|
| `architect-low` | 빠른 질문 응답, 단일 파일 분석 |
| `executor-low` | 단일 파일, 단순 변경 |
| `explore` | 빠른 패턴 매칭, 파일 위치 찾기 |
| `researcher-low` | 빠른 API 조회 |
| `designer-low` | 간단한 CSS 변경, 스타일링 |
| `writer` | 문서 작성 (haiku 전용, 비용 효율적) |
| `security-reviewer-low` | 빠른 보안 스캔 |
| `build-fixer-low` | 단순 빌드 에러 수정 |
| `tdd-guide-low` | 빠른 테스트 제안 |
| `code-reviewer-low` | 빠른 코드 품질 점검 |
| `scientist-low` | 빠른 데이터 검사 |

### 3.3 에이전트 공통 패턴

- **Worker Preamble Protocol**: 워커 에이전트는 자체 서브 에이전트 스폰 금지. 도구를 직접 사용하고 절대 경로로 결과 보고
- **Escalation Signal**: 낮은 티어 에이전트가 범위 초과 감지 시 `ESCALATION RECOMMENDED: [이유] → Use [상위 에이전트]` 출력
- **도구 제한**: LOW 티어는 WebSearch/WebFetch 불가, Task 도구는 모든 티어에서 제한적

---

## 4. 로컬 vs GitHub 최신 버전 차이점

### 4.1 버전 정보

| 항목 | 로컬 설치 | GitHub (docs/CLAUDE.md) |
|------|-----------|------------------------|
| **패키지 버전** | **3.6.0** | 3.6.0 (동일) |
| **CLAUDE.md 내용** | `~/.claude/CLAUDE.md`와 `docs/CLAUDE.md` 동일 | 동일 |
| **에이전트 수** | 32 | 32 |
| **스킬 수** | 35 | 35 |

### 4.2 `~/.claude/CLAUDE.md` vs `docs/CLAUDE.md` 비교

**결론: 완전 동일 (byte-for-byte identical)**

로컬 설치된 `~/.claude/CLAUDE.md` (577줄)와 플러그인 캐시 내 `docs/CLAUDE.md` (577줄)의 내용이 정확히 일치한다. 두 파일 모두:

- 7개 파트 구조 (Quick Start → Core Protocol → User Experience → Complete Reference → New Features → Internal Protocols → Setup)
- 동일한 35개 스킬 테이블
- 동일한 32개 에이전트 매트릭스
- 동일한 토큰 최적화 섹션

### 4.3 v3.6.0 주요 변경 사항 (CHANGELOG 기반)

v3.6.0 (2026-01-26)에서 추가된 주요 기능:

| 기능 | 설명 |
|------|------|
| **SQLite 기반 Swarm 조정** | `better-sqlite3`를 사용한 원자적 태스크 claim. IMMEDIATE 트랜잭션, 5분 리스 타임아웃, 하트비트 |
| **Mode Registry** | 중앙 집중식 모드 상태 감지. 배타적 모드 간 상호 배제 (autopilot/ultrapilot/swarm/pipeline) |
| **Worker Preamble Protocol** | 워커가 서브 에이전트를 스폰하지 못하도록 강제 |
| **Ultrapilot Decomposer** | AI 기반 태스크 분해, 파일 소유권 할당, 의존성 추적 |
| **State 파일 표준화** | 모든 모드의 상태 파일을 `.omc/state/` 하위로 통합 |

### 4.4 v3.5.1~v3.5.7 변경 요약

| 버전 | 주요 내용 |
|------|-----------|
| 3.5.7 | `learn-about-omc` 스킬 추가, 42→35 스킬 통합 (deprecated cancel-* 제거) |
| 3.5.1 | Learned Skills 자동 매칭/실행 시스템, Analytics 백필 시스템, 에이전트 비용 귀속 수정 |

---

## 5. 토큰 최적화 메커니즘 전체 정리

### 5.1 최적화 계층 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 5: 실행 모드 선택                                          │
│  ecomode (30-50% 절약) │ ultrawork (성능 우선) │ autopilot (균형) │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: Delegation Categories                                   │
│  quick (LOW/0.1) │ writing (MED/0.5) │ ultrabrain (HIGH/0.3)    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Smart Model Routing                                     │
│  복잡도 신호 → 점수 계산 → 티어 결정 (LOW/MEDIUM/HIGH)            │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Delegation Enforcer                                     │
│  에이전트 정의에서 기본 모델 자동 주입 (pre-tool-use hook)          │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: 에이전트 티어 시스템                                     │
│  32개 에이전트 × 3 티어 (Haiku/Sonnet/Opus)                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 메커니즘별 상세 분석

#### (A) 에이전트 티어 시스템 — 기본 비용 제어

각 에이전트가 도메인별로 3개 티어를 제공. 같은 도메인이라도 **태스크 복잡도에 따라 다른 모델 사용**.

**비용 영향 분석** (Tiered Agents v2 문서 기반):

| 시나리오 | 기존 (모두 Sonnet) | 티어 적용 후 | 절감율 |
|----------|-------------------|-------------|--------|
| 단순 조회 (70%) | $3/$15 | $1/$5 (Haiku) | ~67% |
| 표준 작업 (25%) | $3/$15 | $3/$15 (Sonnet) | 0% |
| 복잡한 작업 (5%) | $3/$15 | $5/$25 (Opus) | -67% |
| **가중 평균** | **$3/$15** | **~$1.60/$8** | **~47%** |

#### (B) Smart Model Routing — 지능적 복잡도 판단

복잡도 신호를 추출하고 가중 점수를 계산하여 모델 티어를 자동 결정:

```typescript
// 복잡도 점수 계산 (가중 합)
score = lexical_weight × lexical_score
      + structural_weight × structural_score
      + context_weight × context_score

// 티어 결정
if (score < LOW_THRESHOLD) → Haiku
else if (score < HIGH_THRESHOLD) → Sonnet
else → Opus
```

**티어별 프롬프트 적응**:
- **Haiku**: 간결하고 직접적인 프롬프트 (속도 최적화)
- **Sonnet**: 균형 잡힌 프롬프트 (효율성)
- **Opus**: 딥 리즈닝 프롬프트 + thinking mode 활용

#### (C) Delegation Categories — 시맨틱 비용 번들링

모델 티어 + temperature + thinking budget을 하나의 시맨틱 카테고리로 묶어 **의도에 맞는 최적 설정** 자동 적용.

핵심 가치: `ultrabrain`이라는 한 단어가 "HIGH 티어 + 낮은 temperature(0.3) + 최대 thinking budget"을 동시에 설정.

#### (D) Ecomode — 강제 하향 라우팅

모든 에이전트 라우팅을 한 단계 낮춤:
- Opus 작업 → Sonnet으로 대체
- Sonnet 작업 → Haiku로 대체
- 계획 단계만 필요시 Sonnet 허용

**30-50% 토큰 비용 절감** (README 공식 수치)

#### (E) Delegation Enforcer — 모델 누락 방지

에이전트 호출 시 `model` 파라미터를 누락하면, 부모 세션의 모델(보통 Opus)이 그대로 전파되어 **불필요한 비용 발생**. Delegation Enforcer가 이를 자동 보정.

#### (F) Context Persistence — 컨텍스트 재사용

| 메커니즘 | 설명 | 토큰 영향 |
|----------|------|-----------|
| `<remember>` 태그 | 컴팩션 후에도 중요 정보 유지 | 반복 탐색 감소 |
| Priority Context | 항상 로드되는 500자 이내 핵심 정보 | 재질문 방지 |
| Working Memory | 7일 자동 가지치기 세션 노트 | 세션 간 지식 전달 |
| Notepad Wisdom | 계획별 학습/결정/이슈 기록 | 반복 실패 방지 |
| AGENTS.md | 코드베이스 구조 문서 (deepinit) | 탐색 에이전트 호출 감소 |

#### (G) 병렬화 규칙 — 지능적 동시 실행

| 조건 | 행동 | 토큰 영향 |
|------|------|-----------|
| 2+ 독립 태스크 (>30초) | 병렬 실행 | 총 소비량 동일, 시간 절약 |
| 순차 의존성 | 순서대로 실행 | 불필요한 재실행 방지 |
| 빠른 작업 (<10초) | 직접 수행 | 에이전트 스폰 오버헤드 절약 |
| 백그라운드 작업 | 최대 5개 동시 | 대기 시간 활용 |

#### (H) Analytics 시스템 — 비용 가시성

| 기능 | 설명 |
|------|------|
| 자동 토큰 추적 | HUD 렌더링마다 토큰 사용량 자동 기록 |
| 에이전트별 비용 귀속 | `parentToolUseID` 기반 정확한 에이전트 비용 분리 |
| 세션별 비용 | 세션 단위 비용 추적 및 시간당 비용 계산 |
| 캐시 효율 | 캐시 히트율 모니터링 |
| 예산 경고 | $2 경고, $5 위험 수준 알림 |
| CLI 리포트 | `omc stats`, `omc cost daily/weekly/monthly` |
| 백필 엔진 | `~/.claude/projects/` 트랜스크립트에서 과거 데이터 복원 |

### 5.3 토큰 최적화 종합 요약

| 최적화 메커니즘 | 절감 효과 | 적용 시점 |
|----------------|-----------|-----------|
| **에이전트 티어 시스템** | ~47% (가중 평균) | 모든 에이전트 호출 |
| **Ecomode** | 30-50% 추가 절감 | 사용자 명시적 활성화 |
| **Smart Model Routing** | 동적 (복잡도 기반) | 자동 (매 위임마다) |
| **Delegation Categories** | 카테고리별 최적 설정 | 자동 (키워드 탐지) |
| **Delegation Enforcer** | 모델 누락 방지 | 자동 (pre-tool-use hook) |
| **Context Persistence** | 반복 작업 감소 | 세션 간 |
| **병렬화 규칙** | 시간 절약 (토큰 동일) | 자동 |
| **Analytics** | 가시성 → 행동 변화 유도 | 사후 분석 |

### 5.4 실전 권장사항

1. **일상 개발**: `ecomode`를 기본 모드로 설정 (`omc-setup`에서 `defaultExecutionMode: "ecomode"`)
2. **복잡한 프로젝트**: `ultrawork` 또는 `autopilot` 사용
3. **대규모 리팩토링**: `ultrapilot` (병렬 워커)
4. **비용 모니터링**: `omc stats`로 정기 확인
5. **컨텍스트 유지**: `<remember priority>` 태그로 핵심 패턴 영구 저장
6. **deepinit 실행**: 새 프로젝트 시작 시 AGENTS.md 생성으로 탐색 비용 절감

---

## 부록: 프로젝트 메타 정보

| 항목 | 값 |
|------|-----|
| npm 패키지명 | `oh-my-claude-sisyphus` |
| 현재 버전 | 3.6.0 |
| 라이선스 | MIT |
| 저자 | Yeachan Heo |
| Node.js 요구사항 | >=20.0.0 |
| 주요 의존성 | `better-sqlite3`, `@anthropic-ai/claude-agent-sdk`, `@ast-grep/napi`, `zod` |
| 테스트 프레임워크 | Vitest |
| 총 테스트 수 | 612+ (v3.4.0 기준, v3.6.0에서 37 추가) |
| 영감 소스 | oh-my-opencode, claude-hud, Superpowers, everything-claude-code |
