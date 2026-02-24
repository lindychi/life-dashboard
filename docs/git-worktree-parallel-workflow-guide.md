# Git Worktree 기반 병렬 작업 관리 베스트 프랙티스

> **조사 일자**: 2026-02-25
> **대상**: AI 에이전트 기반 병렬 개발 환경에서의 Git Worktree 활용 전략
> **컨텍스트**: LifeDashboard 프로젝트 (Next.js, multi-agent relay system)

---

## 목차

1. [Git Worktree 개요 및 핵심 개념](#1-git-worktree-개요-및-핵심-개념)
2. [멀티태스크 워크플로우 패턴](#2-멀티태스크-워크플로우-패턴)
3. [멀티에이전트 충돌 최소화 전략](#3-멀티에이전트-충돌-최소화-전략)
4. [병합 시 Conflict Resolution 자동화](#4-병합-시-conflict-resolution-자동화)
5. [CI/CD 파이프라인 통합](#5-cicd-파이프라인-통합)
6. [LifeDashboard 적용 방안](#6-lifedashboard-적용-방안)
7. [참고 자료 및 관련 도구](#7-참고-자료-및-관련-도구)

---

## 1. Git Worktree 개요 및 핵심 개념

### 1.1 Worktree란?

`git worktree`는 단일 Git 리포지토리에서 **여러 작업 디렉토리를 동시에 유지**할 수 있는 기능이다. 각 worktree는 독립적인 브랜치를 체크아웃하며, `.git` 오브젝트 스토어를 공유하므로 디스크 사용량이 최소화된다.

```
repo/                          # 메인 worktree (main branch)
├── .git/
│   └── worktrees/
│       ├── feature-auth/      # worktree 메타데이터
│       └── fix-api-timeout/
├── src/
└── ...

../worktrees/
├── feature-auth/              # 독립 작업 디렉토리
│   ├── .git → ../../repo/.git/worktrees/feature-auth
│   └── src/
└── fix-api-timeout/
    ├── .git → ../../repo/.git/worktrees/fix-api-timeout
    └── src/
```

### 1.2 Worktree vs 기존 방식 비교

| 특성 | `git stash` + `checkout` | `git clone` (다중) | `git worktree` |
|------|--------------------------|---------------------|----------------|
| 컨텍스트 스위칭 비용 | 높음 (stash 충돌 위험) | 낮음 | **낮음** |
| 디스크 사용량 | 최소 | **높음** (전체 복제) | **최소** (공유) |
| 객체 저장소 | 공유 | 독립 | **공유** |
| 동시 작업 수 | 1개 | 무제한 | **무제한** |
| `node_modules` 독립성 | 불가 | 가능 | **가능** |
| 빌드 캐시 독립성 | 불가 | 가능 | **가능** |
| 브랜치 lock | 없음 | 없음 | **자동** (같은 브랜치 체크아웃 불가) |

### 1.3 핵심 명령어 레퍼런스

```bash
# 생성
git worktree add ../worktrees/feature-name feature-branch
git worktree add -b new-branch ../worktrees/new-branch base-branch

# 조회
git worktree list
git worktree list --porcelain  # 스크립트 파싱용

# 정리
git worktree remove ../worktrees/feature-name
git worktree prune  # 삭제된 디렉토리의 메타데이터 정리

# 잠금 (이동식 저장소 등)
git worktree lock ../worktrees/feature-name --reason "장기 작업 중"
git worktree unlock ../worktrees/feature-name
```

---

## 2. 멀티태스크 워크플로우 패턴

### 2.1 브랜치 네이밍 컨벤션

에이전트 기반 병렬 작업에 최적화된 네이밍 체계:

```
<type>/<scope>/<description>[-<agent-id>]
```

#### 타입 프리픽스

| 프리픽스 | 용도 | 예시 |
|----------|------|------|
| `feat/` | 새 기능 | `feat/auth/magic-link` |
| `fix/` | 버그 수정 | `fix/api/timeout-handling` |
| `refactor/` | 리팩토링 | `refactor/relay/connection-pool` |
| `docs/` | 문서 | `docs/api/swagger-spec` |
| `test/` | 테스트 | `test/e2e/login-flow` |
| `chore/` | 빌드/설정 | `chore/ci/docker-optimization` |

#### 에이전트 병렬 작업 시 확장 네이밍

```
feat/auth/magic-link-agent01        # 에이전트 1이 작업
feat/dashboard/chart-widget-agent02  # 에이전트 2가 동시 작업
fix/relay/heartbeat-agent03          # 에이전트 3이 동시 작업
```

#### 명명 규칙 상세

- **소문자 + 하이픈** 사용 (`kebab-case`)
- **agent ID suffix**는 병렬 작업 시에만 추가
- **scope**는 모듈/디렉토리 기반 (`auth`, `relay`, `dashboard`, `api`)
- 브랜치명 **50자 이하** 권장
- 일시적 통합 브랜치: `integrate/<sprint>/<date>` 형식

### 2.2 Worktree 생성/삭제 라이프사이클

```
┌──────────────┐
│  Task 할당    │
└──────┬───────┘
       │
       ▼
┌──────────────┐     git worktree add -b feat/scope/desc
│  Worktree    │     ../worktrees/feat-scope-desc main
│  생성        │
└──────┬───────┘
       │
       ▼
┌──────────────┐     cd ../worktrees/feat-scope-desc
│  의존성 설치  │     pnpm install (또는 심볼릭 링크)
└──────┬───────┘
       │
       ▼
┌──────────────┐     개발, 커밋, 테스트
│  작업 수행    │     (독립적 빌드 + 테스트 가능)
└──────┬───────┘
       │
       ▼
┌──────────────┐     git push origin feat/scope/desc
│  Push & PR   │     gh pr create
└──────┬───────┘
       │
       ▼
┌──────────────┐     리뷰, CI 통과 후 머지
│  병합        │
└──────┬───────┘
       │
       ▼
┌──────────────┐     git worktree remove ../worktrees/feat-scope-desc
│  Worktree    │     git branch -d feat/scope/desc
│  삭제/정리   │     git worktree prune
└──────────────┘
```

### 2.3 디렉토리 구조 패턴

#### 패턴 A: 형제 디렉토리 (권장)

```
~/work/
├── life-dashboard/              # 메인 worktree (main)
├── life-dashboard-worktrees/    # 병렬 worktree 루트
│   ├── feat-auth-magic-link/
│   ├── fix-api-timeout/
│   └── refactor-relay-pool/
```

**장점**: 메인 디렉토리 오염 없음, IDE에서 별도 프로젝트로 열기 가능

#### 패턴 B: Bare 리포 중심 (대규모 팀)

```
~/work/
├── life-dashboard.git/          # bare repository
├── life-dashboard-main/         # worktree (main)
├── life-dashboard-dev/          # worktree (develop)
└── life-dashboard-features/
    ├── auth-magic-link/
    └── api-timeout-fix/
```

**장점**: 모든 체크아웃이 동등한 worktree, `main` 브랜치도 교체 가능

#### 패턴 C: 임시 디렉토리 (CI/자동화 전용)

```
/tmp/worktrees/
├── ci-pr-123/                   # PR 검증용
├── ci-pr-456/
└── agent-task-a1b2c3/           # 에이전트 태스크용
```

**장점**: 자동 정리 용이, 시스템 리소스 최소 사용

### 2.4 의존성(node_modules) 관리 전략

Node.js 프로젝트에서 worktree별 `node_modules`는 핵심 이슈:

#### 전략 1: 독립 설치 (안전, 느림)

```bash
git worktree add ../wt/feat-x feat/x
cd ../wt/feat-x && pnpm install
```

- 각 worktree에서 완전 독립 `pnpm install`
- **장점**: 완전한 격리, 의존성 충돌 없음
- **단점**: 디스크 + 시간 소모

#### 전략 2: pnpm 글로벌 스토어 활용 (권장)

```bash
# pnpm은 content-addressable store를 사용하므로
# 여러 worktree에서 같은 패키지는 하드링크로 공유됨
cd ../wt/feat-x && pnpm install  # 빠름 (캐시 히트)
```

- **장점**: pnpm의 하드링크 기반 스토어로 디스크 절약 + 빠른 설치
- **이것이 LifeDashboard에 가장 적합** (이미 pnpm 사용 중)

#### 전략 3: 심볼릭 링크 (위험, 빠름)

```bash
ln -s ../../life-dashboard/node_modules ../wt/feat-x/node_modules
```

- **장점**: 즉시 사용 가능
- **단점**: `package.json` 변경 시 깨짐, 빌드 충돌 가능

### 2.5 자동화 스크립트 예시

```bash
#!/bin/bash
# worktree-create.sh — 새 작업용 worktree 생성

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
WT_BASE="${PROJECT_ROOT}/../$(basename "$PROJECT_ROOT")-worktrees"
BRANCH_TYPE="${1:?Usage: worktree-create.sh <type> <scope> <desc> [base-branch]}"
SCOPE="${2:?}"
DESC="${3:?}"
BASE="${4:-main}"

BRANCH_NAME="${BRANCH_TYPE}/${SCOPE}/${DESC}"
WT_DIR="${WT_BASE}/${BRANCH_TYPE}-${SCOPE}-${DESC}"

# 1. 최신 base 가져오기
git fetch origin "${BASE}"

# 2. worktree 생성
mkdir -p "${WT_BASE}"
git worktree add -b "${BRANCH_NAME}" "${WT_DIR}" "origin/${BASE}"

# 3. 의존성 설치
cd "${WT_DIR}"
pnpm install --frozen-lockfile

# 4. 환경 파일 복사
if [ -f "${PROJECT_ROOT}/.env.local" ]; then
  cp "${PROJECT_ROOT}/.env.local" "${WT_DIR}/.env.local"
fi

echo "✅ Worktree 생성 완료: ${WT_DIR}"
echo "   브랜치: ${BRANCH_NAME}"
echo "   cd ${WT_DIR}"
```

```bash
#!/bin/bash
# worktree-cleanup.sh — 완료된 worktree 정리

set -euo pipefail

WT_DIR="${1:?Usage: worktree-cleanup.sh <worktree-path>}"

if [ ! -d "${WT_DIR}" ]; then
  echo "❌ 디렉토리 없음: ${WT_DIR}"
  exit 1
fi

# 브랜치명 추출
BRANCH=$(git -C "${WT_DIR}" rev-parse --abbrev-ref HEAD)

# worktree 제거
git worktree remove "${WT_DIR}" --force

# 로컬 브랜치 삭제 (머지 확인)
if git branch --merged main | grep -q "${BRANCH}"; then
  git branch -d "${BRANCH}"
  echo "✅ 브랜치 삭제됨: ${BRANCH}"
else
  echo "⚠️  머지되지 않은 브랜치: ${BRANCH} (수동 삭제 필요)"
fi

git worktree prune
echo "✅ Worktree 정리 완료"
```

---

## 3. 멀티에이전트 충돌 최소화 전략

### 3.1 파일 소유권 분할 (File Ownership Partitioning)

**핵심 원칙**: 각 에이전트가 수정하는 파일 집합이 겹치지 않도록 사전 분할

```
Agent 1 (feat/auth)           Agent 2 (feat/dashboard)      Agent 3 (fix/relay)
┌─────────────────────┐      ┌─────────────────────┐      ┌────────────────────┐
│ src/lib/auth.ts     │      │ src/app/page.tsx     │      │ src/lib/relay.ts   │
│ src/lib/resend.ts   │      │ src/app/layout.tsx   │      │ scripts/gateway-*  │
│ src/middleware.ts    │      │ src/components/*     │      │ src/api/relay/*    │
│ src/api/auth/*      │      │ public/*             │      │ src/lib/history.ts │
└─────────────────────┘      └─────────────────────┘      └────────────────────┘
```

#### 소유권 매핑 파일 (`.worktree-ownership.json`)

```json
{
  "version": 1,
  "assignments": {
    "agent-01": {
      "branch": "feat/auth/magic-link",
      "worktree": "../worktrees/feat-auth-magic-link",
      "owned_paths": [
        "src/lib/auth.ts",
        "src/lib/resend.ts",
        "src/middleware.ts",
        "src/app/api/auth/**"
      ],
      "shared_paths": [
        "src/lib/db.ts",
        "package.json"
      ]
    },
    "agent-02": {
      "branch": "feat/dashboard/charts",
      "worktree": "../worktrees/feat-dashboard-charts",
      "owned_paths": [
        "src/app/page.tsx",
        "src/components/**"
      ],
      "shared_paths": [
        "src/lib/db.ts",
        "tailwind.config.ts"
      ]
    }
  },
  "shared_files": {
    "src/lib/db.ts": "coordinate",
    "package.json": "lock",
    "pnpm-lock.yaml": "lock",
    "tailwind.config.ts": "merge-friendly"
  }
}
```

### 3.2 공유 파일 충돌 관리 매트릭스

| 파일 유형 | 충돌 위험 | 전략 | 세부 방법 |
|-----------|-----------|------|-----------|
| `package.json` | **높음** | Lock | 한 에이전트만 수정, 나머지는 rebase |
| `pnpm-lock.yaml` | **매우 높음** | Regenerate | 충돌 시 `pnpm install`로 재생성 |
| DB 스키마 (`sql/*`) | **높음** | Sequential numbering | `005_agent1.sql`, `006_agent2.sql` |
| 환경변수 (`.env.*`) | 중간 | Append-only | 각 에이전트가 자기 변수만 추가 |
| 라우트 (`src/app/api/`) | 낮음 | 디렉토리 분할 | 각자 다른 경로에 파일 생성 |
| 설정 (`*.config.*`) | 중간 | Review-merge | 수동 리뷰 후 병합 |
| 타입 정의 (`types.ts`) | **높음** | Interface segregation | 타입을 모듈별 파일로 분리 |
| 공통 유틸 (`utils.ts`) | 중간 | Additive-only | 기존 함수 수정 금지, 새 함수만 추가 |

### 3.3 충돌 방지 아키텍처 패턴

#### 패턴 1: 모듈 경계 기반 분할

```
src/
├── modules/
│   ├── auth/           # Agent 1 전용
│   │   ├── index.ts
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── auth.types.ts
│   ├── dashboard/      # Agent 2 전용
│   │   ├── index.ts
│   │   ├── dashboard.service.ts
│   │   └── dashboard.types.ts
│   └── relay/          # Agent 3 전용
│       ├── index.ts
│       ├── relay.service.ts
│       └── relay.types.ts
├── shared/             # 공유 (변경 시 조율 필요)
│   ├── db.ts
│   ├── config.ts
│   └── types/
│       ├── auth.d.ts   # Agent 1만 수정
│       ├── dashboard.d.ts  # Agent 2만 수정
│       └── common.d.ts    # 변경 금지 (frozen)
└── app/
    └── api/            # 라우트별 자동 분리
```

#### 패턴 2: 기능 플래그(Feature Flag) 기반 격리

```typescript
// src/lib/feature-flags.ts
export const features = {
  AUTH_MAGIC_LINK: process.env.FF_AUTH_MAGIC_LINK === 'true',    // Agent 1
  DASHBOARD_CHARTS: process.env.FF_DASHBOARD_CHARTS === 'true',  // Agent 2
  RELAY_V2: process.env.FF_RELAY_V2 === 'true',                  // Agent 3
} as const;
```

각 에이전트가 feature flag 뒤에서 코드를 작성하면, 같은 파일을 수정해도 충돌 가능성이 감소:

```typescript
// src/app/page.tsx - 여러 에이전트가 안전하게 수정 가능
export default function Home() {
  return (
    <main>
      <ExistingContent />
      {features.DASHBOARD_CHARTS && <ChartWidget />}   {/* Agent 2 추가 */}
      {features.AUTH_MAGIC_LINK && <LoginStatus />}     {/* Agent 1 추가 */}
    </main>
  );
}
```

#### 패턴 3: 인터페이스 계약 (Contract-First)

병렬 작업 전 공유 인터페이스를 먼저 정의하고 freeze:

```typescript
// contracts/auth-api.ts (frozen — 작업 시작 전 합의)
export interface AuthAPI {
  login(email: string): Promise<{ token: string }>;
  verify(token: string): Promise<{ userId: string }>;
  logout(): Promise<void>;
}
```

각 에이전트는 자신의 구현체만 작성하며, 인터페이스 변경은 별도 PR로 처리.

### 3.4 Locking 메커니즘

#### Git LFS 스타일 파일 잠금

```bash
# 특정 파일 잠금 (GitHub/GitLab에서 지원)
git lfs lock src/lib/db.ts --reason "Agent-01: schema migration"

# 잠금 해제
git lfs unlock src/lib/db.ts
```

#### 소프트 잠금 (Advisory Lock via 파일)

```json
// .worktree-locks.json (메인 worktree에서 관리)
{
  "locks": [
    {
      "path": "package.json",
      "holder": "agent-01",
      "worktree": "feat-auth-magic-link",
      "acquired_at": "2026-02-25T10:00:00Z",
      "reason": "Adding jose dependency"
    }
  ]
}
```

### 3.5 Rebase vs Merge 전략

| 상황 | 전략 | 이유 |
|------|------|------|
| 단기 작업 (< 1일) | Rebase | 깨끗한 히스토리 |
| 장기 작업 (> 1일) | 주기적 Merge from main | 충돌 조기 발견 |
| 여러 에이전트 동시 완료 | Merge queue | 순서 보장 |
| 공유 파일 수정 포함 | Rebase + 수동 검증 | 충돌 가시성 확보 |

```bash
# 권장: 작업 중 주기적으로 main 동기화
cd ../worktrees/feat-auth
git fetch origin main
git rebase origin/main

# 충돌 발생 시 → 해결 후 계속
git rebase --continue
```

---

## 4. 병합 시 Conflict Resolution 자동화

### 4.1 Git Merge Driver 설정

`.gitattributes` 파일로 파일별 머지 전략을 선언:

```gitattributes
# 자동 생성 파일 — "ours" 전략 (충돌 시 현재 브랜치 유지 후 재생성)
pnpm-lock.yaml merge=ours-then-regenerate
package-lock.json merge=ours-then-regenerate

# JSON 설정 — union 머지 (양쪽 모두 포함)
*.json merge=union

# SQL 마이그레이션 — 순서 보장 (충돌 시 실패)
sql/*.sql merge=fail-loudly

# Tailwind / PostCSS — 수동 머지 필수
tailwind.config.ts merge=manual-required
```

커스텀 merge driver 등록:

```gitconfig
# .git/config 또는 ~/.gitconfig
[merge "ours-then-regenerate"]
    name = Keep ours, then regenerate
    driver = true
    # true = 항상 "ours" 선택, 이후 CI에서 pnpm install로 재생성

[merge "fail-loudly"]
    name = Fail on conflict (manual resolution required)
    driver = false
```

### 4.2 자동 Conflict Resolution 스크립트

```bash
#!/bin/bash
# auto-resolve-conflicts.sh — 파일 유형별 자동 충돌 해결

set -euo pipefail

CONFLICTED_FILES=$(git diff --name-only --diff-filter=U)

if [ -z "${CONFLICTED_FILES}" ]; then
  echo "✅ 충돌 없음"
  exit 0
fi

for FILE in ${CONFLICTED_FILES}; do
  case "${FILE}" in
    pnpm-lock.yaml|package-lock.json|yarn.lock)
      echo "🔄 ${FILE}: lockfile 재생성으로 해결"
      git checkout --theirs "${FILE}"
      git add "${FILE}"
      # 병합 후 pnpm install로 재생성
      NEEDS_LOCKFILE_REGEN=true
      ;;

    *.generated.ts|*.generated.js)
      echo "🔄 ${FILE}: 생성 파일 — theirs 채택 후 재생성 예정"
      git checkout --theirs "${FILE}"
      git add "${FILE}"
      ;;

    sql/[0-9]*.sql)
      echo "❌ ${FILE}: 마이그레이션 파일 충돌 — 수동 해결 필요"
      MANUAL_REQUIRED=true
      ;;

    package.json)
      echo "🔧 ${FILE}: package.json 자동 머지 시도"
      # npm-merge-driver 또는 커스텀 JSON 머지
      if command -v npx &> /dev/null; then
        npx json-merge-patch resolve "${FILE}" || MANUAL_REQUIRED=true
      else
        MANUAL_REQUIRED=true
      fi
      ;;

    *)
      echo "⚠️  ${FILE}: 자동 해결 불가 — 수동 해결 필요"
      MANUAL_REQUIRED=true
      ;;
  esac
done

if [ "${NEEDS_LOCKFILE_REGEN:-false}" = true ]; then
  echo "🔄 Lockfile 재생성 중..."
  pnpm install --no-frozen-lockfile
  git add pnpm-lock.yaml
fi

if [ "${MANUAL_REQUIRED:-false}" = true ]; then
  echo ""
  echo "❌ 일부 파일은 수동 해결이 필요합니다:"
  git diff --name-only --diff-filter=U
  exit 1
fi

echo "✅ 모든 충돌 자동 해결 완료"
```

### 4.3 Semantic Conflict Detection

코드 상의 텍스트 충돌은 없지만 **의미적으로 충돌하는 경우** 감지:

```bash
#!/bin/bash
# semantic-conflict-check.sh — 병합 후 의미적 충돌 감지

set -euo pipefail

echo "🔍 의미적 충돌 감지 시작..."

# 1. 타입 검사
echo "  [1/4] TypeScript 타입 검사..."
if ! pnpm tsc --noEmit 2>/dev/null; then
  echo "  ❌ 타입 에러 발견 — 인터페이스 충돌 가능"
  exit 1
fi

# 2. 빌드 테스트
echo "  [2/4] 빌드 테스트..."
if ! pnpm build 2>/dev/null; then
  echo "  ❌ 빌드 실패 — import/export 충돌 가능"
  exit 1
fi

# 3. 단위 테스트
echo "  [3/4] 테스트 실행..."
if ! pnpm test --run 2>/dev/null; then
  echo "  ❌ 테스트 실패 — 로직 충돌 가능"
  exit 1
fi

# 4. 린트
echo "  [4/4] 린트 검사..."
if ! pnpm lint 2>/dev/null; then
  echo "  ⚠️  린트 경고 — 스타일 충돌 가능"
fi

echo "✅ 의미적 충돌 감지 완료 — 이상 없음"
```

### 4.4 GitHub Merge Queue 활용

GitHub Merge Queue는 병렬 PR들을 순서대로 테스트하고 머지:

```yaml
# .github/branch-protection-rules
# Settings > Branches > main > "Require merge queue"

# merge queue 활성화 시:
# 1. PR이 "Ready to merge"되면 큐에 진입
# 2. 큐 순서대로 main에 임시 병합 후 CI 실행
# 3. CI 통과 → 실제 머지
# 4. CI 실패 → 큐에서 제거, 후속 PR 재테스트
```

### 4.5 자동 Rebase Bot

```yaml
# .github/workflows/auto-rebase.yml
name: Auto Rebase on Main Update

on:
  push:
    branches: [main]

jobs:
  rebase-prs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Rebase open PRs
        run: |
          # 열린 PR의 브랜치 목록
          BRANCHES=$(gh pr list --json headRefName -q '.[].headRefName')

          for BRANCH in $BRANCHES; do
            echo "🔄 Rebasing ${BRANCH}..."
            git checkout "${BRANCH}"

            if git rebase origin/main; then
              git push --force-with-lease origin "${BRANCH}"
              echo "  ✅ ${BRANCH} rebase 성공"
            else
              git rebase --abort
              gh pr comment "${BRANCH}" --body "⚠️ Auto-rebase 실패. 수동 충돌 해결 필요."
              echo "  ❌ ${BRANCH} rebase 실패"
            fi
          done
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 5. CI/CD 파이프라인 통합

### 5.1 Worktree 기반 CI 파이프라인 아키텍처

```
                    ┌─────────────────────────┐
                    │  GitHub / Git Server     │
                    └─────────┬───────────────┘
                              │ webhook
                    ┌─────────▼───────────────┐
                    │  CI Runner               │
                    │  ┌───────────────────┐   │
                    │  │ Bare Repo Clone   │   │
                    │  │ (shared objects)  │   │
                    │  └─────────┬─────────┘   │
                    │            │              │
                    │    ┌───────┼───────┐      │
                    │    │       │       │      │
                    │  ┌─▼─┐  ┌─▼─┐  ┌─▼─┐    │
                    │  │WT1│  │WT2│  │WT3│    │  ← 병렬 테스트
                    │  │PR1│  │PR2│  │PR3│    │
                    │  └───┘  └───┘  └───┘    │
                    └─────────────────────────┘
```

### 5.2 GitHub Actions 통합 예시

#### 기본: PR별 Worktree 테스트

```yaml
# .github/workflows/pr-test.yml
name: PR Test with Worktree

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # worktree에 필요한 전체 히스토리

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install & Test
        run: |
          pnpm install --frozen-lockfile
          pnpm build
          pnpm test
```

#### 고급: 병렬 PR 검증 (Matrix + Worktree)

```yaml
# .github/workflows/parallel-pr-validation.yml
name: Parallel PR Validation

on:
  merge_group:  # Merge Queue 트리거
  workflow_dispatch:
    inputs:
      pr_numbers:
        description: 'Comma-separated PR numbers'
        required: true

jobs:
  validate-prs:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        pr: ${{ fromJson(github.event.inputs.pr_numbers || '[]') }}
      fail-fast: false  # 하나 실패해도 나머지 계속

    steps:
      - name: Checkout base
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - name: Create worktree for PR
        run: |
          PR_BRANCH=$(gh pr view ${{ matrix.pr }} --json headRefName -q '.headRefName')
          git fetch origin "${PR_BRANCH}"
          git worktree add /tmp/pr-${{ matrix.pr }} "origin/${PR_BRANCH}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Test in worktree
        working-directory: /tmp/pr-${{ matrix.pr }}
        run: |
          pnpm install --frozen-lockfile
          pnpm build
          pnpm test

      - name: Integration test (merge with main)
        working-directory: /tmp/pr-${{ matrix.pr }}
        run: |
          git merge origin/main --no-edit || {
            echo "::error::PR #${{ matrix.pr }} has merge conflicts with main"
            exit 1
          }
          pnpm build
          pnpm test

      - name: Cleanup
        if: always()
        run: |
          git worktree remove /tmp/pr-${{ matrix.pr }} --force || true
          git worktree prune
```

### 5.3 로컬 CI 시뮬레이션

```bash
#!/bin/bash
# local-ci-parallel.sh — 로컬에서 여러 PR을 병렬 검증

set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel)
TEMP_BASE="/tmp/worktree-ci-$$"
PIDS=()
RESULTS=()

# 열린 PR 브랜치들 가져오기
BRANCHES=$(gh pr list --json headRefName -q '.[].headRefName')

echo "📋 검증 대상 브랜치:"
echo "${BRANCHES}" | while read -r b; do echo "  - ${b}"; done

# 각 브랜치를 worktree로 생성하고 병렬 테스트
for BRANCH in ${BRANCHES}; do
  WT_DIR="${TEMP_BASE}/${BRANCH//\//-}"

  (
    git fetch origin "${BRANCH}"
    git worktree add "${WT_DIR}" "origin/${BRANCH}" 2>/dev/null
    cd "${WT_DIR}"

    # main과 병합 시도
    git merge origin/main --no-edit 2>/dev/null || {
      echo "❌ ${BRANCH}: merge conflict"
      exit 1
    }

    # 테스트
    pnpm install --frozen-lockfile 2>/dev/null
    pnpm build 2>/dev/null && pnpm test --run 2>/dev/null

    if [ $? -eq 0 ]; then
      echo "✅ ${BRANCH}: PASSED"
    else
      echo "❌ ${BRANCH}: FAILED"
    fi
  ) &

  PIDS+=($!)
done

# 모든 프로세스 완료 대기
for PID in "${PIDS[@]}"; do
  wait "${PID}" || true
done

# 정리
for BRANCH in ${BRANCHES}; do
  WT_DIR="${TEMP_BASE}/${BRANCH//\//-}"
  git worktree remove "${WT_DIR}" --force 2>/dev/null || true
done
git worktree prune

echo ""
echo "🏁 병렬 검증 완료"
```

### 5.4 Docker + Worktree 통합

```dockerfile
# Dockerfile.ci-worktree
FROM node:20-alpine

RUN apk add --no-cache git
RUN corepack enable pnpm

WORKDIR /repo

# Bare clone으로 object store 공유
RUN git clone --bare https://github.com/user/life-dashboard.git .git

# 여러 worktree 생성 가능한 스크립트
COPY ci-scripts/parallel-test.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/parallel-test.sh

ENTRYPOINT ["parallel-test.sh"]
```

### 5.5 Railway 배포와 Worktree (LifeDashboard 특화)

```yaml
# railway.toml 확장
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

# Worktree 기반 스테이징 환경 자동 생성
# Railway Preview Environments가 이 역할을 대체할 수 있음
```

병렬 PR에 대한 Preview Environment:

```bash
# 각 PR에 대해 Railway preview 생성
gh pr list --json number,headRefName | jq -r '.[] | "\(.number) \(.headRefName)"' | \
while read PR_NUM BRANCH; do
  # Railway Preview Environment 트리거
  # railway up --environment "pr-${PR_NUM}"
  echo "Preview: pr-${PR_NUM} → ${BRANCH}"
done
```

---

## 6. LifeDashboard 적용 방안

### 6.1 현재 아키텍처와 Worktree 매핑

LifeDashboard의 모듈 구조를 기반으로 한 병렬 작업 분할:

| 모듈 | 핵심 파일 | 에이전트 할당 | 충돌 위험 |
|------|-----------|--------------|-----------|
| Auth | `src/lib/auth.ts`, `src/lib/resend.ts`, `src/middleware.ts` | Agent A | 낮음 |
| Relay | `src/lib/relay.ts`, `scripts/gateway-*`, `scripts/claude-executor.ts` | Agent B | 낮음 |
| Dashboard UI | `src/app/page.tsx`, `src/components/*` | Agent C | 중간 |
| History/Messages | `src/lib/history.ts`, `src/lib/messages.ts` | Agent D | 낮음 |
| DB/Storage | `src/lib/db.ts`, `src/lib/storage.ts`, `sql/*` | 공유 (Lock) | **높음** |
| Config | `package.json`, `next.config.*`, `tailwind.config.*` | 공유 (Lock) | **높음** |

### 6.2 Gateway Connector + Worktree 통합

현재 LifeDashboard의 relay 시스템은 에이전트에게 태스크를 spawn하는 구조. Worktree와 통합하면:

```
Dashboard (Relay Command)
    │
    ▼
Gateway Connector
    │
    ├── Task A: feat/auth → worktree A에서 실행
    ├── Task B: feat/ui   → worktree B에서 실행
    └── Task C: fix/relay → worktree C에서 실행
         │
         ▼
    각 에이전트는 자신의 worktree에서
    독립적으로 코드 수정 + 커밋 + push
```

Gateway connector의 `spawn` 커맨드에 worktree 지원 추가 아이디어:

```typescript
// 개념적 확장 (현재 구현에는 없음)
interface SpawnWithWorktree extends RelayCommand {
  type: "spawn";
  payload: {
    agentId: string;
    task: string;
    worktree?: {
      branch: string;
      baseBranch?: string;  // default: main
      ownedPaths: string[];
    };
  };
}
```

### 6.3 Tmux + Worktree 모니터링

기존 tmux 모니터링 시스템과 결합:

```
tmux session: ld-agent-auth
  └── cwd: ../worktrees/feat-auth-magic-link

tmux session: ld-agent-dashboard
  └── cwd: ../worktrees/feat-dashboard-charts

tmux session: ld-agent-relay
  └── cwd: ../worktrees/fix-relay-heartbeat
```

`pnpm monitor`로 각 에이전트의 worktree 상태까지 확인 가능.

### 6.4 권장 워크플로우

```
1. 작업 계획  │  Dashboard에서 병렬 태스크 정의
              │  각 태스크에 모듈/파일 범위 지정
              │
2. 환경 준비  │  worktree-create.sh로 각 에이전트 worktree 생성
              │  pnpm install (pnpm store 공유로 빠른 설치)
              │  .env.local 복사
              │
3. 병렬 실행  │  Gateway → 각 에이전트를 해당 worktree에서 spawn
              │  tmux으로 실시간 모니터링
              │  소유권 파일로 충돌 방지
              │
4. 통합       │  각 에이전트가 PR 생성
              │  Merge Queue로 순서 보장
              │  semantic-conflict-check.sh 실행
              │
5. 정리       │  worktree-cleanup.sh로 일괄 정리
              │  git worktree prune
```

---

## 7. 참고 자료 및 관련 도구

### 7.1 관련 도구/프로젝트

| 도구 | 설명 | 링크 |
|------|------|------|
| **CCPM** | Claude Code Project Manager — GitHub Issues + Git Worktree 기반 병렬 에이전트 실행 | github.com/automazeio/ccpm |
| **oh-my-claudecode (ultrapilot)** | Worktree 기반 파일 소유권 분할 병렬 실행 | `.omc/state/ultrapilot-ownership.json` |
| **git-town** | Git 워크플로우 자동화 (sync, ship, hack) | github.com/git-town/git-town |
| **git-branchless** | 스태킹 워크플로우 + 대화형 rebase | github.com/arxanas/git-branchless |
| **Graphite** | Stacked PRs 관리 + Merge Queue | graphite.dev |
| **Aviator MergeQueue** | 고급 Merge Queue SaaS | aviator.co |
| **npm-merge-driver** | package.json 자동 머지 | npmjs.com/npm-merge-driver |
| **git-assembler** | 여러 브랜치의 자동 조합 빌드 | github.com/wmanley/git-assembler |

### 7.2 핵심 Git 설정

```gitconfig
# ~/.gitconfig — worktree 친화적 설정

[core]
    # worktree 간 공유 가능한 fsmonitor
    fsmonitor = true
    untrackedCache = true

[worktree]
    # worktree 이름 표시
    guessRemote = true

[rerere]
    # 반복 충돌 자동 해결 (REuse REcorded REsolution)
    enabled = true
    autoUpdate = true

[merge]
    # 3-way 머지 + 충돌 시 diff3 마커
    conflictStyle = zdiff3

[rebase]
    # rebase 시 자동 squash/fixup
    autoSquash = true
    autoStash = true

[fetch]
    # fetch 시 prune
    prune = true
    pruneTags = true

[pull]
    # pull 시 rebase 기본
    rebase = true
```

### 7.3 주의사항 및 알려진 제한

| 제한 | 설명 | 우회 방법 |
|------|------|-----------|
| 같은 브랜치 체크아웃 불가 | 두 worktree가 동일 브랜치 불가 | 에이전트별 고유 브랜치 사용 |
| submodule 지원 제한 | worktree에서 submodule 동작 불안정 | `git submodule update` 수동 실행 |
| Sparse checkout 호환성 | 일부 Git 버전에서 불안정 | Git 2.40+ 사용 |
| IDE 인식 | 일부 IDE가 worktree를 별도 프로젝트로 인식 못함 | VSCode에서는 폴더 직접 열기 |
| hooks 공유 | `.git/hooks`가 공유됨 (의도치 않은 효과) | `.husky`나 lint-staged로 관리 |
| `node_modules` 크기 | 각 worktree에 독립 설치 필요 | pnpm store 공유로 완화 |
| `git gc` 주의 | Worktree가 참조하는 객체 삭제 위험 | `prune --expire=never` 사용 |
| 디스크 IO | 많은 worktree는 IO 병목 | SSD 필수, 5개 이하 권장 |

### 7.4 성능 벤치마크 가이드

| 지표 | 측정 방법 | 목표 |
|------|-----------|------|
| Worktree 생성 시간 | `time git worktree add ...` | < 2초 |
| 의존성 설치 (pnpm, 캐시 히트) | `time pnpm install` | < 15초 |
| 동시 worktree 수 | `git worktree list \| wc -l` | ≤ 5개 |
| 디스크 사용량/worktree | `du -sh ../worktrees/feat-*` | < 500MB |
| 병렬 빌드 시간 | `time parallel-build.sh` | 순차 대비 40-70% 감소 |

---

## 요약: 핵심 원칙

1. **파일 소유권 분할이 가장 중요하다** — 충돌 방지의 80%는 사전 분할에서 나온다
2. **pnpm + worktree 조합이 Node.js 프로젝트 최적** — content-addressable store가 디스크 절약
3. **lockfile은 항상 재생성** — `pnpm-lock.yaml` 충돌을 merge로 해결하지 말 것
4. **Merge Queue 사용 필수** — 병렬 PR의 순차적 통합 보장
5. **Semantic conflict detection** — 텍스트 충돌 없어도 빌드/테스트로 검증
6. **git rerere 활성화** — 반복 충돌 패턴을 자동 학습
7. **5개 이하 동시 worktree** — IO 병목과 관리 복잡성 한계
8. **정리를 자동화하라** — 머지 후 worktree 삭제를 CI에 포함
