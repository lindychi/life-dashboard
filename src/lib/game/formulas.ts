/**
 * Game Balance Formulas
 *
 * All numerical calculations for game balance.
 * Centralized formulas ensure consistency and ease of tuning.
 */

import type {
  CombatParticipant,
  StatModifier,
  ClassGrowthCurve,
  CharacterClass,
  DamageCalculation,
  EnemyDifficulty,
} from './types';

// ============================================================================
// Constants
// ============================================================================

export const GAME_CONSTANTS = {
  // Combat
  ACTION_GAUGE_MAX: 1000,
  CRITICAL_HIT_BASE_CHANCE: 5, // %
  CRITICAL_HIT_DAMAGE_MULTIPLIER: 150, // % (1.5x damage)
  DODGE_CHANCE_BASE: 5, // %
  DAMAGE_VARIANCE: 0.1, // ±10%

  // Defense formula constant
  // At DEF = ATK, damage reduced by 50%
  DEFENSE_SCALING_CONSTANT: 100,

  // Progression
  EXP_CURVE_BASE: 100,
  EXP_CURVE_EXPONENT: 2.5,
  MAX_LEVEL: 100,

  // Skill system
  SKILL_POINTS_PER_LEVEL: 1,
  STAT_POINTS_PER_LEVEL: 3,
  MAX_SKILL_LEVEL: 10,

  // Item system
  UPGRADE_BONUS_PER_LEVEL: 0.1, // 10% per upgrade level
  MAX_UPGRADE_LEVEL: 10,

  // Loot
  TREASURE_ROOM_ITEM_COUNT: 3,
  BOSS_GUARANTEED_RARE_CHANCE: 50, // %
} as const;

// ============================================================================
// Class Growth Curves
// ============================================================================

export const CLASS_GROWTH_CURVES: Record<CharacterClass, ClassGrowthCurve> = {
  warrior: {
    class: 'warrior',
    stat_growth: {
      hp: 15,
      mp: 3,
      atk: 3,
      def: 2,
      mag: 1,
      res: 1,
      spd: 2,
    },
    skill_unlocks: [
      { level: 1, skill_id: 'warrior_basic_slash' },
      { level: 5, skill_id: 'warrior_shield_bash' },
      { level: 10, skill_id: 'warrior_berserker_rage' },
      { level: 15, skill_id: 'warrior_cleave' },
      { level: 20, skill_id: 'warrior_last_stand' },
    ],
  },
  mage: {
    class: 'mage',
    stat_growth: {
      hp: 8,
      mp: 8,
      atk: 1,
      def: 1,
      mag: 4,
      res: 2,
      spd: 2,
    },
    skill_unlocks: [
      { level: 1, skill_id: 'mage_fireball' },
      { level: 5, skill_id: 'mage_frost_nova' },
      { level: 10, skill_id: 'mage_lightning_bolt' },
      { level: 15, skill_id: 'mage_meteor' },
      { level: 20, skill_id: 'mage_arcane_blast' },
    ],
  },
  rogue: {
    class: 'rogue',
    stat_growth: {
      hp: 10,
      mp: 4,
      atk: 3,
      def: 1,
      mag: 1,
      res: 1,
      spd: 4,
    },
    skill_unlocks: [
      { level: 1, skill_id: 'rogue_backstab' },
      { level: 5, skill_id: 'rogue_poison_dart' },
      { level: 10, skill_id: 'rogue_shadow_step' },
      { level: 15, skill_id: 'rogue_assassinate' },
      { level: 20, skill_id: 'rogue_smoke_bomb' },
    ],
  },
  cleric: {
    class: 'cleric',
    stat_growth: {
      hp: 12,
      mp: 6,
      atk: 2,
      def: 2,
      mag: 3,
      res: 3,
      spd: 2,
    },
    skill_unlocks: [
      { level: 1, skill_id: 'cleric_heal' },
      { level: 5, skill_id: 'cleric_smite' },
      { level: 10, skill_id: 'cleric_divine_shield' },
      { level: 15, skill_id: 'cleric_resurrection' },
      { level: 20, skill_id: 'cleric_holy_nova' },
    ],
  },
};

// ============================================================================
// Experience & Leveling
// ============================================================================

/**
 * Calculate EXP required to reach a given level
 */
export function calculateExpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(
    GAME_CONSTANTS.EXP_CURVE_BASE * Math.pow(level, GAME_CONSTANTS.EXP_CURVE_EXPONENT)
  );
}

/**
 * Calculate total EXP required from level 1 to target level
 */
export function calculateTotalExpToLevel(targetLevel: number): number {
  let total = 0;
  for (let i = 2; i <= targetLevel; i++) {
    total += calculateExpForLevel(i);
  }
  return total;
}

/**
 * Calculate what level a character should be at given total EXP
 */
export function calculateLevelFromExp(totalExp: number): number {
  let level = 1;
  let accumulated = 0;

  while (level < GAME_CONSTANTS.MAX_LEVEL) {
    const nextLevelExp = calculateExpForLevel(level + 1);
    if (accumulated + nextLevelExp > totalExp) {
      break;
    }
    accumulated += nextLevelExp;
    level++;
  }

  return level;
}

// ============================================================================
// Damage Calculation
// ============================================================================

/**
 * Calculate physical attack damage
 */
export function calculatePhysicalDamage(
  attacker: CombatParticipant,
  defender: CombatParticipant,
  skillModifier = 1.0
): DamageCalculation {
  const baseDamage = attacker.atk * skillModifier;

  // Defense reduction formula: ATK / (ATK + DEF + CONSTANT)
  // When DEF = ATK, damage is reduced to ~50%
  const defenseReduction =
    defender.def / (defender.def + GAME_CONSTANTS.DEFENSE_SCALING_CONSTANT);

  const damageAfterDefense = baseDamage * (1 - defenseReduction);

  // Critical hit check
  const critChance = Math.min(50, attacker.crit_rate); // soft cap at 50%
  const isCritical = Math.random() * 100 < critChance;

  const damageAfterCrit = isCritical
    ? damageAfterDefense * (attacker.crit_dmg / 100)
    : damageAfterDefense;

  // Random variance (±10%)
  const varianceMultiplier =
    1 - GAME_CONSTANTS.DAMAGE_VARIANCE +
    Math.random() * (GAME_CONSTANTS.DAMAGE_VARIANCE * 2);

  const finalDamage = Math.max(1, Math.floor(damageAfterCrit * varianceMultiplier));

  return {
    base_damage: baseDamage,
    defense_reduction: defenseReduction,
    final_damage: finalDamage,
    is_critical: isCritical,
    variance_multiplier: varianceMultiplier,
  };
}

/**
 * Calculate magical attack damage
 */
export function calculateMagicalDamage(
  attacker: CombatParticipant,
  defender: CombatParticipant,
  skillModifier = 1.0
): DamageCalculation {
  const baseDamage = attacker.mag * skillModifier;

  // Resistance reduction formula (same as defense)
  const resistanceReduction =
    defender.res / (defender.res + GAME_CONSTANTS.DEFENSE_SCALING_CONSTANT);

  const damageAfterResistance = baseDamage * (1 - resistanceReduction);

  // Magic attacks typically don't crit, but some skills might
  const isCritical = false;

  // Random variance
  const varianceMultiplier =
    1 - GAME_CONSTANTS.DAMAGE_VARIANCE +
    Math.random() * (GAME_CONSTANTS.DAMAGE_VARIANCE * 2);

  const finalDamage = Math.max(1, Math.floor(damageAfterResistance * varianceMultiplier));

  return {
    base_damage: baseDamage,
    defense_reduction: resistanceReduction,
    final_damage: finalDamage,
    is_critical: isCritical,
    variance_multiplier: varianceMultiplier,
  };
}

/**
 * Calculate healing amount
 */
export function calculateHealing(
  healer: CombatParticipant,
  target: CombatParticipant,
  baseHealing: number,
  isPercentage = false
): number {
  let healing = baseHealing;

  if (isPercentage) {
    healing = (target.max_hp * baseHealing) / 100;
  }

  // Healing scales with MAG stat (10% bonus per 10 MAG)
  const magBonus = 1 + healer.mag / 100;
  healing *= magBonus;

  // Random variance (±5% for healing)
  const variance = 0.95 + Math.random() * 0.1;
  healing *= variance;

  // Cannot exceed max HP
  const finalHealing = Math.min(
    Math.floor(healing),
    target.max_hp - target.current_hp
  );

  return Math.max(0, finalHealing);
}

// ============================================================================
// Stat Calculations
// ============================================================================

/**
 * Apply stat modifiers to base stats
 */
export function applyStatModifiers(
  baseValue: number,
  modifiers: StatModifier[]
): number {
  let flat = 0;
  let percentage = 0;

  for (const modifier of modifiers) {
    if (modifier.is_percentage) {
      percentage += modifier.value;
    } else {
      flat += modifier.value;
    }
  }

  // Apply flat bonuses first, then percentage
  const result = (baseValue + flat) * (1 + percentage / 100);

  return Math.floor(result);
}

/**
 * Calculate effective stats from base stats + equipment + buffs
 */
export function calculateEffectiveStats(
  baseStats: {
    hp: number;
    mp: number;
    atk: number;
    def: number;
    mag: number;
    res: number;
    spd: number;
  },
  modifiers: StatModifier[]
): typeof baseStats {
  const statMap: Record<string, StatModifier[]> = {
    hp: [],
    mp: [],
    atk: [],
    def: [],
    mag: [],
    res: [],
    spd: [],
  };

  // Group modifiers by stat
  for (const modifier of modifiers) {
    if (statMap[modifier.stat]) {
      statMap[modifier.stat].push(modifier);
    }
  }

  return {
    hp: applyStatModifiers(baseStats.hp, statMap.hp),
    mp: applyStatModifiers(baseStats.mp, statMap.mp),
    atk: applyStatModifiers(baseStats.atk, statMap.atk),
    def: applyStatModifiers(baseStats.def, statMap.def),
    mag: applyStatModifiers(baseStats.mag, statMap.mag),
    res: applyStatModifiers(baseStats.res, statMap.res),
    spd: applyStatModifiers(baseStats.spd, statMap.spd),
  };
}

// ============================================================================
// Enemy Scaling
// ============================================================================

export const ENEMY_DIFFICULTY_MULTIPLIERS: Record<
  EnemyDifficulty,
  {
    hp: number;
    atk: number;
    def: number;
    exp: number;
    gold: number;
  }
> = {
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

/**
 * Scale enemy stats based on level and difficulty
 */
export function scaleEnemyStats(
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    mag: number;
    res: number;
    spd: number;
  },
  level: number,
  difficulty: EnemyDifficulty
): typeof baseStats {
  const multipliers = ENEMY_DIFFICULTY_MULTIPLIERS[difficulty];

  // Linear scaling: stat * (1 + level * 0.1)
  const levelMultiplier = 1 + level * 0.1;

  return {
    hp: Math.floor(baseStats.hp * levelMultiplier * multipliers.hp),
    atk: Math.floor(baseStats.atk * levelMultiplier * multipliers.atk),
    def: Math.floor(baseStats.def * levelMultiplier * multipliers.def),
    mag: Math.floor(baseStats.mag * levelMultiplier),
    res: Math.floor(baseStats.res * levelMultiplier),
    spd: Math.floor(baseStats.spd * levelMultiplier),
  };
}

/**
 * Calculate enemy rewards based on level and difficulty
 */
export function calculateEnemyRewards(
  level: number,
  difficulty: EnemyDifficulty
): { exp: number; gold: number } {
  const multipliers = ENEMY_DIFFICULTY_MULTIPLIERS[difficulty];

  // Base rewards scale with level
  const baseExp = 10 + level * 5;
  const baseGold = 5 + level * 2;

  return {
    exp: Math.floor(baseExp * multipliers.exp),
    gold: Math.floor(baseGold * multipliers.gold),
  };
}

// ============================================================================
// Item Generation
// ============================================================================

/**
 * Calculate item stats with upgrade level applied
 */
export function calculateUpgradedItemStats(
  baseStats: StatModifier[],
  upgradeLevel: number
): StatModifier[] {
  const multiplier = 1 + upgradeLevel * GAME_CONSTANTS.UPGRADE_BONUS_PER_LEVEL;

  return baseStats.map((stat) => ({
    ...stat,
    value: Math.floor(stat.value * multiplier),
  }));
}

/**
 * Calculate item sell price based on rarity and upgrade level
 */
export function calculateItemSellPrice(
  basePrice: number,
  rarity: string,
  upgradeLevel: number
): number {
  const rarityMultipliers: Record<string, number> = {
    common: 1.0,
    uncommon: 2.0,
    rare: 5.0,
    epic: 10.0,
    legendary: 25.0,
  };

  const rarityMult = rarityMultipliers[rarity] || 1.0;
  const upgradeMult = 1 + upgradeLevel * 0.5; // 50% price increase per upgrade

  return Math.floor(basePrice * rarityMult * upgradeMult);
}

// ============================================================================
// Action Gauge System
// ============================================================================

/**
 * Calculate action gauge increment per tick
 */
export function calculateActionGaugeIncrement(speed: number): number {
  // Base speed of 10 = 10 ticks to act (1000 / 100 = 10)
  // Speed of 20 = 5 ticks to act
  return speed * 10;
}

/**
 * Determine turn order based on action gauge
 */
export function getNextActor(
  participants: CombatParticipant[]
): CombatParticipant | null {
  const ready = participants.filter(
    (p) => p.is_alive && p.action_gauge >= GAME_CONSTANTS.ACTION_GAUGE_MAX
  );

  if (ready.length === 0) {
    return null;
  }

  // If multiple ready, highest gauge goes first
  // If tied, highest speed goes first
  return ready.sort((a, b) => {
    if (a.action_gauge !== b.action_gauge) {
      return b.action_gauge - a.action_gauge;
    }
    return b.spd - a.spd;
  })[0];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Roll percentage chance (0-100)
 */
export function rollChance(percentage: number): boolean {
  return Math.random() * 100 < percentage;
}

/**
 * Random integer between min and max (inclusive)
 */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Weighted random selection
 */
export function weightedRandom<T>(
  items: T[],
  weights: number[]
): T | null {
  if (items.length === 0 || items.length !== weights.length) {
    return null;
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < items.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return items[i];
    }
  }

  return items[items.length - 1];
}
