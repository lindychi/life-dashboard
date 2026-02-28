/**
 * Game System Type Definitions
 *
 * Core data models for the roguelike game system.
 * All types are designed for PostgreSQL storage with JSONB support.
 */

// ============================================================================
// Character & Stats
// ============================================================================

export type CharacterClass = 'warrior' | 'mage' | 'rogue' | 'cleric';

export interface PlayerCharacter {
  id: string;
  user_id: string;
  name: string;
  class: CharacterClass;

  // Level & Experience
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

  // Gold
  gold: number;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export type StatType = 'hp' | 'mp' | 'atk' | 'def' | 'mag' | 'res' | 'spd' | 'crit_rate' | 'crit_dmg';

export interface StatModifier {
  stat: StatType;
  value: number;
  is_percentage: boolean; // false = flat bonus, true = % bonus
}

export interface ClassGrowthCurve {
  class: CharacterClass;
  stat_growth: {
    hp: number;
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

// ============================================================================
// Combat System
// ============================================================================

export type CombatPhase = 'player_turn' | 'enemy_turn' | 'victory' | 'defeat';
export type EntityType = 'player' | 'enemy';
export type ActionType = 'attack' | 'skill' | 'item' | 'defend' | 'flee';

export interface CombatInstance {
  id: string;
  dungeon_run_id: string;
  room_id: string;
  turn: number;
  phase: CombatPhase;
  participants: CombatParticipant[];
  action_log: CombatAction[];
  rewards?: CombatReward;
  created_at: Date;
  updated_at: Date;
}

export interface CombatParticipant {
  id: string;
  combat_id: string;
  entity_type: EntityType;
  entity_id: string; // player_character_id or enemy_template_id
  position: number; // 0-5 (formation position)

  // Current Stats (during combat)
  current_hp: number;
  current_mp: number;
  action_gauge: number; // 0-1000, acts when reaches 1000

  // Status Effects
  buffs: StatusEffect[];
  debuffs: StatusEffect[];

  // Effective Stats (base + equipment + buffs)
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

export interface CombatAction {
  id: string;
  combat_id: string;
  turn: number;
  actor_id: string; // participant_id
  action_type: ActionType;

  // Targets
  target_ids: string[]; // participant_id[]

  // Action Details
  skill_id?: string;
  item_id?: string;

  // Results
  damage_dealt: number[];
  healing_done: number[];
  status_applied: StatusEffect[];

  // Metadata
  was_critical: boolean;
  was_dodged: boolean;
  combat_text: string;

  created_at: Date;
}

export type StatusEffectType = 'buff' | 'debuff';

export interface StatusEffect {
  id: string;
  name: string;
  type: StatusEffectType;

  // Stat modifier (if any)
  stat_modifier?: {
    stat: StatType;
    value: number;
    is_percentage: boolean;
  };

  // DoT/HoT (damage/heal over time)
  dot_damage?: number; // per turn

  // Duration
  duration: number; // turns remaining
  stacks: number; // for stackable effects

  // Visual
  icon: string;
}

export interface CombatReward {
  exp_gained: number;
  gold_gained: number;
  items_dropped: ItemDrop[];
}

export interface ItemDrop {
  item_template_id: string;
  quantity: number;
  rarity: ItemRarity;
}

// ============================================================================
// Item System
// ============================================================================

export type ItemType = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material';
export type EquipmentSlot = 'weapon' | 'head' | 'chest' | 'legs' | 'accessory';
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemQuality = 'normal' | 'magic' | 'rare' | 'epic';

export interface ItemTemplate {
  id: string;
  name: string;
  description: string;
  type: ItemType;
  slot?: EquipmentSlot; // for equipment
  rarity: ItemRarity;

  // Base stats (for equipment)
  base_stats?: StatModifier[];

  // Consumable effects
  consumable_effect?: ConsumableEffect;

  // Visual
  icon: string;
  sprite?: string;

  // Metadata
  max_stack: number; // 1 for equipment, 99 for consumables
  sell_price: number;
  drop_weight: number; // for loot tables
}

export interface ConsumableEffect {
  type: 'heal_hp' | 'heal_mp' | 'buff' | 'revive';
  value: number;
  duration?: number; // for buffs (in turns)
  buff_stats?: StatModifier[]; // for buff type
}

export interface InventoryItem {
  id: string;
  player_id: string;
  item_template_id: string;
  quantity: number;

  // Random modifiers (for generated equipment)
  prefix_id?: string; // affix_modifier_id
  suffix_id?: string; // affix_modifier_id

  // Upgrade level (for equipment)
  upgrade_level: number; // 0-10

  // Equipment state
  is_equipped: boolean;
  equipped_slot?: EquipmentSlot;

  acquired_at: Date;
}

export type AffixType = 'prefix' | 'suffix';

export interface AffixModifier {
  id: string;
  name: string; // e.g., "Flaming", "of Swiftness"
  type: AffixType;
  tier: number; // 1-5 (higher = better)
  modifiers: StatModifier[];
  required_item_types?: ItemType[]; // can only apply to these types
}

// ============================================================================
// Skill System
// ============================================================================

export type TargetType = 'single' | 'multi' | 'aoe' | 'self';
export type DamageType = 'physical' | 'magical';

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;

  // Cost
  mp_cost: number;
  cooldown: number; // turns

  // Targeting
  target_type: TargetType;
  max_targets?: number; // for multi-target

  // Effects
  damage_type?: DamageType;
  damage_modifier: number; // multiplier of ATK/MAG

  // Additional effects
  status_effects?: StatusEffect[];
  healing?: number; // heal amount or % of max HP

  // Requirements
  required_level: number;
  required_class?: CharacterClass;

  // Visual
  animation: string;
  icon: string;
}

export interface PlayerSkill {
  id: string;
  player_id: string;
  skill_template_id: string;
  skill_level: number; // 1-10
  current_cooldown: number; // in combat only
  unlocked_at: Date;
}

// ============================================================================
// Dungeon System
// ============================================================================

export type DungeonRoomType = 'combat' | 'elite' | 'boss' | 'treasure' | 'rest' | 'shop';
export type DungeonStatus = 'in_progress' | 'completed' | 'failed';

export interface DungeonTemplate {
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

  // Visual
  tileset: string;
  music: string;
}

export interface EnemyPoolEntry {
  enemy_template_id: string;
  weight: number;
  min_level: number;
  max_level: number;
}

export interface DungeonRun {
  id: string;
  player_id: string;
  dungeon_template_id: string;
  seed: string; // for reproducible generation

  // Generated map
  rooms: DungeonRoom[];
  current_room_id: string;

  // State
  status: DungeonStatus;
  floors_cleared: number;

  // Timestamps
  started_at: Date;
  completed_at?: Date;
}

export interface DungeonRoom {
  id: string;
  dungeon_run_id: string;
  room_number: number;
  type: DungeonRoomType;

  // Graph structure (node-based)
  connected_to: string[]; // room_ids

  // Content
  enemy_encounters?: EnemyEncounter[];
  treasure_items?: string[]; // item_template_ids

  // State
  is_cleared: boolean;
  is_current: boolean;
  is_visible: boolean; // revealed on map
}

export interface EnemyEncounter {
  enemy_template_id: string;
  level: number;
  count: number;
  positions: number[]; // formation positions
}

// ============================================================================
// Enemy System
// ============================================================================

export type EnemyDifficulty = 'normal' | 'elite' | 'boss';

export interface EnemyTemplate {
  id: string;
  name: string;
  description: string;
  difficulty: EnemyDifficulty;

  // Base stats (scaled by level)
  base_hp: number;
  base_mp: number;
  base_atk: number;
  base_def: number;
  base_mag: number;
  base_res: number;
  base_spd: number;

  // AI behavior
  ai_pattern: AIPattern;

  // Rewards
  exp_multiplier: number;
  gold_multiplier: number;

  // Visual
  sprite: string;
  icon: string;
}

export interface AIPattern {
  type: 'aggressive' | 'defensive' | 'balanced' | 'support';
  skill_preferences: {
    skill_id: string;
    priority: number; // higher = more likely to use
    condition?: AICondition;
  }[];
}

export interface AICondition {
  type: 'hp_below' | 'hp_above' | 'ally_count' | 'enemy_count';
  threshold: number;
}

// ============================================================================
// Loot System
// ============================================================================

export interface LootTable {
  id: string;
  name: string;
  entries: LootTableEntry[];
}

export interface LootTableEntry {
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

// ============================================================================
// Utility Types
// ============================================================================

export interface SeededRNG {
  seed: string;
  random(): number; // 0-1
  randInt(min: number, max: number): number;
  choice<T>(array: T[]): T;
  shuffle<T>(array: T[]): T[];
}

export interface DamageCalculation {
  base_damage: number;
  defense_reduction: number;
  final_damage: number;
  is_critical: boolean;
  variance_multiplier: number;
}

// ============================================================================
// Game Configuration
// ============================================================================

export interface GameConfig {
  // Combat
  action_gauge_max: number; // 1000
  critical_hit_base_chance: number; // %
  critical_hit_damage_multiplier: number; // %
  dodge_chance_base: number; // %

  // Progression
  exp_curve_exponent: number; // 2.5
  skill_points_per_level: number; // 1
  stat_points_per_level: number; // 3

  // Loot
  treasure_room_item_count: number; // 3
  boss_guaranteed_rare_chance: number; // %

  // Balance
  stat_multipliers: {
    warrior: ClassGrowthCurve;
    mage: ClassGrowthCurve;
    rogue: ClassGrowthCurve;
    cleric: ClassGrowthCurve;
  };
}
