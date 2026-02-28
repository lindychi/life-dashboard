# 📊 LifeDashboard

> 사업/프로젝트/재정 전체를 한눈에 조감하는 개인 대시보드

## 🎯 목적

- 여러 사이드 프로젝트 상태 추적
- KPI 모니터링 (유저 수, 매출 등)
- 재정/FIRE 진행률 트래킹
- 목표/OKR 관리

## 📋 추적 대상 프로젝트

1. **MumMum** - 영어 학습 앱
2. **Rezoom** - 이력서 서비스
3. **정화의 영역** - 게임 (Godot)
4. **안부** - 앱 예정
5. **크레딧컨설팅** - 재정/FIRE

## 🛠 기술 스택

- **Framework**: Next.js 16
- **Styling**: Tailwind CSS 4
- **Database**: Supabase (예정)
- **Deployment**: Railway
- **Mobile**: PWA

## 🚀 MVP 기능

- [ ] 프로젝트별 상태/진행률 카드
- [ ] KPI 대시보드
- [ ] 재정 트래커
- [ ] 목표/OKR 트래킹
- [ ] 모바일 반응형 (PWA)

## 📦 설치 및 실행

```bash
pnpm install
pnpm dev
```

## 🧪 테스트 및 TDD Workflow

이 프로젝트는 **Test-Driven Development (TDD)** 원칙을 따릅니다.

### 테스트 실행

```bash
# 전체 테스트 실행
pnpm test

# Watch 모드 (개발 중)
pnpm test:watch

# Coverage 리포트 생성
pnpm test:coverage

# TDD 검증 (git commit 시 자동 실행)
pnpm test:tdd
```

### Pre-commit Hook (자동 테스트)

Git commit 시 자동으로 테스트가 실행됩니다:

```bash
# 설정 (최초 1회)
pnpm tdd:setup

# 이후 commit 시 자동 실행
git commit -m "feat: new feature"
# → 자동으로 pnpm test:tdd 실행
# → 테스트 실패 시 commit 차단
```

### TDD 프로세스

**Interactive TDD Workflow Tool (권장):**

```bash
pnpm tdd
```

대화형 메뉴에서 선택:
1. 새 테스트 파일 생성 (Red phase)
2. Watch 모드로 테스트 실행 (Green phase)
3. Coverage 확인 (Refactor phase)
4. 전체 TDD 사이클 실행

**Manual TDD Workflow:**

1. **Red**: 실패하는 테스트 먼저 작성
   ```bash
   # src/lib/__tests__/new-feature.test.ts 작성
   pnpm test:watch
   ```

2. **Green**: 최소한의 코드로 테스트 통과
   ```bash
   # src/lib/new-feature.ts 구현
   ```

3. **Refactor**: 리팩토링 (테스트는 계속 통과)
   ```bash
   # 코드 개선 → 테스트 재실행
   ```

### Coverage 목표

- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 75%
- **Statements**: 80%

Coverage threshold는 `vitest.config.ts`에서 설정됩니다.

### TDD Guidelines

자세한 TDD 가이드라인과 Best Practices는 다음 문서를 참조하세요:

- **[TDD Guidelines](docs/TDD_GUIDELINES.md)** - 전체 TDD 프로세스, 체크리스트, 패턴 및 안티패턴
- **[CLAUDE.md](CLAUDE.md)** - 프로젝트 구조 및 아키텍처 설명

## 🚢 배포

Railway에 자동 배포됩니다.

---

*개인 프로젝트입니다.*
