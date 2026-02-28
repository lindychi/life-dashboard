# Void Chronicle - 프로젝트 구조

## 📁 디렉토리 구조

```
void-chronicle/
├── .github/
│   └── workflows/
│       └── deploy.yml           # GitHub Actions CI/CD
├── public/
│   ├── index.html               # HTML 엔트리 포인트
│   ├── favicon.ico
│   └── assets/                  # 게임 에셋
│       ├── sprites/             # 스프라이트 이미지
│       │   ├── player/
│       │   │   ├── knight.png
│       │   │   ├── rogue.png
│       │   │   └── mage.png
│       │   ├── enemies/
│       │   │   ├── slime.png
│       │   │   ├── bat.png
│       │   │   └── zombie.png
│       │   └── items/
│       │       ├── sword.png
│       │       ├── potion.png
│       │       └── coin.png
│       ├── tilesets/            # 타일셋
│       │   ├── dungeon-floor.png
│       │   ├── dungeon-walls.png
│       │   └── dungeon-props.png
│       ├── ui/                  # UI 에셋
│       │   ├── button.png
│       │   ├── health-bar.png
│       │   └── panel.png
│       ├── audio/               # 사운드
│       │   ├── music/
│       │   │   ├── menu.mp3
│       │   │   ├── dungeon.mp3
│       │   │   └── boss.mp3
│       │   └── sfx/
│       │       ├── attack.wav
│       │       ├── hurt.wav
│       │       └── pickup.wav
│       └── fonts/               # 폰트
│           └── pixel.ttf
├── src/
│   ├── main.ts                  # 애플리케이션 엔트리
│   ├── config/
│   │   ├── gameConfig.ts        # Phaser 게임 설정
│   │   ├── constants.ts         # 게임 상수
│   │   └── balanceConfig.ts     # 밸런스 설정
│   ├── scenes/                  # Phaser 씬
│   │   ├── BootScene.ts         # 에셋 로딩
│   │   ├── PreloadScene.ts      # 프리로드
│   │   ├── MainMenuScene.ts     # 메인 메뉴
│   │   ├── CharacterSelectScene.ts  # 캐릭터 선택
│   │   ├── GameScene.ts         # 메인 게임플레이
│   │   ├── UIScene.ts           # HUD/UI 오버레이
│   │   ├── PauseScene.ts        # 일시정지 메뉴
│   │   ├── GameOverScene.ts     # 사망 화면
│   │   └── UpgradeScene.ts      # 메타 업그레이드
│   ├── entities/                # 게임 엔티티
│   │   ├── base/
│   │   │   ├── Entity.ts        # 기본 엔티티 클래스
│   │   │   └── Character.ts     # 캐릭터 베이스
│   │   ├── player/
│   │   │   ├── Player.ts        # 플레이어
│   │   │   ├── Knight.ts        # 기사
│   │   │   ├── Rogue.ts         # 도적
│   │   │   └── Mage.ts          # 마법사
│   │   ├── enemies/
│   │   │   ├── Enemy.ts         # 적 베이스
│   │   │   ├── Slime.ts
│   │   │   ├── Bat.ts
│   │   │   └── Zombie.ts
│   │   └── items/
│   │       ├── Item.ts          # 아이템 베이스
│   │       ├── Weapon.ts
│   │       ├── Potion.ts
│   │       └── Coin.ts
│   ├── systems/                 # 게임 시스템
│   │   ├── combat/
│   │   │   ├── CombatSystem.ts  # 전투 로직
│   │   │   ├── DamageCalculator.ts
│   │   │   └── StatusEffects.ts
│   │   ├── inventory/
│   │   │   ├── InventorySystem.ts
│   │   │   └── EquipmentManager.ts
│   │   ├── dungeon/
│   │   │   ├── DungeonGenerator.ts   # 던전 생성
│   │   │   ├── RoomGenerator.ts
│   │   │   └── BSPAlgorithm.ts       # Binary Space Partitioning
│   │   ├── skill/
│   │   │   ├── SkillSystem.ts
│   │   │   └── skills/
│   │   │       ├── Fireball.ts
│   │   │       ├── ShieldBash.ts
│   │   │       └── ShadowStep.ts
│   │   └── progression/
│   │       ├── MetaProgression.ts    # 영구 업그레이드
│   │       ├── SaveSystem.ts         # 세이브/로드
│   │       └── UnlockSystem.ts       # 언락 시스템
│   ├── ui/                      # UI 컴포넌트
│   │   ├── components/
│   │   │   ├── HealthBar.ts
│   │   │   ├── ManaBar.ts
│   │   │   ├── SkillButton.ts
│   │   │   ├── InventoryPanel.ts
│   │   │   └── DamageText.ts
│   │   └── managers/
│   │       ├── UIManager.ts
│   │       └── TooltipManager.ts
│   ├── ai/                      # AI 시스템
│   │   ├── AIController.ts      # AI 베이스
│   │   ├── behaviors/
│   │   │   ├── ChasePlayer.ts
│   │   │   ├── WanderAround.ts
│   │   │   └── AttackPattern.ts
│   │   └── pathfinding/
│   │       └── AStar.ts         # A* 알고리즘
│   ├── utils/                   # 유틸리티
│   │   ├── MathUtils.ts
│   │   ├── RandomUtils.ts
│   │   ├── TweenHelper.ts
│   │   └── Logger.ts
│   ├── data/                    # 게임 데이터
│   │   ├── characters.json      # 캐릭터 스탯
│   │   ├── enemies.json         # 적 데이터
│   │   ├── items.json           # 아이템 데이터
│   │   └── skills.json          # 스킬 데이터
│   └── types/                   # TypeScript 타입
│       ├── index.d.ts
│       ├── GameTypes.ts
│       ├── EntityTypes.ts
│       └── ItemTypes.ts
├── tests/                       # 테스트
│   ├── unit/
│   │   ├── DungeonGenerator.test.ts
│   │   ├── CombatSystem.test.ts
│   │   └── InventorySystem.test.ts
│   └── e2e/
│       └── gameplay.test.ts
├── .eslintrc.json               # ESLint 설정
├── .prettierrc                  # Prettier 설정
├── .gitignore
├── package.json
├── tsconfig.json                # TypeScript 설정
├── vite.config.ts               # Vite 설정
├── vitest.config.ts             # Vitest 설정
└── README.md
```

---

## 🔧 핵심 파일 설명

### 설정 파일

#### `package.json`
```json
{
  "name": "void-chronicle",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "lint": "eslint . --ext ts,tsx",
    "format": "prettier --write \"src/**/*.ts\""
  },
  "dependencies": {
    "phaser": "^3.80.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "prettier": "^3.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.1.0",
    "vitest": "^1.3.0"
  }
}
```

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* Path mapping */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@entities/*": ["./src/entities/*"],
      "@systems/*": ["./src/systems/*"],
      "@scenes/*": ["./src/scenes/*"],
      "@ui/*": ["./src/ui/*"],
      "@utils/*": ["./src/utils/*"],
      "@config/*": ["./src/config/*"],
      "@data/*": ["./src/data/*"],
      "@types/*": ["./src/types/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

#### `vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@entities': path.resolve(__dirname, './src/entities'),
      '@systems': path.resolve(__dirname, './src/systems'),
      '@scenes': path.resolve(__dirname, './src/scenes'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@config': path.resolve(__dirname, './src/config'),
      '@data': path.resolve(__dirname, './src/data'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
```

---

## 🎮 주요 씬 플로우

```
BootScene (에셋 로딩)
    ↓
PreloadScene (초기화)
    ↓
MainMenuScene (메인 메뉴)
    ↓
CharacterSelectScene (캐릭터 선택)
    ↓
GameScene (게임플레이) + UIScene (HUD 오버레이)
    ↓
PauseScene (일시정지) 또는 GameOverScene (사망)
    ↓
UpgradeScene (메타 업그레이드)
    ↓
MainMenuScene (재시작)
```

---

## 🧩 시스템 아키텍처

### ECS (Entity-Component-System) 패턴 미사용
- Phaser의 GameObject 시스템 활용
- 상속 기반 아키텍처
- System 클래스는 독립적인 관리자 역할

### 주요 시스템 간 의존성

```
GameScene
  ├─ DungeonGenerator → RoomGenerator
  ├─ CombatSystem → DamageCalculator
  ├─ InventorySystem → EquipmentManager
  ├─ SkillSystem → Skill[]
  └─ AIController → Pathfinding

UIScene
  ├─ UIManager → Components[]
  └─ TooltipManager

MetaProgression
  ├─ SaveSystem (LocalStorage)
  └─ UnlockSystem
```

---

## 💾 데이터 저장 구조

### LocalStorage 키
```typescript
{
  "void-chronicle-save": {
    "version": "1.0.0",
    "player": {
      "souls": 1500,
      "unlockedCharacters": ["knight", "rogue"],
      "upgrades": {
        "maxHpBonus": 3,
        "startingGold": 2,
        "critChance": 5
      }
    },
    "achievements": [],
    "settings": {
      "musicVolume": 0.7,
      "sfxVolume": 0.8,
      "language": "ko"
    }
  }
}
```

---

## 🚀 개발 우선순위별 구현 순서

### Phase 1: 코어 시스템
1. `BootScene` + `PreloadScene` (에셋 로딩)
2. `MainMenuScene` (메뉴)
3. `GameScene` (기본 씬)
4. `Player` (이동 + 애니메이션)
5. `DungeonGenerator` (랜덤 던전)

### Phase 2: 전투 시스템
1. `CombatSystem` (공격 로직)
2. `Enemy` (적 베이스)
3. `Slime`, `Bat` (기본 적 2종)
4. `HealthBar` UI
5. 사망 처리

### Phase 3: 아이템 & 인벤토리
1. `Item` (아이템 베이스)
2. `Weapon` (무기)
3. `InventorySystem`
4. `InventoryPanel` UI
5. 장비 시스템

### Phase 4: 스킬 & AI
1. `SkillSystem`
2. 기본 스킬 3개 (각 캐릭터당 1개)
3. `AIController` (적 AI)
4. A* Pathfinding
5. 공격 패턴

### Phase 5: 메타 프로그레션
1. `MetaProgression` (영구 업그레이드)
2. `SaveSystem` (LocalStorage)
3. `UpgradeScene` UI
4. 소울 획득 로직
5. 캐릭터 언락

### Phase 6: 폴리싱
1. 사운드/음악 통합
2. 파티클 이펙트
3. UI 애니메이션
4. 모바일 터치 최적화
5. 성능 최적화

---

## 📦 에셋 관리 전략

### 에셋 소스
- **무료 픽셀 아트**: [itch.io](https://itch.io/game-assets/free/tag-pixel-art)
- **무료 사운드**: [freesound.org](https://freesound.org/)
- **무료 음악**: [incompetech.com](https://incompetech.com/)

### 스프라이트 사이즈
- 캐릭터/적: 16x16px (2배 확대 표시)
- 타일: 16x16px
- UI: 가변 (고해상도)

### 최적화
- 스프라이트 시트 사용 (TexturePacker)
- 오디오 압축 (MP3/OGG)
- 에셋 지연 로딩 (층별)

---

**버전**: 1.0.0
**최종 수정**: 2026-02-28
**작성자**: Claude (analyst agent)
