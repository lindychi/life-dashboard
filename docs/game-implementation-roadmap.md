# Game Implementation Roadmap

## 개요

Life Dashboard에 로그라이크 게임 시스템을 단계적으로 구현하기 위한 로드맵.

---

## Phase 1: 기본 데이터 모델 (Week 1-2)

### 목표
데이터베이스 스키마와 TypeScript 타입 정의 완성

### 작업 항목

#### 1.1 데이터베이스 마이그레이션
```bash
psql life_dashboard < sql/021_game_system.sql
```

- [x] `player_characters` 테이블
- [x] `item_templates` 테이블
- [x] `inventory_items` 테이블
- [x] `skill_templates` 테이블
- [x] `player_skills` 테이블
- [x] `enemy_templates` 테이블
- [x] `dungeon_templates` 테이블
- [x] `dungeon_runs` 테이블
- [x] `combat_instances` 테이블
- [x] `affix_modifiers` 테이블
- [x] `loot_tables` 테이블
- [x] `game_config` 테이블

#### 1.2 코어 라이브러리
- [x] `src/lib/game/types.ts` - 타입 정의
- [x] `src/lib/game/formulas.ts` - 수치 계산 공식
- [x] `src/lib/game/combat-engine.ts` - 전투 엔진
- [ ] `src/lib/game/character.ts` - 캐릭터 관리
- [ ] `src/lib/game/inventory.ts` - 인벤토리 관리
- [ ] `src/lib/game/dungeon.ts` - 던전 생성
- [ ] `src/lib/game/loot.ts` - 전리품 시스템

#### 1.3 시드 데이터
- [ ] 기본 아이템 템플릿 (무기 5개, 방어구 10개, 소모품 5개)
- [ ] 기본 스킬 템플릿 (각 클래스당 5개)
- [ ] 기본 적 템플릿 (일반 5개, 정예 3개, 보스 2개)
- [ ] 기본 던전 템플릿 (Tier 1-3)

**완료 조건**: 모든 테이블 생성, 기본 시드 데이터 삽입, 타입 컴파일 성공

---

## Phase 2: 캐릭터 시스템 (Week 3-4)

### 목표
캐릭터 생성, 스탯 관리, 레벨업 시스템 구현

### 작업 항목

#### 2.1 캐릭터 CRUD
```typescript
// src/lib/game/character.ts
export async function createCharacter(
  user_id: string,
  name: string,
  class: CharacterClass
): Promise<PlayerCharacter>;

export async function getCharacter(id: string): Promise<PlayerCharacter>;
export async function updateCharacter(id: string, updates: Partial<PlayerCharacter>): Promise<void>;
export async function deleteCharacter(id: string): Promise<void>;
```

#### 2.2 레벨업 시스템
```typescript
export async function gainExperience(
  character_id: string,
  exp: number
): Promise<{ leveled_up: boolean; new_level: number }>;

export async function levelUp(character_id: string): Promise<{
  stat_increases: Record<string, number>;
  skills_unlocked: string[];
}>;
```

#### 2.3 스탯 계산
```typescript
export function calculateEffectiveStats(
  character: PlayerCharacter,
  equipment: InventoryItem[]
): EffectiveStats;
```

#### 2.4 API 라우트
- [ ] `POST /api/game/characters` - 캐릭터 생성
- [ ] `GET /api/game/characters` - 캐릭터 목록
- [ ] `GET /api/game/characters/:id` - 캐릭터 상세
- [ ] `PATCH /api/game/characters/:id` - 스탯/장비 업데이트
- [ ] `DELETE /api/game/characters/:id` - 캐릭터 삭제

#### 2.5 UI 컴포넌트
- [ ] `CharacterCreationModal.tsx` - 캐릭터 생성 UI
- [ ] `CharacterSheet.tsx` - 스탯 표시
- [ ] `LevelUpModal.tsx` - 레벨업 알림

**완료 조건**: 캐릭터 생성/조회/수정/삭제 가능, 레벨업 로직 작동, UI에서 캐릭터 정보 확인 가능

---

## Phase 3: 인벤토리 & 아이템 시스템 (Week 5-6)

### 목표
아이템 획득, 장비, 강화 시스템 구현

### 작업 항목

#### 3.1 인벤토리 관리
```typescript
// src/lib/game/inventory.ts
export async function getInventory(player_id: string): Promise<InventoryItem[]>;
export async function addItem(player_id: string, item_template_id: string, quantity: number): Promise<InventoryItem>;
export async function removeItem(item_id: string, quantity: number): Promise<void>;
export async function equipItem(item_id: string, slot: EquipmentSlot): Promise<void>;
export async function unequipItem(item_id: string): Promise<void>;
```

#### 3.2 아이템 생성
```typescript
export function generateRandomItem(
  template_id: string,
  quality: ItemQuality
): InventoryItem;

export function rollAffixes(
  item_type: ItemType,
  quality: ItemQuality
): { prefix?: AffixModifier; suffix?: AffixModifier };
```

#### 3.3 아이템 강화
```typescript
export async function upgradeItem(
  item_id: string
): Promise<{ success: boolean; new_level: number; item: InventoryItem }>;
```

#### 3.4 API 라우트
- [ ] `GET /api/game/inventory` - 인벤토리 조회
- [ ] `POST /api/game/inventory/equip` - 장비 착용
- [ ] `POST /api/game/inventory/unequip` - 장비 해제
- [ ] `POST /api/game/inventory/upgrade` - 아이템 강화
- [ ] `POST /api/game/inventory/sell` - 아이템 판매
- [ ] `POST /api/game/inventory/use` - 소모품 사용

#### 3.5 UI 컴포넌트
- [ ] `InventoryPanel.tsx` - 인벤토리 그리드
- [ ] `EquipmentSlots.tsx` - 장비 슬롯
- [ ] `ItemTooltip.tsx` - 아이템 상세 정보
- [ ] `UpgradeModal.tsx` - 아이템 강화 UI

**완료 조건**: 아이템 획득/착용/해제 가능, 랜덤 속성 생성, 강화 시스템 작동

---

## Phase 4: 전투 시스템 (Week 7-9)

### 목표
턴제 전투 로직과 UI 구현

### 작업 항목

#### 4.1 전투 초기화
```typescript
// src/lib/game/combat.ts
export async function startCombat(
  dungeon_run_id: string,
  room_id: string,
  player_ids: string[],
  enemy_template_ids: string[]
): Promise<CombatInstance>;
```

#### 4.2 전투 액션
```typescript
export async function executePlayerAction(
  combat_id: string,
  actor_id: string,
  action: PlayerAction
): Promise<CombatInstance>;

export async function executeEnemyTurn(
  combat_id: string
): Promise<CombatInstance>;
```

#### 4.3 전투 AI
```typescript
// src/lib/game/combat-ai.ts
export function selectEnemyAction(
  enemy: CombatParticipant,
  combat: CombatInstance
): CombatAction;
```

#### 4.4 API 라우트
- [ ] `POST /api/game/combat/start` - 전투 시작
- [ ] `GET /api/game/combat/:id` - 전투 상태 조회
- [ ] `POST /api/game/combat/:id/action` - 플레이어 액션 실행
- [ ] `POST /api/game/combat/:id/end` - 전투 종료 (보상 처리)

#### 4.5 UI 컴포넌트
- [ ] `CombatView.tsx` - 전투 메인 화면
- [ ] `CombatParticipant.tsx` - 참여자 상태 표시
- [ ] `ActionMenu.tsx` - 행동 선택 메뉴
- [ ] `SkillSelector.tsx` - 스킬 선택 UI
- [ ] `CombatLog.tsx` - 전투 로그
- [ ] `ActionGaugeBar.tsx` - 액션 게이지 표시

#### 4.6 애니메이션 (선택)
- [ ] 데미지 숫자 애니메이션
- [ ] 스킬 이펙트
- [ ] HP/MP 바 애니메이션

**완료 조건**: 전투 시작/진행/종료 가능, AI가 자동으로 행동, 전투 로그 확인 가능

---

## Phase 5: 던전 생성 시스템 (Week 10-11)

### 목표
절차적 던전 생성 및 탐험

### 작업 항목

#### 5.1 던전 생성
```typescript
// src/lib/game/dungeon.ts
export function generateDungeon(
  template_id: string,
  player_level: number
): DungeonRun;

export function generateRoom(
  type: DungeonRoomType,
  tier: number,
  seed: string
): DungeonRoom;
```

#### 5.2 던전 진행
```typescript
export async function moveToRoom(
  dungeon_run_id: string,
  room_id: string
): Promise<DungeonRun>;

export async function clearRoom(
  dungeon_run_id: string,
  room_id: string
): Promise<void>;
```

#### 5.3 Seeded RNG
```typescript
// src/lib/game/rng.ts
export class SeededRNG {
  constructor(seed: string);
  random(): number;
  randInt(min: number, max: number): number;
  choice<T>(array: T[]): T;
  shuffle<T>(array: T[]): T[];
}
```

#### 5.4 API 라우트
- [ ] `POST /api/game/dungeons/start` - 던전 시작
- [ ] `GET /api/game/dungeons/:id` - 던전 상태 조회
- [ ] `POST /api/game/dungeons/:id/move` - 방 이동
- [ ] `GET /api/game/dungeons/:id/map` - 맵 조회

#### 5.5 UI 컴포넌트
- [ ] `DungeonMap.tsx` - 노드 기반 맵
- [ ] `RoomNode.tsx` - 개별 방 노드
- [ ] `RoomEventModal.tsx` - 방 진입 이벤트
- [ ] `TreasureReward.tsx` - 보물 방 보상

**완료 조건**: 던전 생성, 맵 탐색, 방 클리어, 시드 기반 재현 가능

---

## Phase 6: 전리품 시스템 (Week 12)

### 목표
전투 보상 및 드랍 시스템

### 작업 항목

#### 6.1 전리품 테이블
```typescript
// src/lib/game/loot.ts
export function rollLoot(
  loot_table_id: string,
  luck_modifier: number
): ItemDrop[];

export function calculateDropQuality(
  base_weights: QualityWeights,
  luck: number
): ItemQuality;
```

#### 6.2 보상 분배
```typescript
export async function distributeCombatRewards(
  combat_id: string,
  player_ids: string[]
): Promise<CombatReward>;
```

#### 6.3 UI 컴포넌트
- [ ] `LootRewardModal.tsx` - 전투 후 보상 화면
- [ ] `ItemCard.tsx` - 아이템 카드 표시

**완료 조건**: 전투 승리 시 경험치/골드/아이템 획득, 확률 기반 드랍

---

## Phase 7: 밸런싱 & 튜닝 (Week 13-14)

### 목표
플레이테스트 기반 수치 조정

### 작업 항목

#### 7.1 데이터 수집
```sql
-- 평균 전투 시간
SELECT AVG(turn) FROM combat_instances WHERE phase = 'victory';

-- 클래스별 승률
SELECT class, COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*)::FLOAT
FROM dungeon_runs dr
JOIN player_characters pc ON dr.player_id = pc.id
GROUP BY class;

-- 아이템 드랍 분포
-- ...
```

#### 7.2 밸런싱 조정
- [ ] 클래스 성장 곡선 조정
- [ ] 적 스탯 조정
- [ ] 스킬 데미지/MP 밸런스
- [ ] 드랍률 조정
- [ ] 던전 난이도 조정

#### 7.3 자동 테스트
```typescript
// src/lib/game/__tests__/balance.test.ts
test('Level 10 warrior kills level 10 goblin in 3-4 hits', () => {
  // ...
});

test('Class balance: all classes have 40-60% win rate at tier 3', () => {
  // ...
});
```

**완료 조건**: 모든 클래스 밸런스, 적절한 난이도 곡선, 전투가 지루하지 않음

---

## Phase 8: UI/UX 폴리싱 (Week 15-16)

### 목표
사용자 경험 개선

### 작업 항목

#### 8.1 반응형 디자인
- [ ] 모바일 레이아웃 최적화
- [ ] 태블릿 레이아웃

#### 8.2 애니메이션
- [ ] 전환 애니메이션
- [ ] 스킬 이펙트
- [ ] 레벨업 이펙트

#### 8.3 사운드 (선택)
- [ ] BGM
- [ ] 전투 사운드
- [ ] UI 효과음

#### 8.4 튜토리얼
- [ ] 캐릭터 생성 가이드
- [ ] 전투 튜토리얼
- [ ] 인벤토리 가이드

**완료 조건**: 직관적인 UI, 부드러운 애니메이션, 신규 유저 친화적

---

## Optional Features (Future)

### Advanced Systems
- [ ] **스킬 트리**: 분기형 스킬 언락
- [ ] **클래스 전직**: 2차 클래스 시스템
- [ ] **장비 세트**: 세트 아이템 효과
- [ ] **속성 시스템**: 불/물/바람/땅 상성
- [ ] **펫/동료**: NPC 동료 시스템
- [ ] **길드**: 멀티플레이어 요소

### Content Expansion
- [ ] **추가 던전**: Tier 4-10 던전
- [ ] **보스 러시 모드**: 연속 보스전
- [ ] **데일리 챌린지**: 일일 특수 던전
- [ ] **리더보드**: 랭킹 시스템
- [ ] **시즌 패스**: 보상 시스템

### Quality of Life
- [ ] **자동 전투**: 간단한 전투 자동화
- [ ] **빠른 전투**: 전투 속도 조절
- [ ] **인벤토리 필터**: 아이템 정렬/검색
- [ ] **저장 슬롯**: 여러 캐릭터 관리
- [ ] **통계 대시보드**: 플레이 기록

---

## 개발 우선순위

### High Priority (MVP)
1. 캐릭터 생성/관리
2. 기본 전투 시스템
3. 인벤토리/장비
4. 던전 생성 (Tier 1-3만)
5. 전리품 시스템

### Medium Priority (V1.0)
6. 밸런싱
7. UI 폴리싱
8. 추가 컨텐츠 (Tier 4-6)
9. 튜토리얼

### Low Priority (V2.0+)
10. 고급 시스템
11. 멀티플레이어 요소
12. 사운드/음악

---

## 기술 스택 확인

### Backend
- [x] PostgreSQL - 게임 상태 저장
- [x] Next.js API Routes - REST API
- [x] TypeScript - 타입 안전성

### Frontend
- [x] React 19 - UI 컴포넌트
- [x] Tailwind CSS 4 - 스타일링
- [ ] Framer Motion - 애니메이션 (선택)

### Testing
- [x] Vitest - 유닛/통합 테스트
- [ ] Playwright - E2E 테스트 (선택)

---

## 성능 고려사항

### 데이터베이스 최적화
```sql
-- 전투 인스턴스는 JSONB로 저장 (빠른 읽기/쓰기)
-- 완료된 전투는 별도 아카이브 테이블로 이동
CREATE TABLE combat_archive AS SELECT * FROM combat_instances WHERE phase IN ('victory', 'defeat');
DELETE FROM combat_instances WHERE phase IN ('victory', 'defeat');
```

### 캐싱 전략
```typescript
// Redis 캐싱 (선택)
- 전투 중 참여자 상태
- 던전 맵 데이터
- 아이템 템플릿
```

### 클라이언트 최적화
```typescript
// React.memo로 불필요한 리렌더 방지
export const CombatParticipant = React.memo(({ participant }) => {
  // ...
});

// Virtual scrolling for inventory
import { useVirtualizer } from '@tanstack/react-virtual';
```

---

## 배포 체크리스트

### Pre-deployment
- [ ] 모든 마이그레이션 실행
- [ ] 시드 데이터 삽입
- [ ] 환경 변수 설정
- [ ] 프로덕션 빌드 테스트

### Deployment
```bash
# Railway deployment
railway up

# 또는 Docker
docker build -t life-dashboard-game .
docker run -p 3000:3000 life-dashboard-game
```

### Post-deployment
- [ ] 스모크 테스트
- [ ] 성능 모니터링
- [ ] 오류 추적 (Sentry)

---

## 참고 자료

### 설계 문서
- [게임 아키텍처](./game-architecture.md)
- [밸런싱 가이드](./game-balancing-guide.md)

### 코드
- `src/lib/game/types.ts` - 타입 정의
- `src/lib/game/formulas.ts` - 게임 공식
- `src/lib/game/combat-engine.ts` - 전투 로직
- `sql/021_game_system.sql` - 데이터베이스 스키마

### 외부 참고
- [Slay the Spire](https://store.steampowered.com/app/646570/Slay_the_Spire/)
- [Darkest Dungeon](https://store.steampowered.com/app/262060/Darkest_Dungeon/)
- [Balatro](https://store.steampowered.com/app/2379780/Balatro/)
