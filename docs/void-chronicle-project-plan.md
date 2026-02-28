# Void Chronicle - 프로젝트 계획서

## 📋 프로젝트 개요

**프로젝트명**: Void Chronicle
**장르**: 2D 로그라이크 RPG
**기술스택**: Phaser 3 + TypeScript + Vite
**플랫폼**: 웹 기반 (모바일 대응 가능)
**상태**: Idea (기획 단계)

---

## 🎯 프로젝트 목표

1. **웹 기반 로그라이크 게임 개발** - Phaser 3를 사용한 2D 게임
2. **모바일 친화적 UI/UX** - 터치 컨트롤 지원
3. **Life Dashboard 통합** - 개발 진행 상황 실시간 추적

---

## 🛠️ 기술 스택

### Core
- **Phaser 3** - 2D 게임 프레임워크
- **TypeScript** - 정적 타입 언어
- **Vite** - 빌드 도구 (빠른 HMR)

### 개발 도구
- **ESLint** - 코드 품질 검사
- **Prettier** - 코드 포맷팅
- **Vitest** - 유닛 테스트

### 배포
- **Vercel / Netlify** - 정적 호스팅
- **GitHub Pages** - 대체 배포 옵션

---

## 🎮 게임 디자인 (초안)

### 코어 메커니즘
1. **로그라이크 요소**
   - 랜덤 생성 던전
   - 영구 죽음 (permadeath)
   - 메타 프로그레션 시스템

2. **전투 시스템**
   - 턴 기반 또는 실시간 액션 (결정 필요)
   - 스킬 트리
   - 아이템 시스템

3. **진행 시스템**
   - 언락 가능한 캐릭터
   - 영구 업그레이드
   - 업적 시스템

### 게임 루프
```
시작 → 캐릭터 선택 → 던전 진입 → 전투 → 아이템/골드 획득 → 상점/업그레이드 → 다음 층 → 반복
```

---

## 📁 프로젝트 구조 (예상)

```
void-chronicle/
├── src/
│   ├── scenes/          # Phaser 씬
│   │   ├── BootScene.ts
│   │   ├── MainMenuScene.ts
│   │   ├── GameScene.ts
│   │   └── UIScene.ts
│   ├── entities/        # 게임 엔티티
│   │   ├── Player.ts
│   │   ├── Enemy.ts
│   │   └── Item.ts
│   ├── systems/         # 게임 시스템
│   │   ├── CombatSystem.ts
│   │   ├── InventorySystem.ts
│   │   └── DungeonGenerator.ts
│   ├── config/          # 게임 설정
│   │   └── gameConfig.ts
│   └── main.ts          # 엔트리 포인트
├── public/
│   └── assets/          # 게임 에셋
│       ├── sprites/
│       ├── audio/
│       └── fonts/
├── tests/               # 테스트
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🚀 개발 단계

### Phase 1: 프로젝트 셋업 (1일)
- [ ] Vite + TypeScript + Phaser 3 프로젝트 초기화
- [ ] ESLint, Prettier 설정
- [ ] Git 저장소 생성
- [ ] Life Dashboard에 프로젝트 등록

### Phase 2: 기본 게임 루프 (3-5일)
- [ ] BootScene: 에셋 로딩
- [ ] MainMenuScene: 메인 메뉴 UI
- [ ] GameScene: 기본 플레이어 이동
- [ ] 키보드/터치 입력 처리

### Phase 3: 던전 생성 (5-7일)
- [ ] 랜덤 던전 생성 알고리즘 (BSP 또는 Cellular Automata)
- [ ] 타일맵 렌더링
- [ ] 충돌 감지

### Phase 4: 전투 시스템 (7-10일)
- [ ] 적 AI
- [ ] 전투 메커니즘
- [ ] 체력/스탯 시스템
- [ ] 죽음 처리

### Phase 5: 아이템 & 진행 시스템 (5-7일)
- [ ] 아이템 생성 및 획득
- [ ] 인벤토리 UI
- [ ] 메타 프로그레션 (영구 업그레이드)

### Phase 6: 폴리싱 & 배포 (3-5일)
- [ ] 사운드 이펙트
- [ ] UI/UX 개선
- [ ] 모바일 최적화
- [ ] 배포

---

## 📊 KPI 설정

1. **개발 진행률** - 완료된 Phase / 전체 Phase
2. **코드 커버리지** - 테스트 커버리지 목표: 60%+
3. **빌드 성공률** - CI/CD 빌드 성공률 목표: 95%+
4. **배포 주기** - 주 1회 이상 배포

---

## 🔗 참고 자료

### Phaser 3 공식 문서
- [Phaser 3 Official](https://phaser.io/phaser3)
- [Phaser 3 Examples](https://phaser.io/examples)
- [Phaser 3 TypeScript Template](https://github.com/photonstorm/phaser3-typescript-project-template)

### 로그라이크 개발 참고
- [RogueBasin](http://www.roguebasin.com/)
- [Dungeon Generation Algorithms](https://www.gridsagegames.com/blog/2014/06/procedural-map-generation/)

### TypeScript + Phaser 튜토리얼
- [Making a Phaser 3 Game with TypeScript](https://blog.ourcade.co/posts/2020/make-first-phaser-3-game-modern-javascript/)

---

## 📝 다음 단계

1. **Life Dashboard에 프로젝트 등록**
   - MCP 서버 재시작 후 `dashboard_create_project` 도구 사용
   - 또는 대시보드 UI에서 수동 등록

2. **프로젝트 디렉토리 생성**
   - `/Users/hanchi/work/void-chronicle` 디렉토리 생성
   - Vite + TypeScript + Phaser 3 템플릿 초기화

3. **초기 개발 환경 설정**
   - package.json 작성
   - tsconfig.json 설정
   - vite.config.ts 설정
   - 첫 번째 씬 구현 (BootScene)

---

## 💡 의사결정 필요 사항

### 1. 전투 시스템 타입
- **옵션 A**: 턴 기반 (전통적 로그라이크, 전략적)
- **옵션 B**: 실시간 액션 (빠른 템포, 스킬 기반)

### 2. 아트 스타일
- **옵션 A**: 픽셀 아트 (제작 용이, 로그라이크 전통)
- **옵션 B**: 벡터 그래픽 (확장성, 모던한 느낌)

### 3. 초기 MVP 범위
- **최소 기능**: 플레이어 이동 + 랜덤 던전 + 기본 전투 + 죽음
- **추가 고려**: 아이템, 스킬, 메타 프로그레션

---

**작성일**: 2026-02-28
**작성자**: Claude (analyst agent)
