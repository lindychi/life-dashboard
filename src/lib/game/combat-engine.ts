/**
 * Combat Engine
 *
 * Core turn-based combat logic.
 * Handles action execution, status effects, and combat flow.
 */

import type {
  CombatInstance,
  CombatParticipant,
  CombatAction,
  ActionType,
  StatusEffect,
  SkillTemplate,
  CombatReward,
  ItemDrop,
} from './types';

import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHealing,
  calculateActionGaugeIncrement,
  getNextActor,
  rollChance,
  GAME_CONSTANTS,
} from './formulas';

// ============================================================================
// Combat Initialization
// ============================================================================

/**
 * Initialize a new combat instance
 */
export function initializeCombat(
  dungeon_run_id: string,
  room_id: string,
  playerParticipants: Omit<CombatParticipant, 'id' | 'combat_id' | 'action_gauge' | 'buffs' | 'debuffs' | 'is_alive' | 'created_at'>[],
  enemyParticipants: Omit<CombatParticipant, 'id' | 'combat_id' | 'action_gauge' | 'buffs' | 'debuffs' | 'is_alive' | 'created_at'>[]
): CombatInstance {
  const combat_id = generateUUID();
  const now = new Date();

  const participants: CombatParticipant[] = [
    ...playerParticipants.map((p) => ({
      ...p,
      id: generateUUID(),
      combat_id,
      action_gauge: p.spd * 10, // Initial gauge based on speed
      buffs: [],
      debuffs: [],
      is_alive: true,
      created_at: now,
    })),
    ...enemyParticipants.map((p) => ({
      ...p,
      id: generateUUID(),
      combat_id,
      action_gauge: p.spd * 10,
      buffs: [],
      debuffs: [],
      is_alive: true,
      created_at: now,
    })),
  ];

  return {
    id: combat_id,
    dungeon_run_id,
    room_id,
    turn: 1,
    phase: 'player_turn',
    participants,
    action_log: [],
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Combat Flow
// ============================================================================

/**
 * Advance combat state by one tick
 * Returns true if an action is ready to be taken
 */
export function tickCombat(combat: CombatInstance): {
  combat: CombatInstance;
  ready_actor: CombatParticipant | null;
} {
  // Increment all action gauges
  const updatedParticipants = combat.participants.map((p) => {
    if (!p.is_alive) return p;

    return {
      ...p,
      action_gauge: p.action_gauge + calculateActionGaugeIncrement(p.spd),
    };
  });

  const updatedCombat = {
    ...combat,
    participants: updatedParticipants,
    updated_at: new Date(),
  };

  // Check if anyone is ready to act
  const readyActor = getNextActor(updatedCombat.participants);

  return {
    combat: updatedCombat,
    ready_actor: readyActor,
  };
}

/**
 * Execute a combat action
 */
export async function executeCombatAction(
  combat: CombatInstance,
  actor_id: string,
  action_type: ActionType,
  target_ids: string[],
  skill_id?: string,
  item_id?: string
): Promise<CombatInstance> {
  const actor = combat.participants.find((p) => p.id === actor_id);
  if (!actor || !actor.is_alive) {
    throw new Error('Invalid actor');
  }

  let action: CombatAction;

  switch (action_type) {
    case 'attack':
      action = executeBasicAttack(combat, actor, target_ids);
      break;
    case 'skill':
      if (!skill_id) throw new Error('Skill ID required');
      action = await executeSkill(combat, actor, target_ids, skill_id);
      break;
    case 'defend':
      action = executeDefend(combat, actor);
      break;
    case 'flee':
      action = executeFlee(combat, actor);
      break;
    default:
      throw new Error(`Unsupported action type: ${action_type}`);
  }

  // Reset actor's action gauge
  const updatedParticipants = combat.participants.map((p) =>
    p.id === actor_id ? { ...p, action_gauge: 0 } : p
  );

  // Apply action results to participants
  const finalParticipants = applyActionResults(updatedParticipants, action);

  // Check for victory/defeat
  const phase = determinePhase(finalParticipants);

  const updatedCombat: CombatInstance = {
    ...combat,
    participants: finalParticipants,
    action_log: [...combat.action_log, action],
    turn: combat.turn + 1,
    phase,
    updated_at: new Date(),
  };

  // If combat ended, calculate rewards
  if (phase === 'victory') {
    updatedCombat.rewards = calculateRewards(combat);
  }

  return updatedCombat;
}

// ============================================================================
// Action Implementations
// ============================================================================

/**
 * Execute basic attack
 */
function executeBasicAttack(
  combat: CombatInstance,
  actor: CombatParticipant,
  target_ids: string[]
): CombatAction {
  const target = combat.participants.find((p) => p.id === target_ids[0]);
  if (!target) {
    throw new Error('Invalid target');
  }

  const damageCalc = calculatePhysicalDamage(actor, target, 1.0);

  return {
    id: generateUUID(),
    combat_id: combat.id,
    turn: combat.turn,
    actor_id: actor.id,
    action_type: 'attack',
    target_ids,
    damage_dealt: [damageCalc.final_damage],
    healing_done: [],
    status_applied: [],
    was_critical: damageCalc.is_critical,
    was_dodged: false,
    combat_text: `${getParticipantName(actor)} ${damageCalc.is_critical ? 'critically ' : ''}attacked ${getParticipantName(target)} for ${damageCalc.final_damage} damage!`,
    created_at: new Date(),
  };
}

/**
 * Execute skill
 */
async function executeSkill(
  combat: CombatInstance,
  actor: CombatParticipant,
  target_ids: string[],
  skill_id: string
): Promise<CombatAction> {
  // In production, fetch from database
  const skill = await getSkillTemplate(skill_id);

  // Check MP cost
  if (actor.current_mp < skill.mp_cost) {
    throw new Error('Not enough MP');
  }

  const damage_dealt: number[] = [];
  const healing_done: number[] = [];
  const status_applied: StatusEffect[] = [];
  let combatText = `${getParticipantName(actor)} used ${skill.name}!`;

  // Apply effects to each target
  for (const target_id of target_ids) {
    const target = combat.participants.find((p) => p.id === target_id);
    if (!target) continue;

    // Damage
    if (skill.damage_type && skill.damage_modifier > 0) {
      const damageCalc =
        skill.damage_type === 'physical'
          ? calculatePhysicalDamage(actor, target, skill.damage_modifier)
          : calculateMagicalDamage(actor, target, skill.damage_modifier);

      damage_dealt.push(damageCalc.final_damage);
      combatText += ` ${damageCalc.final_damage} damage to ${getParticipantName(target)}.`;
    }

    // Healing
    if (skill.healing && skill.healing > 0) {
      const healAmount = calculateHealing(actor, target, skill.healing, false);
      healing_done.push(healAmount);
      combatText += ` Healed ${getParticipantName(target)} for ${healAmount} HP.`;
    }

    // Status effects
    if (skill.status_effects && skill.status_effects.length > 0) {
      status_applied.push(...skill.status_effects);
    }
  }

  // Deduct MP from actor (will be applied in applyActionResults)
  return {
    id: generateUUID(),
    combat_id: combat.id,
    turn: combat.turn,
    actor_id: actor.id,
    action_type: 'skill',
    skill_id,
    target_ids,
    damage_dealt,
    healing_done,
    status_applied,
    was_critical: false,
    was_dodged: false,
    combat_text: combatText,
    created_at: new Date(),
  };
}

/**
 * Execute defend (increase defense for 1 turn)
 */
function executeDefend(
  combat: CombatInstance,
  actor: CombatParticipant
): CombatAction {
  const defendBuff: StatusEffect = {
    id: generateUUID(),
    name: 'Defend',
    type: 'buff',
    stat_modifier: {
      stat: 'def',
      value: 50,
      is_percentage: true, // +50% DEF
    },
    duration: 1,
    stacks: 1,
    icon: 'shield',
  };

  return {
    id: generateUUID(),
    combat_id: combat.id,
    turn: combat.turn,
    actor_id: actor.id,
    action_type: 'defend',
    target_ids: [actor.id],
    damage_dealt: [],
    healing_done: [],
    status_applied: [defendBuff],
    was_critical: false,
    was_dodged: false,
    combat_text: `${getParticipantName(actor)} takes a defensive stance!`,
    created_at: new Date(),
  };
}

/**
 * Execute flee (attempt to escape combat)
 */
function executeFlee(
  combat: CombatInstance,
  actor: CombatParticipant
): CombatAction {
  // Flee chance based on speed difference
  const averageEnemySpeed =
    combat.participants
      .filter((p) => p.entity_type === 'enemy' && p.is_alive)
      .reduce((sum, p) => sum + p.spd, 0) /
    combat.participants.filter((p) => p.entity_type === 'enemy' && p.is_alive).length;

  const fleeChance = Math.min(90, 50 + (actor.spd - averageEnemySpeed) * 2);
  const success = rollChance(fleeChance);

  return {
    id: generateUUID(),
    combat_id: combat.id,
    turn: combat.turn,
    actor_id: actor.id,
    action_type: 'flee',
    target_ids: [],
    damage_dealt: [],
    healing_done: [],
    status_applied: [],
    was_critical: false,
    was_dodged: false,
    combat_text: success
      ? `${getParticipantName(actor)} successfully fled!`
      : `${getParticipantName(actor)} failed to flee!`,
    created_at: new Date(),
  };
}

// ============================================================================
// Result Application
// ============================================================================

/**
 * Apply action results to combat participants
 */
function applyActionResults(
  participants: CombatParticipant[],
  action: CombatAction
): CombatParticipant[] {
  return participants.map((participant) => {
    let updated = { ...participant };

    // Apply damage
    const targetIndex = action.target_ids.indexOf(participant.id);
    if (targetIndex !== -1 && action.damage_dealt[targetIndex]) {
      updated.current_hp = Math.max(0, updated.current_hp - action.damage_dealt[targetIndex]);
      if (updated.current_hp === 0) {
        updated.is_alive = false;
      }
    }

    // Apply healing
    if (targetIndex !== -1 && action.healing_done[targetIndex]) {
      updated.current_hp = Math.min(
        updated.max_hp,
        updated.current_hp + action.healing_done[targetIndex]
      );
    }

    // Apply status effects
    if (action.target_ids.includes(participant.id) && action.status_applied.length > 0) {
      for (const status of action.status_applied) {
        if (status.type === 'buff') {
          updated.buffs = [...updated.buffs, status];
        } else {
          updated.debuffs = [...updated.debuffs, status];
        }
      }
    }

    // Deduct MP for skill user
    if (participant.id === action.actor_id && action.skill_id) {
      // Would need to look up MP cost from skill template
      // For now, placeholder
      updated.current_mp = Math.max(0, updated.current_mp - 10);
    }

    return updated;
  });
}

/**
 * Process status effects (DoT, duration decay)
 */
export function processStatusEffects(combat: CombatInstance): CombatInstance {
  const updatedParticipants = combat.participants.map((participant) => {
    if (!participant.is_alive) return participant;

    let updated = { ...participant };

    // Process buffs
    const activeBuf: StatusEffect[] = [];
    for (const buff of updated.buffs) {
      // Apply DoT/HoT
      if (buff.dot_damage && buff.dot_damage !== 0) {
        if (buff.dot_damage > 0) {
          updated.current_hp = Math.max(0, updated.current_hp - buff.dot_damage);
        } else {
          updated.current_hp = Math.min(updated.max_hp, updated.current_hp + Math.abs(buff.dot_damage));
        }
      }

      // Decrement duration
      const newDuration = buff.duration - 1;
      if (newDuration > 0) {
        activeBuf.push({ ...buff, duration: newDuration });
      }
    }
    updated.buffs = activeBuf;

    // Process debuffs
    const activeDebuffs: StatusEffect[] = [];
    for (const debuff of updated.debuffs) {
      if (debuff.dot_damage && debuff.dot_damage !== 0) {
        updated.current_hp = Math.max(0, updated.current_hp - debuff.dot_damage);
      }

      const newDuration = debuff.duration - 1;
      if (newDuration > 0) {
        activeDebuffs.push({ ...debuff, duration: newDuration });
      }
    }
    updated.debuffs = activeDebuffs;

    // Check death from DoT
    if (updated.current_hp === 0) {
      updated.is_alive = false;
    }

    return updated;
  });

  return {
    ...combat,
    participants: updatedParticipants,
    updated_at: new Date(),
  };
}

// ============================================================================
// Combat State Checks
// ============================================================================

/**
 * Determine current combat phase
 */
function determinePhase(participants: CombatParticipant[]): CombatInstance['phase'] {
  const playersAlive = participants.filter((p) => p.entity_type === 'player' && p.is_alive).length;
  const enemiesAlive = participants.filter((p) => p.entity_type === 'enemy' && p.is_alive).length;

  if (enemiesAlive === 0) return 'victory';
  if (playersAlive === 0) return 'defeat';

  // Determine whose turn based on next actor
  const nextActor = getNextActor(participants);
  if (!nextActor) return 'player_turn'; // Default

  return nextActor.entity_type === 'player' ? 'player_turn' : 'enemy_turn';
}

/**
 * Check if combat has ended
 */
export function isCombatEnded(combat: CombatInstance): boolean {
  return combat.phase === 'victory' || combat.phase === 'defeat';
}

// ============================================================================
// Rewards
// ============================================================================

/**
 * Calculate combat rewards on victory
 */
function calculateRewards(combat: CombatInstance): CombatReward {
  const enemies = combat.participants.filter((p) => p.entity_type === 'enemy');

  let totalExp = 0;
  let totalGold = 0;

  for (const enemy of enemies) {
    // Would calculate based on enemy template in production
    // Placeholder values
    totalExp += 50;
    totalGold += 25;
  }

  // Roll for item drops (placeholder)
  const items_dropped: ItemDrop[] = [];

  return {
    exp_gained: totalExp,
    gold_gained: totalGold,
    items_dropped,
  };
}

// ============================================================================
// Utilities
// ============================================================================

function generateUUID(): string {
  return crypto.randomUUID();
}

function getParticipantName(participant: CombatParticipant): string {
  // In production, look up name from entity
  return participant.entity_type === 'player' ? 'Player' : 'Enemy';
}

async function getSkillTemplate(skill_id: string): Promise<SkillTemplate> {
  // In production, fetch from database
  // Placeholder
  return {
    id: skill_id,
    name: 'Placeholder Skill',
    description: '',
    mp_cost: 10,
    cooldown: 0,
    target_type: 'single',
    damage_type: 'physical',
    damage_modifier: 1.5,
    required_level: 1,
    animation: '',
    icon: '',
  };
}
