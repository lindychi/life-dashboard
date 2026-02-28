# 로그라이크 UX 패턴 분석 및 빌드 시스템 UI/UX 설계

## 1. 로그라이크 핵심 UX 패턴 분석

### 1.1 Run-Based Progression (런 기반 진행)

#### 핵심 원칙
- **일회성 세션**: 각 run은 독립적이며, 실패 시 처음부터 재시작
- **짧은 피드백 루프**: 10-60분 내 의미 있는 진행과 결과
- **점진적 난이도**: run 초반 → 후반으로 갈수록 선택지와 복잡도 증가
- **명확한 진행 상태**: 현재 스테이지/층수/진행률을 항상 표시

#### 대표 사례 분석

**Hades (액션 로그라이크)**
- **진행 표시**: 방 번호 + 보스까지 남은 방 수 (예: 12/36)
- **보상 프리뷰**: 다음 방 선택 시 보상 아이콘 미리 표시
- **브랜칭 선택**: 포크로드에서 경로 선택 → 즉각적인 시각적 피드백
- **상태 유지**: 현재 체력/자원/버프를 화면 상단에 고정 표시

**Slay the Spire (덱빌딩 로그라이크)**
- **맵 시각화**: 전체 맵을 트리 구조로 표시, 현재 위치 강조
- **선택지 아이콘화**: 전투/상점/이벤트/휴식을 색상+아이콘으로 구분
- **경로 미리보기**: 호버 시 해당 경로의 난이도/보상 힌트 표시
- **브랜치 압축**: 여러 경로를 수직 공간에 효율적으로 배치

**Dead Cells (플랫포머 로그라이크)**
- **스테이지 카운터**: "1-2 (Promenade of the Condemned)" 형식
- **타이머 기반 보상**: 빠른 클리어 시 보너스 제공 → 타이머 UI 필수
- **분기점 표시**: 스테이지 종료 시 다음 경로 선택 UI (난이도/특성 표시)

#### UX 설계 원칙

```typescript
// Run Progress UI 구조
interface RunProgressState {
  currentStage: number;
  totalStages: number;
  stageType: 'combat' | 'shop' | 'event' | 'boss' | 'rest';
  nextChoices: Array<{
    stageType: string;
    difficulty: 'easy' | 'normal' | 'hard';
    rewardPreview: RewardType[];
  }>;
  completionPercent: number; // 0-100
}

// 진행 표시 컴포넌트 요구사항
const RunProgressUI = {
  // 필수 요소
  persistentHeader: {
    currentStage: '3/15',
    currentResources: { health: 65, gold: 120 },
    activeBuffs: [...],
  },

  // 맵/경로 시각화
  mapVisualization: {
    layout: 'tree' | 'linear' | 'branching',
    nodeIcons: true,
    pathHighlight: true,
    fogOfWar: false, // 로그라이크는 보통 전체 맵 공개
  },

  // 다음 선택 UI
  nextChoicePanel: {
    showRewardPreview: true,
    showDifficultyIndicator: true,
    allowBacktracking: false, // 대부분 불가
  }
};
```

### 1.2 Meta Progression (메타 프로그레션)

#### 핵심 원칙
- **영구 업그레이드**: run 실패해도 유지되는 강화 요소
- **점진적 언락**: 새로운 캐릭터/아이템/스킬을 조건부로 해금
- **성취감 누적**: 실패해도 "무언가 얻었다"는 느낌 제공
- **장기 목표**: 단기(run 클리어) + 중기(언락) + 장기(올클리어) 목표 병존

#### 대표 사례 분석

**Hades (미러 오브 나이트)**
```
메타 화폐: Darkness (어둠)
- run 중 획득 → run 종료 후 미러에서 영구 업그레이드
- 카테고리별 업그레이드:
  * 체력 증가 (5단계, 각 +25 HP)
  * 대시 회복 속도 (3단계)
  * 크리티컬 확률 (10단계, 각 +2%)
  * 골드 획득량 (15단계, 각 +10%)
- UI 특징:
  * 트리 형태 아님, 독립적인 슬롯들
  * 각 슬롯마다 비용 표시 (누적 상승)
  * 현재 보유량 + 필요량 실시간 비교
  * 리셋 가능 (비용 없음)
```

**Slay the Spire (Ascension 시스템)**
```
메타 난이도: 20단계 Ascension
- 각 단계마다 특정 난이도 요소 추가
  * A1: 엘리트 체력 +10%
  * A2: 보스 체력 +10%
  * A10: 시작 유물 제거
- UI 특징:
  * 게임 시작 전 슬라이더로 선택
  * 각 단계 효과를 툴팁으로 표시
  * 최고 도달 단계 저장
```

**Dead Cells (영구 무기/룬 언락)**
```
메타 언락: 청사진 수집 → 골드 투자 → 영구 해금
- 청사진: 적 처치 시 드롭
- 수집가 NPC: 골드를 지불해 영구 해금
- 룬: 보스 격파로 언락, 새 지역 접근 가능
- UI 특징:
  * 수집 진행률 표시 (43/120 무기 해금)
  * 미해금 아이템도 실루엣으로 표시
  * 해금 조건 힌트 제공
```

#### UX 설계 원칙

```typescript
// Meta Progression 구조
interface MetaProgressionSystem {
  currencies: Array<{
    id: 'darkness' | 'keys' | 'nectar';
    icon: string;
    currentAmount: number;
    earnedThisRun: number; // run 종료 시 애니메이션
  }>;

  upgrades: Array<{
    id: string;
    category: 'offense' | 'defense' | 'utility';
    name: string;
    description: string;
    currentLevel: number;
    maxLevel: number;
    costPerLevel: (level: number) => number; // 누진 비용
    effectPreview: string; // "Next: +3% Crit"
    isUnlocked: boolean;
  }>;

  unlockables: Array<{
    id: string;
    type: 'character' | 'weapon' | 'ability' | 'area';
    unlockCondition: string; // "Defeat 10 bosses"
    progress: { current: number; target: number };
    isUnlocked: boolean;
  }>;
}

// Meta UI 컴포넌트
const MetaProgressionUI = {
  // run 종료 후 보상 화면
  postRunRewards: {
    currencyAnimation: true, // 숫자 카운트업
    newUnlockNotification: true, // 팝업 + 효과음
    progressTowardsGoal: true, // "3/10 bosses defeated"
  },

  // 메타 업그레이드 허브
  upgradeHub: {
    categoryTabs: true,
    filterByAffordable: true,
    sortByCategory: true,
    showAllEvenLocked: true, // 동기부여
    resetOption: true,
  },

  // 컬렉션 UI
  collection: {
    gridLayout: true,
    showLockedAsGhost: true, // 실루엣
    unlockHints: true,
    completionPercentage: true,
  }
};
```

### 1.3 아이템/스킬 조합 시스템

#### 핵심 원칙
- **시너지 발견**: 특정 조합이 강력한 효과 발생
- **빌드 다양성**: 같은 캐릭터도 run마다 다른 전략
- **트레이드오프**: 강력한 아이템 = 단점/리스크 동반
- **즉각적 피드백**: 조합 완성 시 시각적/수치적 변화 명확

#### 대표 사례 분석

**Hades (신의 축복 조합)**
```
Duo Boon (듀오 축복): 2개 신의 축복 조합
- 조건: 특정 신 A의 축복 + 특정 신 B의 축복
- 효과: 완전히 새로운 능력 (단순 합이 아님)
- 예시:
  * Artemis(치명타) + Aphrodite(약화)
    → "Heart Rend": 약화된 적에게 치명타 +150%
  * Zeus(번개) + Poseidon(넉백)
    → "Sea Storm": 넉백된 적에게 번개 연쇄

UI 특징:
- 축복 선택 시 현재 보유 축복 하단에 표시
- Duo 가능 여부를 빛나는 테두리로 암시
- 획득 시 전용 애니메이션 + 설명 팝업
- 빌드 화면에서 시너지 아이콘 표시
```

**Slay the Spire (카드 시너지)**
```
카드 조합 예시:
- "Strength" 버프 + "Heavy Blade" 카드
  → 공격력이 Strength의 5배 증가
- "Barricade" + "Entrench"
  → 방어도가 영구 유지되며 2배씩 증가

UI 특징:
- 카드 선택 시 덱 내 시너지 카드 하이라이트
- 전투 중 시너지 발동 시 시각 효과
- 덱 보기 화면에서 관련 카드끼리 자동 그룹화 옵션
- 유물과 카드 조합도 별도 표시
```

**Risk of Rain 2 (아이템 스택)**
```
아이템 스택 시스템:
- 같은 아이템 여러 개 = 효과 누적
- 예시: "Soldier's Syringe" (공속 +15%)
  * 1개: +15%
  * 10개: +150% (무지막지한 공속)
  * 시너지: "Will-o'-the-wisp" (폭발) + 공속 = 폭발 빈도 증가

UI 특징:
- 아이템 옆에 스택 숫자 (x10)
- 인벤토리에서 같은 아이템끼리 자동 병합
- 스택 효과를 실시간 수치로 표시 (150% → 200%)
```

#### UX 설계 원칙

```typescript
// 시너지 시스템 구조
interface SynergySystem {
  // 시너지 정의
  synergies: Array<{
    id: string;
    name: string;
    requiredItems: string[]; // 필요 아이템 ID
    effect: {
      type: 'multiplicative' | 'additive' | 'new_ability';
      value: number | string;
      description: string;
    };
    rarity: 'common' | 'rare' | 'legendary';
    visualEffect: string; // 발동 시 이펙트
  }>;

  // 현재 활성 시너지
  activeSynergies: Array<{
    synergyId: string;
    completionLevel: number; // 2/3 아이템 보유
    isActive: boolean;
  }>;

  // 잠재 시너지 (1개만 더 있으면 발동)
  potentialSynergies: Array<{
    synergyId: string;
    missingItems: string[];
    rarityOfMissing: string;
  }>;
}

// 시너지 UI 컴포넌트
const SynergyUI = {
  // 아이템 선택 시
  itemSelectionHints: {
    highlightSynergyItems: true, // 빛나는 테두리
    showPotentialSynergies: true, // "이 아이템으로 XX 시너지 가능"
    sortBysynergy: true, // 시너지 우선 정렬
  },

  // 빌드 화면
  buildOverview: {
    synergySection: true, // 별도 섹션
    activeGlow: true, // 활성 시너지는 금색
    inactiveGhost: true, // 비활성은 회색
    missingItemsTooltip: true,
  },

  // 실시간 피드백
  synergyActivation: {
    fullScreenFlash: true, // 첫 발동 시
    iconPopup: true, // 시너지 아이콘 팝업
    soundEffect: true,
    damageNumberChange: true, // 즉시 수치 변화
  }
};
```

---

## 2. 빌드 시스템 UI 컨셉 설계

### 2.1 스킬 트리 UI

#### 디자인 철학
- **읽기 쉬운 구조**: 한눈에 경로 파악 가능
- **의미 있는 선택**: 각 노드가 명확한 영향력
- **유연한 리스펙**: 실험을 장려하는 낮은 리스펙 비용
- **시각적 피드백**: 선택 전후 차이를 명확히 표시

#### 레이아웃 패턴

**1. 방사형 트리 (Radial Tree)**
```
중앙: 캐릭터/코어 능력
방사: 4-6개 전문화 경로

장점:
- 모든 경로가 동등한 시각적 중요도
- 하이브리드 빌드 표현에 유리
- 공간 활용 효율적

예시:
        [Offense]
            |
    [Tank]--[Core]--[Support]
            |
        [Mobility]

각 경로마다 3-5 티어, 티어당 2-3 선택지
```

**2. 수직 트리 (Vertical Tree)**
```
상단: 기본 스킬
하단: 고급 스킬

장점:
- 진행 방향이 직관적 (위→아래)
- 티어 구분 명확
- 전통적이라 학습 비용 낮음

예시:
Tier 1:  [A] [B] [C]
          |   |   |
Tier 2:  [D] [E] [F]
         / \ / \ / \
Tier 3: [G][H][I][J]
```

**3. 허니컴 그리드 (Honeycomb Grid)**
```
육각형 노드들이 벌집 형태로 배치

장점:
- 6방향 연결 가능 (4방향보다 유연)
- 시각적으로 독특하고 매력적
- 비선형 경로 표현에 유리

예시: Path of Exile의 Passive Tree
```

#### 노드 디자인

```typescript
interface SkillNode {
  id: string;
  name: string;
  tier: number;
  category: 'offense' | 'defense' | 'utility';

  // 상태
  status: 'locked' | 'available' | 'purchased' | 'active';

  // 효과
  effects: Array<{
    stat: string; // "Critical Damage"
    value: string; // "+25%"
    format: 'percentage' | 'flat' | 'multiplier';
  }>;

  // 비용
  cost: {
    type: 'skill_points' | 'currency';
    amount: number;
  };

  // 연결
  prerequisites: string[]; // 선행 노드 ID
  unlocks: string[]; // 후행 노드 ID

  // 시각
  icon: string;
  glowColor: string; // 활성화 시
  particleEffect?: string;
}
```

#### 인터랙션 플로우

```typescript
// 스킬 선택 플로우
const SkillTreeInteraction = {
  // 1. 호버
  onHover: {
    highlightNode: true,
    showTooltip: {
      name: true,
      description: true,
      effects: true,
      cost: true,
      prerequisites: 'red if not met',
    },
    highlightPath: true, // 선행 노드들 빛남
    showPreview: true, // 스탯 변화 미리보기
  },

  // 2. 클릭
  onClick: {
    purchaseConfirm: 'expensive nodes only',
    playSoundEffect: true,
    animateActivation: {
      nodePulse: true,
      pathGlow: true,
      statCountUp: true, // 스탯 숫자 증가 애니메이션
    },
    updateConnectedNodes: true, // 후행 노드 언락
  },

  // 3. 리스펙
  onRespec: {
    showRefundAmount: true,
    highlightAffectedNodes: true, // 이 노드에 의존하는 노드들
    confirmDialog: 'if has dependencies',
    playReverseAnimation: true,
  }
};
```

#### 시너지 시각화

```typescript
// 노드 간 시너지 표시
const SynergyVisualization = {
  // 연결선
  connectionLines: {
    default: 'gray thin',
    active: 'gold thick glow',
    synergy: 'rainbow animated', // 시너지 발동 시
  },

  // 시너지 세트
  synergySets: Array<{
    name: "Elemental Overload",
    nodes: ['fire_mastery', 'ice_mastery', 'lightning_mastery'],
    bonus: "+50% Elemental Damage",
    visualization: {
      outlineColor: 'purple',
      connectingParticles: true,
      badgeIcon: 'elemental_symbol',
    }
  }>,

  // 세트 완성 시
  onSetComplete: {
    fullScreenFlash: true,
    displaySetBonus: {
      position: 'center',
      duration: 3000,
      animation: 'fade-in-scale',
    },
    unlockNewNodes: true, // 히든 노드 등장
  }
};
```

### 2.2 인벤토리 UI

#### 레이아웃 구조

**그리드 기반 인벤토리**
```
┌─────────────────────────────────┐
│  장비 슬롯        │   스탯 요약   │
│  ┌─┐ ┌─┐ ┌─┐    │  HP:  500    │
│  │H│ │C│ │W│    │  ATK: 125    │
│  └─┘ └─┘ └─┘    │  DEF: 80     │
│  ┌─┐ ┌─┐ ┌─┐    │  SPD: 15     │
│  │A│ │L│ │R│    │              │
│  └─┘ └─┘ └─┘    └──────────────┘
├─────────────────────────────────┤
│  소모품 (퀵 슬롯)                │
│  [1] [2] [3] [4] [5] [6]        │
├─────────────────────────────────┤
│  인벤토리 (4x6 그리드)           │
│  ┌─┬─┬─┬─┐                      │
│  │ │X│ │ │  X: 아이템           │
│  ├─┼─┼─┼─┤  회색: 빈 슬롯       │
│  │ │ │X│X│                      │
│  ├─┼─┼─┼─┤                      │
│  │X│ │ │ │  24 슬롯             │
│  └─┴─┴─┴─┘  18 / 24 사용 중    │
└─────────────────────────────────┘
```

**테트리스형 인벤토리 (Dead Cells, Diablo)**
```
아이템이 실제 크기를 차지
- 검: 1x3
- 포션: 1x1
- 방패: 2x2

장점: 공간 최적화 퍼즐 요소
단점: 관리 복잡도 증가
```

#### 아이템 카드 디자인

```typescript
interface ItemCard {
  // 기본 정보
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  type: 'weapon' | 'armor' | 'consumable' | 'material';
  icon: string;

  // 시각적 요소
  visual: {
    backgroundColor: string; // 레어도별 색상
    borderGlow: boolean; // 레전더리는 빛남
    particleEffect?: 'sparkle' | 'flame' | 'frost';
    isNew: boolean; // NEW 배지
  };

  // 스탯
  stats: Array<{
    name: string;
    value: string;
    isPositive: boolean; // 색상 결정 (녹색/빨강)
    isSynergy: boolean; // 시너지 효과면 금색
  }>;

  // 비교
  comparison?: {
    equipped: Item; // 현재 장착 아이템
    statDiffs: Array<{ stat: string; diff: string }>; // "+15 ATK"
  };

  // 인터랙션
  actions: Array<{
    label: 'Equip' | 'Use' | 'Drop' | 'Sell';
    hotkey?: string; // "E"
    disabled?: boolean;
  }>;
}
```

#### 아이템 비교 시스템

```typescript
const ItemComparisonUI = {
  // 호버 시 자동 비교
  autoCompare: {
    enabled: true,
    compareWith: 'currently equipped',
    position: 'side-by-side',

    visualization: {
      // 스탯 변화 표시
      increasedStats: 'green with ↑',
      decreasedStats: 'red with ↓',
      unchangedStats: 'gray',

      // 전체 DPS/방어력 계산
      showAggregateScore: true,
      scoreFormat: 'Total DPS: 450 → 520 (+15%)',

      // 시너지 변화
      synergiesLost: 'red warning',
      synergiesGained: 'gold highlight',
    }
  },

  // 수동 비교 모드 (여러 아이템)
  manualCompare: {
    selectUpTo: 3,
    layout: 'vertical columns',
    highlightBestInCategory: true,
  }
};
```

#### 조합/제작 UI

```typescript
const CraftingUI = {
  layout: {
    leftPanel: 'materials inventory',
    centerPanel: 'recipe browser',
    rightPanel: 'crafting preview',
  },

  // 레시피 브라우저
  recipeBrowser: {
    categories: ['Weapons', 'Armor', 'Consumables'],
    filters: ['Craftable Now', 'Show All', 'Favorites'],
    sort: ['Rarity', 'Level', 'Recently Unlocked'],

    recipeCard: {
      resultItem: { icon, name, stats },
      requiredMaterials: [
        { name: 'Iron Ore', have: 5, need: 3, icon },
        { name: 'Dragon Scale', have: 0, need: 1, icon, highlight: 'red' }
      ],
      canCraft: boolean,
    }
  },

  // 제작 프리뷰
  craftingPreview: {
    resultPreview: 'animated 3D model or large icon',
    materialSlots: 'drag-and-drop',
    craftButton: {
      enabled: 'only if materials sufficient',
      animation: 'progress bar + sparks',
      result: 'item popup with celebration',
    }
  },

  // 조합 실험
  experimentalCrafting: {
    freeformSlots: 4, // 재료 자유 배치
    autoDetectRecipe: true, // 올바른 조합 시 레시피 발견
    failureAnimation: 'smoke puff',
    successAnimation: 'lightning + item reveal',
  }
};
```

### 2.3 전투 피드백 시스템

#### 데미지 숫자 시각화

```typescript
interface DamageNumberSystem {
  // 기본 데미지
  basic: {
    size: 'medium',
    color: 'white',
    font: 'bold sans-serif',
    animation: 'float-up-fade',
    duration: 1000,
  },

  // 크리티컬
  critical: {
    size: 'large',
    color: 'yellow',
    font: 'bold italic',
    animation: 'float-up-scale-fade',
    duration: 1500,
    shake: true, // 화면 약간 흔들림
    soundEffect: 'critical.wav',
    prefix: 'CRIT! ',
  },

  // 약점 공격
  weakness: {
    size: 'large',
    color: 'orange',
    suffix: ' WEAK!',
    particleEffect: 'shatter',
  },

  // 회복
  healing: {
    color: 'green',
    prefix: '+',
    animation: 'float-up-glow',
  },

  // 상태이상 데미지 (도트 등)
  dot: {
    size: 'small',
    color: 'purple',
    font: 'italic',
    animation: 'pulse',
    grouping: true, // 여러 틱을 합산 (5+5+5 → 15)
  },

  // 피격
  incoming: {
    color: 'red',
    position: 'player position',
    prefix: '-',
    shake: true,
  }
}
```

#### 히트 이펙트

```typescript
const HitEffectSystem = {
  // 타격 순간
  onHit: {
    freeze: {
      duration: 50, // ms (히트스톱)
      applyTo: 'attacker and target',
    },

    screenShake: {
      intensity: 'based on damage',
      duration: 100,
      onlyForCritical: false,
    },

    particleExplosion: {
      particleCount: 20,
      color: 'based on element',
      direction: 'radial from hit point',
      gravity: true,
    },

    flashEffect: {
      target: 'enemy sprite',
      color: 'white',
      duration: 50,
    }
  },

  // 연타 시스템
  comboHits: {
    comboCounter: {
      position: 'near player',
      format: '5 HIT COMBO!',
      fontSize: 'increases with combo',
      color: 'gradient (yellow → red)',
    },

    comboMeter: {
      fillRate: 'per hit',
      decayRate: 'over time without hitting',
      bonusAtFull: 'damage multiplier',
      visualFeedback: 'pulsing glow',
    }
  },

  // 처치 시
  onKill: {
    slowMotion: {
      enabled: true,
      timeScale: 0.3,
      duration: 500,
    },

    explosion: {
      particleCount: 50,
      shrapnelEffect: true,
      soundEffect: 'death_explosion.wav',
    },

    lootExplosion: {
      dropItems: true,
      physicsEnabled: true, // 아이템이 튕겨나감
      magnetToPlayer: { delay: 1000, speed: 5 },
    }
  }
};
```

#### 상태 버프/디버프 UI

```typescript
const StatusEffectUI = {
  // 플레이어 버프 바
  playerBuffBar: {
    position: 'below health bar',
    layout: 'horizontal icon row',
    maxVisible: 10,
    overflow: 'show count (+5)',

    iconDesign: {
      size: 32,
      shape: 'rounded square',
      border: 'colored by type',
      glowEffect: true,
    },

    tooltip: {
      name: 'Strength',
      duration: '12s',
      effect: '+50% Physical Damage',
      stackCount: 'x3',
    },

    expiration: {
      colorShift: 'gray when < 3s',
      pulseAnimation: 'when < 3s',
      soundAlert: 'when expired',
    }
  },

  // 적 디버프 표시
  enemyDebuffIndicator: {
    position: 'above enemy head',
    icons: ['poison', 'slow', 'burn'],
    maxVisible: 3,
    tooltipOnHover: true,
  },

  // 상태 스택 시각화
  stackVisualization: {
    method: 'number badge', // "x5"
    alternativeMethods: [
      'multiple icons',
      'icon with progress bar',
      'icon with notches',
    ],
    maxStackIcon: 'special glow at max',
  }
};
```

#### 전투 로그

```typescript
const CombatLogUI = {
  position: 'bottom-left',
  maxEntries: 50,
  autoscroll: true,

  entryTypes: {
    damage: {
      format: 'You dealt 125 damage to Goblin',
      color: 'white',
      icon: '⚔️',
    },

    critical: {
      format: 'CRITICAL! 250 damage to Boss',
      color: 'yellow',
      bold: true,
      icon: '💥',
    },

    status: {
      format: 'Goblin is poisoned',
      color: 'green',
      icon: '☠️',
    },

    loot: {
      format: 'Obtained: Legendary Sword',
      color: 'orange',
      icon: '🎁',
      clickable: 'show item tooltip',
    },

    miss: {
      format: 'Attack missed!',
      color: 'gray',
      icon: '❌',
    }
  },

  filters: {
    showDamage: true,
    showHealing: true,
    showLoot: true,
    showStatus: true,
    playerOnly: false,
  },

  notifications: {
    importantEvents: {
      position: 'center-top',
      format: 'large text banner',
      duration: 3000,
      examples: [
        'BOSS DEFEATED!',
        'LEVEL UP!',
        'NEW AREA UNLOCKED!'
      ]
    }
  }
};
```

---

## 3. 메타 프로그레션 UX 설계

### 3.1 영구 업그레이드 허브

```typescript
const MetaUpgradeHub = {
  layout: {
    navigation: 'left sidebar tabs',
    main: 'upgrade grid',
    footer: 'currency display + total progress',
  },

  categories: [
    {
      name: 'Combat',
      icon: '⚔️',
      upgrades: [
        {
          id: 'health_boost',
          name: 'Vitality',
          description: 'Increase max health',
          currentLevel: 5,
          maxLevel: 20,
          costPerLevel: (level) => 50 + level * 10,
          effect: (level) => `+${level * 25} Max HP`,

          visualization: {
            icon: '❤️',
            progressBar: {
              current: 5,
              max: 20,
              color: 'red',
            },
            nextLevelPreview: '+25 HP',
            totalInvestment: '750 Darkness',
          }
        },
        // ... more upgrades
      ]
    },
    // ... more categories
  ],

  interactions: {
    onUpgradeClick: {
      showConfirm: 'if cost > 1000',
      playAnimation: {
        currencyDeduct: 'count down',
        levelUp: 'fill progress bar',
        statUpdate: 'glow + count up',
      },
      updateRelatedStats: true,
    },

    onCategorySwitch: {
      animation: 'fade transition',
      rememberScrollPosition: true,
    },

    bulkUpgrade: {
      enabled: true,
      button: 'Max Level (cost: 2500)',
      confirmDialog: true,
    }
  },

  sorting: {
    options: ['Affordable First', 'Category', 'Progress', 'Cost'],
    default: 'Affordable First',
    filterLocked: false, // 잠긴 것도 표시 (동기부여)
  }
};
```

### 3.2 언락 시스템

```typescript
const UnlockSystem = {
  // 언락 조건 타입
  conditionTypes: {
    runBased: {
      type: 'Defeat X bosses',
      progress: { current: 7, target: 10 },
      rewardsOnComplete: ['New Character'],
    },

    cumulative: {
      type: 'Deal 1,000,000 total damage',
      progress: { current: 743290, target: 1000000 },
      persistent: true, // run 간 누적
      rewardsOnComplete: ['Heavy Blade Weapon'],
    },

    achievement: {
      type: 'Win without taking damage',
      oneTime: true,
      difficulty: 'extreme',
      rewardsOnComplete: ['Invincibility Rune', 'Gold Badge'],
    },

    currency: {
      type: 'Spend 5000 Darkness',
      cost: { darkness: 5000 },
      rewardsOnComplete: ['Mirror Tier 3 Access'],
    }
  },

  // 언락 UI
  unlockUI: {
    codex: {
      layout: 'grid of cards',
      categories: ['Characters', 'Weapons', 'Abilities', 'Areas'],

      cardStates: {
        locked: {
          visual: 'silhouette + lock icon',
          tooltip: 'Unlock condition + progress',
          clickable: false,
        },

        unlockable: {
          visual: 'glowing border',
          tooltip: 'Click to unlock! (Cost: XXX)',
          clickable: true,
        },

        unlocked: {
          visual: 'full color + NEW badge if recent',
          tooltip: 'full description',
          clickable: 'show details',
        }
      },

      progressIndicators: {
        showPercentage: true, // "7/10 (70%)"
        showEstimate: false, // "~3 more runs"
        highlightClose: true, // 90% 이상이면 빛남
      }
    },

    unlockNotification: {
      trigger: 'on condition met',
      animation: {
        fullScreenFlash: true,
        itemReveal: 'curtain lift',
        confetti: true,
        soundEffect: 'fanfare.wav',
      },

      display: {
        itemIcon: 'large centered',
        itemName: 'bold title',
        description: 'flavor text',
        stats: 'if applicable',
        dismissButton: 'Continue',
      }
    }
  },

  // 히든 언락
  secretUnlocks: {
    showInCodex: false, // 조건 달성 전까지 숨김
    hintSystem: {
      enabled: true,
      hintLocations: ['Loading screens', 'NPC dialogue'],
      hintFormat: 'cryptic clues',
    },

    discoveryReward: {
      bonus: 'extra currency + title',
      announcement: 'global notification if multiplayer',
    }
  }
};
```

### 3.3 진행률 추적

```typescript
const ProgressTrackingUI = {
  // 메인 대시보드
  dashboard: {
    sections: [
      {
        title: 'Overall Progress',
        widgets: [
          {
            type: 'circular progress',
            label: 'Game Completion',
            value: 67,
            max: 100,
            breakdown: {
              'Characters Unlocked': '8/12',
              'Weapons Collected': '23/40',
              'Achievements': '15/50',
            }
          }
        ]
      },

      {
        title: 'Run Statistics',
        widgets: [
          { type: 'stat', label: 'Total Runs', value: 142 },
          { type: 'stat', label: 'Successful Runs', value: 38 },
          { type: 'stat', label: 'Win Rate', value: '26.8%' },
          { type: 'stat', label: 'Best Streak', value: 7 },
        ]
      },

      {
        title: 'Combat Records',
        widgets: [
          { type: 'stat', label: 'Enemies Defeated', value: '5,439' },
          { type: 'stat', label: 'Bosses Defeated', value: 87 },
          { type: 'stat', label: 'Highest Damage', value: '9,999' },
          { type: 'stat', label: 'Fastest Boss Kill', value: '12.3s' },
        ]
      },

      {
        title: 'Current Goals',
        widgets: [
          {
            type: 'goal',
            description: 'Defeat 10 bosses',
            progress: { current: 7, target: 10 },
            reward: 'Unlock: Assassin',
            estimatedRuns: 3,
          },
          {
            type: 'goal',
            description: 'Reach Stage 5 without healing',
            progress: { current: 3, target: 5 },
            reward: 'Achievement: Ascetic',
            difficulty: 'hard',
          }
        ]
      }
    ]
  },

  // 런 종료 리포트
  postRunReport: {
    layout: 'fullscreen overlay',
    sections: [
      {
        title: 'Run Summary',
        data: {
          result: 'Victory' | 'Defeat',
          duration: '23:45',
          stage: '5/5 (Boss)',
          score: 8750,
        },
        visualization: 'large banner',
      },

      {
        title: 'Rewards',
        currencyEarned: [
          { type: 'Darkness', amount: 120, animation: 'count-up' },
          { type: 'Keys', amount: 3, animation: 'count-up' },
        ],
        itemsUnlocked: [
          { name: 'Flame Sword', rarity: 'rare', new: true },
        ],
      },

      {
        title: 'Stats',
        columns: [
          {
            label: 'Combat',
            stats: [
              'Enemies Killed: 73',
              'Damage Dealt: 45,230',
              'Crits: 128',
            ]
          },
          {
            label: 'Progression',
            stats: [
              'Rooms Cleared: 18',
              'Bosses Defeated: 2',
              'Secrets Found: 3',
            ]
          },
        ]
      },

      {
        title: 'Build',
        build: {
          weapon: { name: 'Dual Daggers', level: 3 },
          abilities: ['Dash', 'Backstab', 'Smoke Bomb'],
          passives: ['Crit Master', 'Swift Feet'],
          synergies: ['Assassin Set Bonus'],
        },
        buildScore: 'A-', // 빌드 효율성 등급
      },

      {
        title: 'Progress Towards Goals',
        goals: [
          {
            name: 'Defeat 10 bosses',
            progress: '+2 (9/10)',
            completion: '90%',
            highlight: 'almost complete',
          }
        ]
      }
    ],

    actions: {
      continue: 'Return to Hub',
      retry: 'Start New Run',
      viewFullStats: 'Detailed Report',
    }
  }
};
```

---

## 4. 종합 UI/UX 프로토타입

### 4.1 게임 플로우

```
[메인 메뉴]
    ↓
[메타 허브] ← (런 종료 시 돌아옴)
  - 영구 업그레이드
  - 언락 관리
  - 캐릭터 선택
  - 진행률 확인
    ↓
[런 시작]
    ↓
[스테이지 선택] → [전투] → [보상 선택] → (반복)
    ↓
[보스 전투]
    ↓
[런 종료 리포트]
    ↓
[메타 허브]
```

### 4.2 핵심 화면 와이어프레임

**메타 허브 화면**
```
┌────────────────────────────────────────┐
│  [Logo]           Darkness: 1,240      │
│                   Keys: 7              │
├──────┬─────────────────────────────────┤
│ 캐릭터│  [캐릭터 선택 슬롯]              │
│ 무기  │   ┌─┐ ┌─┐ ┌─┐ ┌─┐             │
│ 업그  │   │A│ │B│ │C│ │?│             │
│ 진행  │   └─┘ └─┘ └─┘ └─┘             │
│ 통계  │                                │
│      │  [선택된 캐릭터: Warrior]       │
│      │   HP: 500  ATK: 100  DEF: 80   │
│      │                                │
│      │   [Start Run] ─────────────    │
│      │                                │
│      │  최근 언락: Flame Sword ⭐     │
│      │  진행률: 67% ████████▓▓▓▓▓     │
└──────┴─────────────────────────────────┘
```

**런 진행 화면**
```
┌────────────────────────────────────────┐
│ HP: ██████████░░ 80/100  Stage: 3/15   │
│ Gold: 250  🔑 Keys: 2                  │
├────────────────────────────────────────┤
│                                        │
│        [맵 시각화]                     │
│                                        │
│          [?] [⚔] [?]                  │
│           |   |   |                    │
│          [⚔]─[💰]─[?]    ← 현재 위치  │
│           |   |   |                    │
│          [?] [😈] [?]    😈 = Boss    │
│                                        │
│   범례: ⚔전투 💰상점 🛏휴식 ?이벤트   │
│                                        │
│   다음 선택:                           │
│   ┌──────┐ ┌──────┐ ┌──────┐          │
│   │ ⚔    │ │ 💰   │ │ ?    │          │
│   │Easy  │ │Shop  │ │Event │          │
│   │+Gold │ │      │ │???   │          │
│   └──────┘ └──────┘ └──────┘          │
└────────────────────────────────────────┘
```

**빌드 관리 화면 (런 중 'I' 키)**
```
┌────────────────────────────────────────┐
│  Build: Elemental Mage                 │
├──────────┬─────────────────────────────┤
│ 장비     │  현재 스탯                  │
│  W: 🪄   │   ATK: 150                  │
│  H: 👑   │   DEF: 60                   │
│  C: 🧥   │   HP:  400                  │
│  L: 👖   │   Crit: 25%                 │
│  R: 💍   │   Speed: 12                 │
├──────────┼─────────────────────────────┤
│ 액티브   │  시너지 ⭐                  │
│ [Q] 🔥   │   Elemental Overload        │
│ [W] ❄️  │   ├─ Fire Mastery          │
│ [E] ⚡   │   ├─ Ice Mastery           │
│ [R] 🌪️  │   └─ Lightning Mastery     │
├──────────┤   Bonus: +50% Ele. Dmg     │
│ 패시브   │                             │
│ • Mana   │  위험 조합 ⚠️               │
│   Regen  │   Glass Cannon              │
│ • Spell  │   ├─ High ATK              │
│   Power  │   └─ Low DEF               │
└──────────┴─────────────────────────────┘
```

**전투 화면**
```
┌────────────────────────────────────────┐
│ Player HP: ████████░░ 80/100           │
│ Buffs: 🔥+50% ⚡Speed                  │
├────────────────────────────────────────┤
│                                        │
│              Goblin HP: ██░░ 40/50     │
│              🧪Poisoned 🐢Slowed       │
│                  (╯°□°)╯              │
│                                        │
│                   💥 125               │
│                 CRIT! 250 ⚡           │
│                                        │
│       (づ｡◕‿‿◕｡)づ                    │
│       [Player]                         │
│                                        │
│   [Q]🔥 [W]❄️ [E]⚡ [R]🌪️            │
│    3s   5s  Ready Ready               │
├────────────────────────────────────────┤
│ Combat Log:                            │
│ • You dealt 125 damage                 │
│ • CRITICAL! 250 damage ⚡              │
│ • Goblin is poisoned ☠️                │
└────────────────────────────────────────┘
```

### 4.3 반응형 인터랙션 예시

```typescript
// 실시간 피드백 타임라인 (크리티컬 히트 예시)
const CriticalHitInteraction = {
  frame_0: {
    action: 'player attack initiated',
    visual: 'swing animation starts',
  },

  frame_15: {
    action: 'weapon connects with enemy',
    visual: [
      'freeze frame (hitstop) for 50ms',
      'enemy flash white',
      'screen shake (intensity: medium)',
    ],
    audio: 'critical_hit.wav',
  },

  frame_18: {
    action: 'damage number spawns',
    visual: [
      'text: "CRIT! 250"',
      'color: yellow',
      'size: 48px (2x normal)',
      'animation: scale from 0 → 1.2 → 1.0',
    ],
  },

  frame_20: {
    action: 'particle explosion',
    visual: [
      '30 particles in radial pattern',
      'colors: yellow/orange/white',
      'lifetime: 500ms',
    ],
  },

  frame_25: {
    action: 'damage number floats',
    visual: 'moves up 50px over 1s, fades out',
  },

  frame_30: {
    action: 'enemy knockback',
    visual: 'enemy slides back 30px',
  },

  frame_45: {
    action: 'resume normal',
    visual: 'all animations complete',
  }
};
```

### 4.4 접근성 고려사항

```typescript
const AccessibilityFeatures = {
  // 색각 이상 모드
  colorBlindMode: {
    enabled: true,
    options: ['Protanopia', 'Deuteranopia', 'Tritanopia'],
    adjustments: {
      rarityColors: 'use patterns + colors',
      statusEffects: 'use icons + colors',
      damageNumbers: 'size + symbol differentiation',
    }
  },

  // UI 스케일
  uiScale: {
    options: [0.8, 1.0, 1.2, 1.5],
    scalesIndependently: {
      hudSize: true,
      fontSize: true,
      iconSize: true,
      damageNumbers: true,
    }
  },

  // 시각 효과 강도
  effectsIntensity: {
    screenShake: { min: 0, max: 100, default: 100 },
    particleCount: { min: 0, max: 100, default: 100 },
    flashEffects: { min: 0, max: 100, default: 100 },
    motionBlur: { enabled: true },
  },

  // 키보드/컨트롤러 전용 모드
  inputAccessibility: {
    keyboardNavigation: {
      highlightFocused: true,
      tabOrder: 'logical flow',
      shortcuts: 'all actions have hotkeys',
    },

    controllerSupport: {
      radialMenus: true, // 많은 선택지를 컨트롤러로
      hapticFeedback: true,
      buttonRemapping: true,
    }
  },

  // 텍스트 가독성
  textReadability: {
    fontFamily: 'dyslexia-friendly option',
    fontSize: 'adjustable',
    contrast: 'WCAG AAA compliant',
    textToSpeech: 'for tooltips and descriptions',
  }
};
```

---

## 5. 구현 우선순위 및 권장사항

### 5.1 MVP 기능 (Phase 1)

```typescript
const Phase1_MVP = {
  runProgression: {
    // 필수
    linearStageProgression: true,
    simpleMapVisualization: true,
    basicRewardSelection: true,

    // 생략 가능
    branchingPaths: false,
    fogOfWar: false,
  },

  buildSystem: {
    // 필수
    basicInventory: true, // 그리드 기반
    equipmentSlots: true,
    statDisplay: true,

    // 생략 가능
    skillTree: false, // Phase 2로 연기
    synergyVisualization: false,
    advancedCrafting: false,
  },

  combatFeedback: {
    // 필수
    basicDamageNumbers: true,
    healthBars: true,
    simpleHitEffect: true,

    // 생략 가능
    criticalAnimations: false, // 나중에 추가
    comboSystem: false,
    particleEffects: 'minimal',
  },

  metaProgression: {
    // 필수
    currencySystem: true,
    simpleUpgrades: true, // 5-10개 정도
    basicUnlocks: true,

    // 생략 가능
    complexSkillTree: false,
    achievementSystem: false,
    statisticsTracking: 'basic only',
  }
};
```

### 5.2 고급 기능 (Phase 2)

```typescript
const Phase2_Advanced = {
  runProgression: {
    branchingPaths: true,
    difficultyModifiers: true,
    dailyChallenges: true,
  },

  buildSystem: {
    fullSkillTree: true,
    synergyDetection: true,
    buildTemplates: true, // 저장/불러오기
    buildSharing: true, // 코드로 공유
  },

  combatFeedback: {
    advancedParticles: true,
    screenShake: true,
    comboSystem: true,
    slowMotionKills: true,
  },

  metaProgression: {
    achievementSystem: true,
    leaderboards: true,
    detailedStatistics: true,
    seasonalContent: true,
  }
};
```

### 5.3 UX 폴리싱 체크리스트

```markdown
## 피드백 루프
- [ ] 모든 액션에 즉각적인 시각/청각 피드백
- [ ] 대기 시간 최소화 (로딩 < 1초)
- [ ] 애니메이션 스키핑 가능 (ESC 키)

## 정보 전달
- [ ] 중요 정보는 항상 화면에 표시 (HP, 자원)
- [ ] 복잡한 메커니즘은 튜토리얼 제공
- [ ] 툴팁은 호버 0.5초 후 표시

## 선택과 결과
- [ ] 선택지는 명확한 트레이드오프
- [ ] 결과 미리보기 제공 (스탯 변화 등)
- [ ] 되돌리기 가능한 결정 표시

## 진행감
- [ ] 매 run마다 "뭔가 얻는" 느낌
- [ ] 단기/중기/장기 목표 병존
- [ ] 진행률을 시각적으로 표시 (프로그레스 바)

## 실패 처리
- [ ] 실패해도 부정적이지 않은 메시지
- [ ] 실패 원인 분석 제공
- [ ] 즉시 재시작 가능 (1클릭)

## 발견의 즐거움
- [ ] 히든 요소 존재 암시
- [ ] 새 언락 시 축하 연출
- [ ] 희귀 아이템은 특별한 표현

## 성능
- [ ] 60 FPS 유지
- [ ] 파티클은 설정에서 조절 가능
- [ ] 저사양 옵션 제공
```

---

## 6. 참고 자료

### 6.1 벤치마크 게임

| 게임 | 강점 | 약점 |
|------|------|------|
| **Hades** | 시너지 시각화, 메타 진행 동기부여, 스토리 통합 | 스킬 트리 부재, 빌드 다양성 제한적 |
| **Slay the Spire** | 맵 가독성, 카드 시너지 명확, 리플레이성 | 시각적 피드백 약함, 전투가 정적 |
| **Dead Cells** | 액션감, 빠른 피드백, 아이템 풀 방대 | 복잡한 언락 구조, 초반 진입장벽 |
| **Risk of Rain 2** | 아이템 스택 만족감, 3D 전투, 협동 | UI 가독성 낮음, 정보 과다 |
| **Binding of Isaac** | 랜덤성, 아이템 조합 무한대 | UI 불친절, 시너지 불명확 |
| **Enter the Gungeon** | 총기 다양성, 비주얼 | 난이도 가혹, 메타 진행 느림 |

### 6.2 디자인 원칙 요약

1. **Clarity over Complexity**: 복잡해도 명확하게
2. **Immediate Feedback**: 모든 액션에 즉각 반응
3. **Progressive Disclosure**: 초반엔 단순, 점진적 복잡화
4. **Reward Failure**: 실패도 보상 제공
5. **Encourage Experimentation**: 리스펙 비용 낮게
6. **Visual Hierarchy**: 중요한 것이 눈에 띄게
7. **Consistent Language**: 용어/아이콘 일관성
8. **Accessibility First**: 모두가 즐길 수 있게

---

## 결론

로그라이크 장르의 성공적인 UX는 **짧은 피드백 루프**, **명확한 진행감**, **발견의 즐거움**의 균형에서 나옵니다.

핵심은:
- Run 중: 즉각적 선택과 결과, 명확한 빌드 방향성
- Run 종료: 실패해도 얻는 것이 있다는 느낌
- 메타: 장기 목표를 향한 점진적 진행

위 설계안을 바탕으로 Phase 1 MVP를 먼저 구현하고, 플레이테스트를 통해 피드백 루프를 조정한 후, Phase 2 기능을 추가하는 것을 권장합니다.
