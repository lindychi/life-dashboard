# Game Architecture Design

## Overview

턴제 로그라이크 게임 시스템 설계. PostgreSQL 기반의 데이터 중심 아키텍처로 확장성과 밸런싱을 고려한 모듈 구조.

## Core Design Principles

1. **Data-Driven Design**: 모든 게임 요소를 데이터로 정의하여 런타임 수정 및 밸런싱 가능
2. **Modular Architecture**: 각 시스템이 독립적으로 작동하며 명확한 인터페이스로 통신
3. **Immutable Game State**: 상태 변경은 항상 새로운 스냅샷 생성 (시간여행 디버깅, 리플레이 지원)
4. **Formula-based Balancing**: 수치는 공식 기반으로 계산하여 일관성 유지

---

## System Architecture

### 1. Combat System (전투 시스템)

#### Core Concepts
- **턴제 전투**: 속도(SPD) 기반 액션 게이지 시스템
- **액션 타입**: Attack, Skill, Item, Defend, Flee
- **데미지 계산**: 공식 기반 계산으로 일관성 보장

#### Data Model

```typescript
// 전투 인스턴스
interface CombatInstance {
  id: string;
  dungeon_run_id: string;
  room_id: string;
  turn: number;
  phase: 'player_turn' | 'enemy_turn' | 'victory' | 'defeat';
  participants: CombatParticipant[];
  action_log: CombatAction[];
  rewards?: CombatReward;
  created_at: Date;
  updated_at: Date;
}

// 전투 참여자 (플레이어 + 적)
interface CombatParticipant {
  id: string;
  combat_id: string;
  entity_type: 'player' | 'enemy';
  entity_id: string; // player_character_id or enemy_instance_id
  position: number; // 0-5 (formation position)

  // Current Stats (전투 중 변동)
  current_hp: number;
  current_mp: number;
  action_gauge: number; // 0-1000, 1000이 되면 행동

  // Status Effects
  buffs: StatusEffect[];
  debuffs: StatusEffect[];

  // Derived from base stats
  max_hp: number;
  max_mp: number;
  atk: number;
  def: number;
  mag: number;
  res: number;
  spd: number;
  crit_rate: number; // %
  crit_dmg: number; // %

  is_alive: boolean;
  created_at: Date;
}

// 전투 액션
interface CombatAction {
  id: string;
  combat_id: string;
  turn: number;
  actor_id: string; // participant_id
  action_type: 'attack' | 'skill' | 'item' | 'defend' | 'flee';

  // Target(s)
  target_ids: string[]; // participant_id[]

  // Skill/Item specific
  skill_id?: string;
  item_id?: string;

  // Results
  damage_dealt: number[];
  healing_done: number[];
  status_applied: StatusEffect[];

  // Meta
  was_critical: boolean;
  was_dodged: boolean;
  combat_text: string; // "Alice dealt 42 damage to Goblin"

  created_at: Date;
}

// 상태 효과
interface StatusEffect {
  id: string;
  name: string;
  type: 'buff' | 'debuff';
  stat_modifier?: {
    stat: 'atk' | 'def' | 'mag' | 'res' | 'spd';
    value: number; // absolute or %
    is_percentage: boolean;
  };
  dot_damage?: number; // damage/heal per turn
  duration: number; // turns remaining
  stacks: number; // for stackable effects
  icon: string;
}

// 전투 보상
interface CombatReward {
  exp_gained: number;
  gold_gained: number;
  items_dropped: ItemDrop[];
}

interface ItemDrop {
  item_template_id: string;
  quantity: number;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}
```

#### Combat Flow

```
1. Combat Init
   - Load participant stats from base entities
   - Calculate derived stats (with equipment/buffs)
   - Initialize action_gauge = SPD * 10

2. Turn Loop
   while (combat not ended):
     a. Gauge Phase
        - Increment all action_gauge by SPD
        - If action_gauge >= 1000: ready to act

     b. Action Phase
        - Get ready participant (highest gauge)
        - Player: show action menu
        - Enemy: AI decides action
        - Execute action → create CombatAction
        - Reset actor's action_gauge to 0

     c. Status Phase
        - Apply DoT/HoT effects
        - Decrement status effect durations
        - Remove expired effects

     d. Check Win/Lose
        - All enemies dead → victory
        - All players dead → defeat

3. Combat End
   - Calculate rewards
   - Update player inventory/stats
   - Return to dungeon
```

#### Damage Formula

```typescript
// Physical Attack
function calculatePhysicalDamage(
  attacker: CombatParticipant,
  defender: CombatParticipant,
  skill_modifier = 1.0
): number {
  const base_damage = attacker.atk * skill_modifier;
  const defense_reduction = defender.def / (defender.def + 100);
  const damage = base_damage * (1 - defense_reduction);

  // Critical hit check
  const is_crit = Math.random() < (attacker.crit_rate / 100);
  const final_damage = is_crit
    ? damage * (attacker.crit_dmg / 100)
    : damage;

  // Variance ±10%
  const variance = 0.9 + Math.random() * 0.2;
  return Math.floor(final_damage * variance);
}

// Magical Attack
function calculateMagicalDamage(
  attacker: CombatParticipant,
  defender: CombatParticipant,
  skill_modifier = 1.0
): number {
  const base_damage = attacker.mag * skill_modifier;
  const resistance_reduction = defender.res / (defender.res + 100);
  const damage = base_damage * (1 - resistance_reduction);

  const variance = 0.9 + Math.random() * 0.2;
  return Math.floor(damage * variance);
}
```

---

### 2. Item System (아이템 시스템)

#### Core Concepts
- **Template + Instance 패턴**: 아이템 정의(template)와 실제 소지품(instance) 분리
- **Stat Modifiers**: 장비 아이템은 스탯 수정자 리스트로 정의
- **Random Generation**: 접두사/접미사 시스템으로 랜덤 속성 생성

#### Data Model

```typescript
// 아이템 템플릿 (불변 정의)
interface ItemTemplate {
  id: string;
  name: string;
  description: string;
  type: 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material';
  slot?: 'weapon' | 'head' | 'chest' | 'legs' | 'accessory'; // for equipment
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

  // Base stats (for equipment)
  base_stats?: StatModifier[];

  // Consumable effects
  consumable_effect?: {
    type: 'heal_hp' | 'heal_mp' | 'buff' | 'revive';
    value: number;
    duration?: number; // for buffs
  };

  // Visual
  icon: string;
  sprite?: string;

  // Metadata
  max_stack: number; // 1 for equipment, 99 for consumables
  sell_price: number;
  drop_weight: number; // for loot table
}

// 스탯 수정자
interface StatModifier {
  stat: 'hp' | 'mp' | 'atk' | 'def' | 'mag' | 'res' | 'spd' | 'crit_rate' | 'crit_dmg';
  value: number;
  is_percentage: boolean; // false = flat, true = %
}

// 플레이어 인벤토리 아이템 (인스턴스)
interface InventoryItem {
  id: string;
  player_id: string;
  item_template_id: string;
  quantity: number;

  // Random modifiers (for generated equipment)
  prefix?: AffixModifier; // e.g., "Flaming" = +10% ATK
  suffix?: AffixModifier; // e.g., "of Swiftness" = +5 SPD

  // Upgrade level (for equipment)
  upgrade_level: number; // 0-10

  // Metadata
  is_equipped: boolean;
  equipped_slot?: string;
  acquired_at: Date;
}

// 접두사/접미사 시스템
interface AffixModifier {
  id: string;
  name: string; // "Flaming", "of Swiftness"
  type: 'prefix' | 'suffix';
  tier: number; // 1-5 (higher = better)
  modifiers: StatModifier[];
  required_item_type?: string[]; // 적용 가능한 아이템 타입
}
```

#### Item Generation

```typescript
function generateRandomEquipment(
  template: ItemTemplate,
  quality: 'normal' | 'magic' | 'rare' | 'epic'
): InventoryItem {
  const item: InventoryItem = {
    id: generateUUID(),
    item_template_id: template.id,
    quantity: 1,
    upgrade_level: 0,
    is_equipped: false,
    acquired_at: new Date(),
  };

  // Apply affixes based on quality
  if (quality === 'magic' || quality === 'rare' || quality === 'epic') {
    item.prefix = rollRandomAffix('prefix', template.type);
  }

  if (quality === 'rare' || quality === 'epic') {
    item.suffix = rollRandomAffix('suffix', template.type);
  }

  return item;
}

function calculateItemStats(item: InventoryItem): StatModifier[] {
  const template = getItemTemplate(item.item_template_id);
  let stats = [...template.base_stats];

  // Add prefix modifiers
  if (item.prefix) {
    stats = stats.concat(item.prefix.modifiers);
  }

  // Add suffix modifiers
  if (item.suffix) {
    stats = stats.concat(item.suffix.modifiers);
  }

  // Apply upgrade level bonus (10% per level)
  const upgrade_multiplier = 1 + (item.upgrade_level * 0.1);
  stats = stats.map(stat => ({
    ...stat,
    value: stat.value * upgrade_multiplier,
  }));

  return stats;
}
```

---

### 3. Skill System (스킬 시스템)

#### Core Concepts
- **MP 기반 스킬**: 모든 스킬은 MP 소모
- **쿨다운 시스템**: 강력한 스킬은 쿨다운 적용
- **Target System**: Single, Multi, AoE, Self 타겟팅

#### Data Model

```typescript
interface SkillTemplate {
  id: string;
  name: string;
  description: string;

  // Cost
  mp_cost: number;
  cooldown: number; // turns

  // Targeting
  target_type: 'single' | 'multi' | 'aoe' | 'self';
  max_targets?: number; // for multi

  // Effects
  damage_type?: 'physical' | 'magical';
  damage_modifier: number; // multiplier of ATK/MAG

  // Additional effects
  status_effects?: StatusEffect[];
  healing?: number; // heal amount or % of max HP

  // Requirements
  required_level: number;
  required_class?: string;

  // Animation
  animation: string;
  icon: string;
}

// 플레이어가 습득한 스킬
interface PlayerSkill {
  id: string;
  player_id: string;
  skill_template_id: string;
  skill_level: number; // 1-10
  current_cooldown: number; // in combat
  unlocked_at: Date;
}
```

#### Skill Execution

```typescript
async function executeSkill(
  combat_id: string,
  actor_id: string,
  skill_id: string,
  target_ids: string[]
): Promise<CombatAction> {
  const skill = await getSkillTemplate(skill_id);
  const actor = await getCombatParticipant(actor_id);

  // Validate MP cost
  if (actor.current_mp < skill.mp_cost) {
    throw new Error('Not enough MP');
  }

  // Deduct MP
  await updateParticipant(actor_id, {
    current_mp: actor.current_mp - skill.mp_cost,
  });

  // Execute effects on each target
  const results = await Promise.all(
    target_ids.map(target_id =>
      applySkillEffect(actor, target_id, skill)
    )
  );

  // Create action log
  const action: CombatAction = {
    id: generateUUID(),
    combat_id,
    turn: combat.turn,
    actor_id,
    action_type: 'skill',
    skill_id,
    target_ids,
    damage_dealt: results.map(r => r.damage),
    healing_done: results.map(r => r.healing),
    status_applied: results.flatMap(r => r.status_effects),
    created_at: new Date(),
  };

  await saveCombatAction(action);
  return action;
}
```

---

### 4. Progression System (진행 시스템)

#### Core Concepts
- **경험치 기반 레벨업**: 지수 곡선 EXP 요구량
- **스탯 자동 증가**: 레벨당 고정 스탯 상승
- **스킬 언락**: 특정 레벨 도달 시 스킬 습득

#### Data Model

```typescript
interface PlayerCharacter {
  id: string;
  user_id: string;
  name: string;
  class: 'warrior' | 'mage' | 'rogue' | 'cleric';

  // Level & EXP
  level: number;
  current_exp: number;
  exp_to_next_level: number;

  // Base Stats (increase per level)
  base_hp: number;
  base_mp: number;
  base_atk: number;
  base_def: number;
  base_mag: number;
  base_res: number;
  base_spd: number;

  // Current State
  current_hp: number;
  current_mp: number;

  // Progression
  skill_points: number;
  stat_points: number;

  created_at: Date;
  updated_at: Date;
}

// 클래스별 성장 곡선
interface ClassGrowthCurve {
  class: string;
  stat_growth: {
    hp: number; // per level
    mp: number;
    atk: number;
    def: number;
    mag: number;
    res: number;
    spd: number;
  };
  skill_unlocks: {
    level: number;
    skill_id: string;
  }[];
}
```

#### Leveling Formula

```typescript
function calculateExpForLevel(level: number): number {
  // Exponential curve: EXP = 100 * (level ^ 2.5)
  return Math.floor(100 * Math.pow(level, 2.5));
}

function gainExp(character: PlayerCharacter, exp_gained: number): void {
  character.current_exp += exp_gained;

  while (character.current_exp >= character.exp_to_next_level) {
    levelUp(character);
  }
}

function levelUp(character: PlayerCharacter): void {
  character.level += 1;
  character.current_exp -= character.exp_to_next_level;
  character.exp_to_next_level = calculateExpForLevel(character.level + 1);

  // Apply stat growth
  const growth = getClassGrowthCurve(character.class);
  character.base_hp += growth.stat_growth.hp;
  character.base_mp += growth.stat_growth.mp;
  character.base_atk += growth.stat_growth.atk;
  character.base_def += growth.stat_growth.def;
  character.base_mag += growth.stat_growth.mag;
  character.base_res += growth.stat_growth.res;
  character.base_spd += growth.stat_growth.spd;

  // Restore HP/MP to full
  character.current_hp = character.base_hp;
  character.current_mp = character.base_mp;

  // Grant skill points
  character.skill_points += 1;

  // Check for skill unlocks
  const unlocked_skills = growth.skill_unlocks
    .filter(unlock => unlock.level === character.level);

  for (const unlock of unlocked_skills) {
    unlockSkill(character.id, unlock.skill_id);
  }
}
```

---

### 5. Random Generation System (랜덤 생성 시스템)

#### Core Concepts
- **Seeded RNG**: 던전 시드로 재현 가능한 맵 생성
- **Room-based Dungeons**: 노드 기반 던전 구조 (Slay the Spire 스타일)
- **Weighted Loot Tables**: 가중치 기반 드랍 시스템

#### Data Model

```typescript
interface DungeonTemplate {
  id: string;
  name: string;
  description: string;
  tier: number; // 1-10 (difficulty)

  // Generation rules
  min_rooms: number;
  max_rooms: number;
  boss_room_count: number;
  treasure_room_chance: number; // %
  elite_room_chance: number; // %

  // Enemy pools
  enemy_pool: EnemyPoolEntry[];

  // Loot table
  loot_table_id: string;
}

interface DungeonRun {
  id: string;
  player_id: string;
  dungeon_template_id: string;
  seed: string; // for reproducible generation

  // Generated map
  rooms: DungeonRoom[];
  current_room_id: string;

  // State
  status: 'in_progress' | 'completed' | 'failed';
  floors_cleared: number;

  // Timestamps
  started_at: Date;
  completed_at?: Date;
}

interface DungeonRoom {
  id: string;
  dungeon_run_id: string;
  room_number: number;
  type: 'combat' | 'elite' | 'boss' | 'treasure' | 'rest' | 'shop';

  // Connections
  connected_to: string[]; // room_ids

  // Content
  enemy_encounters?: EnemyEncounter[];
  treasure_items?: string[]; // item_template_ids

  // State
  is_cleared: boolean;
  is_current: boolean;
}

interface EnemyEncounter {
  enemy_template_id: string;
  level: number;
  count: number;
  position: number[]; // formation positions
}
```

#### Dungeon Generation Algorithm

```typescript
function generateDungeon(
  template: DungeonTemplate,
  player_level: number
): DungeonRun {
  const seed = generateRandomSeed();
  const rng = createSeededRNG(seed);

  const room_count = rng.randInt(template.min_rooms, template.max_rooms);
  const rooms: DungeonRoom[] = [];

  // Always start with combat room
  rooms.push(createRoom('combat', 0, rng, template, player_level));

  // Generate middle rooms
  for (let i = 1; i < room_count - 1; i++) {
    const type = rollRoomType(rng, template);
    rooms.push(createRoom(type, i, rng, template, player_level));
  }

  // Always end with boss room
  rooms.push(createRoom('boss', room_count - 1, rng, template, player_level));

  // Create room connections (3 paths forward per room)
  connectRooms(rooms, rng);

  return {
    id: generateUUID(),
    seed,
    rooms,
    current_room_id: rooms[0].id,
    status: 'in_progress',
    floors_cleared: 0,
    started_at: new Date(),
  };
}

function rollRoomType(
  rng: SeededRNG,
  template: DungeonTemplate
): DungeonRoomType {
  const roll = rng.random();

  if (roll < template.treasure_room_chance / 100) {
    return 'treasure';
  } else if (roll < (template.treasure_room_chance + template.elite_room_chance) / 100) {
    return 'elite';
  } else if (roll < 0.85) {
    return 'combat';
  } else if (roll < 0.95) {
    return 'rest';
  } else {
    return 'shop';
  }
}
```

#### Loot Table System

```typescript
interface LootTable {
  id: string;
  name: string;
  entries: LootTableEntry[];
}

interface LootTableEntry {
  item_template_id: string;
  weight: number; // relative weight
  min_quantity: number;
  max_quantity: number;
  quality_weights: {
    normal: number;
    magic: number;
    rare: number;
    epic: number;
  };
}

function rollLoot(
  loot_table: LootTable,
  luck_modifier = 1.0
): ItemDrop[] {
  const total_weight = loot_table.entries.reduce(
    (sum, entry) => sum + entry.weight * luck_modifier,
    0
  );

  const drops: ItemDrop[] = [];
  const roll_count = Math.floor(Math.random() * 3) + 1; // 1-3 items

  for (let i = 0; i < roll_count; i++) {
    const roll = Math.random() * total_weight;
    let accumulated = 0;

    for (const entry of loot_table.entries) {
      accumulated += entry.weight * luck_modifier;

      if (roll <= accumulated) {
        const quantity = randInt(entry.min_quantity, entry.max_quantity);
        const quality = rollQuality(entry.quality_weights);

        drops.push({
          item_template_id: entry.item_template_id,
          quantity,
          rarity: quality,
        });

        break;
      }
    }
  }

  return drops;
}
```

---

## Database Schema

### Core Tables

```sql
-- Characters
CREATE TABLE player_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name VARCHAR(50) NOT NULL,
  class VARCHAR(20) NOT NULL,
  level INTEGER DEFAULT 1,
  current_exp INTEGER DEFAULT 0,
  exp_to_next_level INTEGER DEFAULT 100,
  base_hp INTEGER DEFAULT 100,
  base_mp INTEGER DEFAULT 50,
  base_atk INTEGER DEFAULT 10,
  base_def INTEGER DEFAULT 5,
  base_mag INTEGER DEFAULT 10,
  base_res INTEGER DEFAULT 5,
  base_spd INTEGER DEFAULT 10,
  current_hp INTEGER DEFAULT 100,
  current_mp INTEGER DEFAULT 50,
  skill_points INTEGER DEFAULT 0,
  stat_points INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Item Templates (read-only data)
CREATE TABLE item_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  type VARCHAR(20) NOT NULL,
  slot VARCHAR(20),
  rarity VARCHAR(20) DEFAULT 'common',
  base_stats JSONB DEFAULT '[]',
  consumable_effect JSONB,
  icon VARCHAR(255),
  max_stack INTEGER DEFAULT 1,
  sell_price INTEGER DEFAULT 0,
  drop_weight INTEGER DEFAULT 100
);

-- Player Inventory
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES player_characters(id) ON DELETE CASCADE,
  item_template_id UUID REFERENCES item_templates(id),
  quantity INTEGER DEFAULT 1,
  prefix_id UUID REFERENCES affix_modifiers(id),
  suffix_id UUID REFERENCES affix_modifiers(id),
  upgrade_level INTEGER DEFAULT 0,
  is_equipped BOOLEAN DEFAULT FALSE,
  equipped_slot VARCHAR(20),
  acquired_at TIMESTAMP DEFAULT NOW()
);

-- Skills
CREATE TABLE skill_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  mp_cost INTEGER DEFAULT 0,
  cooldown INTEGER DEFAULT 0,
  target_type VARCHAR(20) NOT NULL,
  max_targets INTEGER,
  damage_type VARCHAR(20),
  damage_modifier DECIMAL(4,2) DEFAULT 1.0,
  status_effects JSONB DEFAULT '[]',
  healing INTEGER,
  required_level INTEGER DEFAULT 1,
  required_class VARCHAR(20),
  animation VARCHAR(50),
  icon VARCHAR(255)
);

CREATE TABLE player_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES player_characters(id) ON DELETE CASCADE,
  skill_template_id UUID REFERENCES skill_templates(id),
  skill_level INTEGER DEFAULT 1,
  unlocked_at TIMESTAMP DEFAULT NOW()
);

-- Dungeons
CREATE TABLE dungeon_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  tier INTEGER DEFAULT 1,
  min_rooms INTEGER DEFAULT 10,
  max_rooms INTEGER DEFAULT 15,
  boss_room_count INTEGER DEFAULT 1,
  treasure_room_chance INTEGER DEFAULT 10,
  elite_room_chance INTEGER DEFAULT 15,
  enemy_pool JSONB DEFAULT '[]',
  loot_table_id UUID
);

CREATE TABLE dungeon_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES player_characters(id) ON DELETE CASCADE,
  dungeon_template_id UUID REFERENCES dungeon_templates(id),
  seed VARCHAR(50) NOT NULL,
  rooms JSONB NOT NULL,
  current_room_id UUID,
  status VARCHAR(20) DEFAULT 'in_progress',
  floors_cleared INTEGER DEFAULT 0,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Combat
CREATE TABLE combat_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dungeon_run_id UUID REFERENCES dungeon_runs(id) ON DELETE CASCADE,
  room_id UUID NOT NULL,
  turn INTEGER DEFAULT 1,
  phase VARCHAR(20) DEFAULT 'player_turn',
  participants JSONB NOT NULL,
  action_log JSONB DEFAULT '[]',
  rewards JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Affix Modifiers (prefixes/suffixes)
CREATE TABLE affix_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL,
  tier INTEGER DEFAULT 1,
  modifiers JSONB NOT NULL,
  required_item_types JSONB DEFAULT '[]'
);

-- Loot Tables
CREATE TABLE loot_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  entries JSONB NOT NULL
);
```

---

## Balancing Framework

### Stat Scaling Formulas

```typescript
// HP per level by class
const HP_GROWTH = {
  warrior: 15,
  rogue: 10,
  mage: 8,
  cleric: 12,
};

// Damage scaling at different levels
function expectedDamageAtLevel(level: number): number {
  // Target: kill same-level enemy in 3-4 hits
  const enemy_hp = 50 + (level * 20);
  return enemy_hp / 3.5;
}

// Defense effectiveness curve
// At DEF = ATK, damage reduced by 50%
function defenseMultiplier(def: number, atk: number): number {
  return atk / (atk + def);
}

// Critical rate soft cap at 50%
function calculateCritRate(base_crit: number, crit_stat: number): number {
  const raw_rate = base_crit + (crit_stat * 0.5);
  return Math.min(50, raw_rate); // hard cap
}
```

### Enemy Difficulty Tiers

```typescript
const ENEMY_STAT_MULTIPLIERS = {
  normal: {
    hp: 1.0,
    atk: 0.8,
    def: 0.8,
    exp: 1.0,
    gold: 1.0,
  },
  elite: {
    hp: 2.0,
    atk: 1.2,
    def: 1.2,
    exp: 3.0,
    gold: 2.5,
  },
  boss: {
    hp: 5.0,
    atk: 1.5,
    def: 1.5,
    exp: 10.0,
    gold: 5.0,
  },
};
```

---

## API Design

### REST Endpoints

```typescript
// Character Management
POST   /api/game/characters          // Create character
GET    /api/game/characters          // List characters
GET    /api/game/characters/:id      // Get character details
PATCH  /api/game/characters/:id      // Update character (level up, equip)
DELETE /api/game/characters/:id      // Delete character

// Dungeon
POST   /api/game/dungeons/start      // Start new dungeon run
GET    /api/game/dungeons/:id        // Get dungeon state
POST   /api/game/dungeons/:id/move   // Move to next room
GET    /api/game/dungeons/:id/map    // Get full map (revealed rooms)

// Combat
POST   /api/game/combat/start        // Start combat in current room
GET    /api/game/combat/:id          // Get combat state
POST   /api/game/combat/:id/action   // Execute combat action
GET    /api/game/combat/:id/end      // End combat, get rewards

// Inventory
GET    /api/game/inventory           // Get player inventory
POST   /api/game/inventory/equip     // Equip item
POST   /api/game/inventory/use       // Use consumable
POST   /api/game/inventory/sell      // Sell items

// Skills
GET    /api/game/skills              // Get learned skills
POST   /api/game/skills/unlock       // Unlock new skill
POST   /api/game/skills/upgrade      // Upgrade skill level
```

---

## Frontend Architecture

### Component Structure

```
src/components/game/
├── CharacterSheet.tsx       // Character stats & equipment
├── InventoryPanel.tsx       // Item management UI
├── SkillTree.tsx            // Skill unlock/upgrade UI
├── DungeonMap.tsx           // Node-based dungeon map
├── CombatView.tsx           // Turn-based combat UI
│   ├── CombatParticipant.tsx
│   ├── ActionMenu.tsx
│   ├── SkillSelector.tsx
│   └── CombatLog.tsx
└── LootReward.tsx           // Post-combat loot screen
```

### State Management

```typescript
// Using React Context + Reducer
interface GameState {
  character: PlayerCharacter | null;
  inventory: InventoryItem[];
  skills: PlayerSkill[];
  dungeon: DungeonRun | null;
  combat: CombatInstance | null;
}

type GameAction =
  | { type: 'LOAD_CHARACTER'; character: PlayerCharacter }
  | { type: 'UPDATE_HP'; hp: number }
  | { type: 'GAIN_EXP'; exp: number }
  | { type: 'ADD_ITEM'; item: InventoryItem }
  | { type: 'START_COMBAT'; combat: CombatInstance }
  | { type: 'COMBAT_ACTION'; action: CombatAction }
  | { type: 'END_COMBAT'; rewards: CombatReward };
```

---

## Performance Considerations

1. **Combat State Caching**: 전투 중 참여자 상태를 Redis에 캐싱하여 DB 부하 감소
2. **Lazy Loading**: 던전 방은 필요할 때만 생성 (현재 방 + 인접 방만 메모리에 유지)
3. **Action Log Pagination**: 전투 로그는 최근 50개만 클라이언트에 전송
4. **Asset Preloading**: 던전 입장 시 필요한 이미지/스프라이트 미리 로드

---

## Next Steps

1. **Phase 1**: 기본 데이터 모델 구현 (DB 스키마, 타입 정의)
2. **Phase 2**: 전투 시스템 프로토타입 (턴제 전투 로직)
3. **Phase 3**: 아이템 시스템 (인벤토리, 장비)
4. **Phase 4**: 던전 생성 (랜덤 맵, 적 배치)
5. **Phase 5**: 진행 시스템 (레벨업, 스킬 언락)
6. **Phase 6**: 밸런싱 & 튜닝 (플레이테스트 기반)

---

## References

- **Slay the Spire**: Node-based dungeon structure
- **Darkest Dungeon**: Position-based combat system
- **Diablo 2**: Prefix/Suffix item generation
- **Final Fantasy Tactics**: Turn-based combat formulas
