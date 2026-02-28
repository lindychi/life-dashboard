# Void Chronicle - 다음 단계 가이드

## ✅ 완료된 작업

1. **MCP 서버에 프로젝트 CRUD 도구 추가**
   - `dashboard_get_projects`, `dashboard_create_project`, `dashboard_update_project`, `dashboard_delete_project` 도구 구현
   - 스키마 정의 및 핸들러 추가 완료

2. **프로젝트 기획 문서 작성**
   - `void-chronicle-project-plan.md` - 전체 프로젝트 계획
   - `void-chronicle-game-design.md` - 게임 디자인 문서 (GDD)
   - `void-chronicle-project-structure.md` - 프로젝트 구조 및 아키텍처
   - `void-chronicle-setup-files.md` - 초기 설정 파일 템플릿

3. **기술 스택 확정**
   - Phaser 3 (게임 엔진)
   - TypeScript (언어)
   - Vite (빌드 도구)
   - Vitest (테스트)

---

## 🚀 다음 단계 (우선순위 순)

### Step 1: Life Dashboard에 프로젝트 등록

#### 방법 A: MCP 서버 재시작 후 도구 사용 (권장)
```bash
# 1. MCP 서버 재시작
# Claude Code에서 MCP 서버가 자동으로 재시작됩니다.

# 2. MCP 도구로 프로젝트 생성
# Claude Code에서 다음 명령 실행:
```

MCP 도구 사용 예시:
```typescript
mcp__life-dashboard__dashboard_create_project({
  name: "Void Chronicle",
  description: "무한한 어둠 속에서 길을 찾는 2D 로그라이크 액션 RPG. Phaser 3 + TypeScript로 제작.",
  status: "in-progress",
  progress: 10,
  url: "https://github.com/yourusername/void-chronicle",
  kpis: [
    { label: "개발 진행률", value: "10%" },
    { label: "Phase 완료", value: "0/6" },
    { label: "코드 커버리지", value: "0%" }
  ]
})
```

#### 방법 B: Life Dashboard UI에서 수동 등록
```
1. http://localhost:3000 접속
2. Projects 탭 클릭
3. "New Project" 버튼 클릭
4. 정보 입력:
   - Name: Void Chronicle
   - Description: 무한한 어둠 속에서 길을 찾는 2D 로그라이크 액션 RPG
   - Status: in-progress
   - Progress: 10
5. 저장
```

---

### Step 2: 프로젝트 디렉토리 생성

```bash
# 프로젝트 디렉토리 생성
cd ~/work
mkdir void-chronicle
cd void-chronicle

# Git 저장소 초기화
git init
git add .
git commit -m "Initial commit"
```

---

### Step 3: 초기 프로젝트 설정

#### 3-1. package.json 생성
`docs/void-chronicle-setup-files.md`의 `package.json` 내용을 복사하여 생성

```bash
cd ~/work/void-chronicle
# package.json 파일 생성 (내용은 setup-files.md 참조)
```

#### 3-2. 의존성 설치
```bash
pnpm install
# 또는
npm install
```

#### 3-3. TypeScript 설정
- `tsconfig.json` 생성
- `tsconfig.node.json` 생성

#### 3-4. Vite 설정
- `vite.config.ts` 생성

#### 3-5. 코드 품질 도구 설정
- `.eslintrc.json` 생성
- `.prettierrc` 생성
- `.gitignore` 생성

---

### Step 4: 기본 프로젝트 구조 생성

```bash
cd ~/work/void-chronicle

# 디렉토리 생성
mkdir -p src/{scenes,entities,systems,ui,utils,config,data,types,ai}
mkdir -p src/entities/{base,player,enemies,items}
mkdir -p src/systems/{combat,inventory,dungeon,skill,progression}
mkdir -p src/ui/{components,managers}
mkdir -p src/ai/{behaviors,pathfinding}
mkdir -p public/assets/{sprites,tilesets,ui,audio,fonts}
mkdir -p public/assets/sprites/{player,enemies,items}
mkdir -p public/assets/audio/{music,sfx}
mkdir -p tests/{unit,e2e}

# index.html 생성
# src/main.ts 생성
```

---

### Step 5: 첫 번째 씬 구현 (BootScene)

#### 5-1. 게임 설정 파일 작성
`src/config/gameConfig.ts`:
```typescript
import Phaser from 'phaser';
import { BootScene } from '@scenes/BootScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#000000',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};
```

#### 5-2. BootScene 작성
`src/scenes/BootScene.ts`:
```typescript
import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // TODO: 에셋 로딩
    console.log('BootScene: Loading assets...');
  }

  create() {
    console.log('BootScene: Assets loaded!');

    // 임시 테스트 텍스트
    this.add.text(400, 300, 'Void Chronicle', {
      fontSize: '48px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(400, 360, 'Press any key to start', {
      fontSize: '24px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    // 키 입력 대기
    this.input.keyboard?.once('keydown', () => {
      console.log('Key pressed - Starting game...');
      // TODO: 다음 씬으로 전환
    });
  }
}
```

#### 5-3. 메인 엔트리 작성
`src/main.ts`:
```typescript
import Phaser from 'phaser';
import { gameConfig } from '@config/gameConfig';

// Loading 화면 숨기기
window.addEventListener('load', () => {
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('hidden');
  }

  // 게임 시작
  new Phaser.Game(gameConfig);
});
```

---

### Step 6: 개발 서버 실행 및 테스트

```bash
cd ~/work/void-chronicle
pnpm dev
```

브라우저에서 `http://localhost:3000` 접속 → "Void Chronicle" 텍스트가 보이면 성공!

---

## 📋 개발 로드맵 (6주 계획)

### Week 1: 프로젝트 셋업 & 기본 구조
- [x] 프로젝트 기획
- [ ] 초기 설정 완료
- [ ] BootScene, MainMenuScene 구현
- [ ] 기본 플레이어 이동

### Week 2: 던전 생성 시스템
- [ ] DungeonGenerator 구현 (BSP 알고리즘)
- [ ] 타일맵 렌더링
- [ ] 충돌 감지
- [ ] 카메라 추적

### Week 3: 전투 시스템
- [ ] CombatSystem 구현
- [ ] 기본 적 3종 (Slime, Bat, Zombie)
- [ ] AI 기초 (Chase, Attack)
- [ ] 체력 시스템 & UI

### Week 4: 아이템 & 인벤토리
- [ ] Item 시스템
- [ ] Weapon (무기 3종)
- [ ] Inventory UI
- [ ] 장비 시스템

### Week 5: 스킬 & 진행 시스템
- [ ] SkillSystem
- [ ] 캐릭터별 기본 스킬
- [ ] 메타 프로그레션 (Soul)
- [ ] SaveSystem (LocalStorage)

### Week 6: 폴리싱 & 배포
- [ ] 사운드/음악
- [ ] 파티클 이펙트
- [ ] 모바일 최적화
- [ ] Vercel 배포

---

## 🎯 즉시 실행 가능한 명령어 요약

```bash
# 1. 프로젝트 디렉토리 생성
cd ~/work && mkdir void-chronicle && cd void-chronicle

# 2. Git 초기화
git init

# 3. package.json 작성 (setup-files.md 참조)
# ... 파일 생성 ...

# 4. 의존성 설치
pnpm install

# 5. 디렉토리 구조 생성
mkdir -p src/{scenes,entities,systems,ui,utils,config,data,types,ai}
mkdir -p public/assets/{sprites,tilesets,ui,audio,fonts}

# 6. 개발 시작
pnpm dev
```

---

## 💡 유용한 리소스

### Phaser 3 학습
- [공식 문서](https://phaser.io/phaser3)
- [Phaser 3 Examples](https://phaser.io/examples)
- [TypeScript + Phaser 튜토리얼](https://blog.ourcade.co/)

### 무료 게임 에셋
- [itch.io - Pixel Art](https://itch.io/game-assets/free/tag-pixel-art)
- [OpenGameArt](https://opengameart.org/)
- [Kenney Assets](https://kenney.nl/assets)

### 로그라이크 개발 참고
- [RogueBasin](http://www.roguebasin.com/)
- [r/roguelikedev](https://www.reddit.com/r/roguelikedev/)

---

## 🔗 관련 문서

1. `void-chronicle-project-plan.md` - 전체 프로젝트 계획
2. `void-chronicle-game-design.md` - 게임 디자인 (GDD)
3. `void-chronicle-project-structure.md` - 프로젝트 구조
4. `void-chronicle-setup-files.md` - 설정 파일 템플릿

---

**준비 완료!** 이제 프로젝트를 시작하세요! 🚀

**마지막 업데이트**: 2026-02-28
**작성자**: Claude (analyst agent)
