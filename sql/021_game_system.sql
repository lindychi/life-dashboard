-- Game System Database Schema
-- Roguelike game tables for Life Dashboard

-- ============================================================================
-- Character System
-- ============================================================================

CREATE TABLE IF NOT EXISTS player_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL, -- from auth system
  name VARCHAR(50) NOT NULL,
  class VARCHAR(20) NOT NULL CHECK (class IN ('warrior', 'mage', 'rogue', 'cleric')),

  -- Level & Experience
  level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 100),
  current_exp INTEGER DEFAULT 0 CHECK (current_exp >= 0),
  exp_to_next_level INTEGER DEFAULT 100,

  -- Base Stats (increase per level)
  base_hp INTEGER DEFAULT 100 CHECK (base_hp > 0),
  base_mp INTEGER DEFAULT 50 CHECK (base_mp >= 0),
  base_atk INTEGER DEFAULT 10 CHECK (base_atk >= 0),
  base_def INTEGER DEFAULT 5 CHECK (base_def >= 0),
  base_mag INTEGER DEFAULT 10 CHECK (base_mag >= 0),
  base_res INTEGER DEFAULT 5 CHECK (base_res >= 0),
  base_spd INTEGER DEFAULT 10 CHECK (base_spd > 0),

  -- Current State
  current_hp INTEGER DEFAULT 100 CHECK (current_hp >= 0),
  current_mp INTEGER DEFAULT 50 CHECK (current_mp >= 0),

  -- Progression
  skill_points INTEGER DEFAULT 0 CHECK (skill_points >= 0),
  stat_points INTEGER DEFAULT 0 CHECK (stat_points >= 0),

  -- Currency
  gold INTEGER DEFAULT 0 CHECK (gold >= 0),

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, name)
);

CREATE INDEX idx_player_characters_user_id ON player_characters(user_id);

-- ============================================================================
-- Item System
-- ============================================================================

-- Item Templates (read-only game data)
CREATE TABLE IF NOT EXISTS item_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('weapon', 'armor', 'accessory', 'consumable', 'material')),
  slot VARCHAR(20) CHECK (slot IN ('weapon', 'head', 'chest', 'legs', 'accessory')),
  rarity VARCHAR(20) DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),

  -- Stats (JSONB array of StatModifier objects)
  base_stats JSONB DEFAULT '[]',

  -- Consumable effects (JSONB object)
  consumable_effect JSONB,

  -- Visual
  icon VARCHAR(255),
  sprite VARCHAR(255),

  -- Metadata
  max_stack INTEGER DEFAULT 1 CHECK (max_stack > 0),
  sell_price INTEGER DEFAULT 0 CHECK (sell_price >= 0),
  drop_weight INTEGER DEFAULT 100 CHECK (drop_weight >= 0)
);

CREATE INDEX idx_item_templates_type ON item_templates(type);
CREATE INDEX idx_item_templates_rarity ON item_templates(rarity);

-- Affix Modifiers (prefixes/suffixes for random item generation)
CREATE TABLE IF NOT EXISTS affix_modifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL CHECK (type IN ('prefix', 'suffix')),
  tier INTEGER DEFAULT 1 CHECK (tier >= 1 AND tier <= 5),

  -- Modifiers (JSONB array of StatModifier objects)
  modifiers JSONB NOT NULL,

  -- Restrictions (JSONB array of item types)
  required_item_types JSONB DEFAULT '[]',

  UNIQUE(name, type)
);

CREATE INDEX idx_affix_modifiers_type ON affix_modifiers(type);
CREATE INDEX idx_affix_modifiers_tier ON affix_modifiers(tier);

-- Player Inventory (item instances)
CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  item_template_id UUID NOT NULL REFERENCES item_templates(id),
  quantity INTEGER DEFAULT 1 CHECK (quantity > 0),

  -- Random modifiers (for generated equipment)
  prefix_id UUID REFERENCES affix_modifiers(id),
  suffix_id UUID REFERENCES affix_modifiers(id),

  -- Upgrade level (for equipment)
  upgrade_level INTEGER DEFAULT 0 CHECK (upgrade_level >= 0 AND upgrade_level <= 10),

  -- Equipment state
  is_equipped BOOLEAN DEFAULT FALSE,
  equipped_slot VARCHAR(20),

  acquired_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_inventory_items_player_id ON inventory_items(player_id);
CREATE INDEX idx_inventory_items_equipped ON inventory_items(player_id, is_equipped) WHERE is_equipped = TRUE;

-- ============================================================================
-- Skill System
-- ============================================================================

-- Skill Templates (read-only game data)
CREATE TABLE IF NOT EXISTS skill_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,

  -- Cost
  mp_cost INTEGER DEFAULT 0 CHECK (mp_cost >= 0),
  cooldown INTEGER DEFAULT 0 CHECK (cooldown >= 0),

  -- Targeting
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('single', 'multi', 'aoe', 'self')),
  max_targets INTEGER CHECK (max_targets > 0),

  -- Effects
  damage_type VARCHAR(20) CHECK (damage_type IN ('physical', 'magical')),
  damage_modifier DECIMAL(4,2) DEFAULT 1.0 CHECK (damage_modifier >= 0),

  -- Additional effects (JSONB array)
  status_effects JSONB DEFAULT '[]',
  healing INTEGER CHECK (healing >= 0),

  -- Requirements
  required_level INTEGER DEFAULT 1 CHECK (required_level >= 1),
  required_class VARCHAR(20) CHECK (required_class IN ('warrior', 'mage', 'rogue', 'cleric')),

  -- Visual
  animation VARCHAR(50),
  icon VARCHAR(255)
);

CREATE INDEX idx_skill_templates_class ON skill_templates(required_class);
CREATE INDEX idx_skill_templates_level ON skill_templates(required_level);

-- Player Skills (learned skills)
CREATE TABLE IF NOT EXISTS player_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  skill_template_id UUID NOT NULL REFERENCES skill_templates(id),
  skill_level INTEGER DEFAULT 1 CHECK (skill_level >= 1 AND skill_level <= 10),
  unlocked_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(player_id, skill_template_id)
);

CREATE INDEX idx_player_skills_player_id ON player_skills(player_id);

-- ============================================================================
-- Enemy System
-- ============================================================================

-- Enemy Templates (read-only game data)
CREATE TABLE IF NOT EXISTS enemy_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  difficulty VARCHAR(20) DEFAULT 'normal' CHECK (difficulty IN ('normal', 'elite', 'boss')),

  -- Base stats (scaled by level)
  base_hp INTEGER DEFAULT 50 CHECK (base_hp > 0),
  base_mp INTEGER DEFAULT 20 CHECK (base_mp >= 0),
  base_atk INTEGER DEFAULT 8 CHECK (base_atk >= 0),
  base_def INTEGER DEFAULT 3 CHECK (base_def >= 0),
  base_mag INTEGER DEFAULT 5 CHECK (base_mag >= 0),
  base_res INTEGER DEFAULT 3 CHECK (base_res >= 0),
  base_spd INTEGER DEFAULT 8 CHECK (base_spd > 0),

  -- AI behavior (JSONB object)
  ai_pattern JSONB NOT NULL,

  -- Rewards
  exp_multiplier DECIMAL(3,2) DEFAULT 1.0 CHECK (exp_multiplier > 0),
  gold_multiplier DECIMAL(3,2) DEFAULT 1.0 CHECK (gold_multiplier > 0),

  -- Visual
  sprite VARCHAR(255),
  icon VARCHAR(255)
);

CREATE INDEX idx_enemy_templates_difficulty ON enemy_templates(difficulty);

-- ============================================================================
-- Loot System
-- ============================================================================

-- Loot Tables (read-only game data)
CREATE TABLE IF NOT EXISTS loot_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,

  -- Entries (JSONB array of LootTableEntry objects)
  entries JSONB NOT NULL
);

-- ============================================================================
-- Dungeon System
-- ============================================================================

-- Dungeon Templates (read-only game data)
CREATE TABLE IF NOT EXISTS dungeon_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  tier INTEGER DEFAULT 1 CHECK (tier >= 1 AND tier <= 10),

  -- Generation rules
  min_rooms INTEGER DEFAULT 10 CHECK (min_rooms >= 5),
  max_rooms INTEGER DEFAULT 15 CHECK (max_rooms >= min_rooms),
  boss_room_count INTEGER DEFAULT 1 CHECK (boss_room_count >= 1),
  treasure_room_chance INTEGER DEFAULT 10 CHECK (treasure_room_chance >= 0 AND treasure_room_chance <= 100),
  elite_room_chance INTEGER DEFAULT 15 CHECK (elite_room_chance >= 0 AND elite_room_chance <= 100),

  -- Enemy pools (JSONB array)
  enemy_pool JSONB DEFAULT '[]',

  -- Loot table
  loot_table_id UUID REFERENCES loot_tables(id),

  -- Visual
  tileset VARCHAR(50),
  music VARCHAR(50)
);

CREATE INDEX idx_dungeon_templates_tier ON dungeon_templates(tier);

-- Dungeon Runs (active dungeon instances)
CREATE TABLE IF NOT EXISTS dungeon_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES player_characters(id) ON DELETE CASCADE,
  dungeon_template_id UUID NOT NULL REFERENCES dungeon_templates(id),
  seed VARCHAR(50) NOT NULL,

  -- Generated map (JSONB array of DungeonRoom objects)
  rooms JSONB NOT NULL,
  current_room_id UUID NOT NULL,

  -- State
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  floors_cleared INTEGER DEFAULT 0 CHECK (floors_cleared >= 0),

  -- Timestamps
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_dungeon_runs_player_id ON dungeon_runs(player_id);
CREATE INDEX idx_dungeon_runs_status ON dungeon_runs(status);

-- ============================================================================
-- Combat System
-- ============================================================================

-- Combat Instances (active combat encounters)
CREATE TABLE IF NOT EXISTS combat_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dungeon_run_id UUID NOT NULL REFERENCES dungeon_runs(id) ON DELETE CASCADE,
  room_id UUID NOT NULL,
  turn INTEGER DEFAULT 1 CHECK (turn >= 1),
  phase VARCHAR(20) DEFAULT 'player_turn' CHECK (phase IN ('player_turn', 'enemy_turn', 'victory', 'defeat')),

  -- Participants (JSONB array of CombatParticipant objects)
  participants JSONB NOT NULL,

  -- Action log (JSONB array of CombatAction objects)
  action_log JSONB DEFAULT '[]',

  -- Rewards (JSONB object, populated on victory)
  rewards JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_combat_instances_dungeon_run_id ON combat_instances(dungeon_run_id);
CREATE INDEX idx_combat_instances_phase ON combat_instances(phase);

-- ============================================================================
-- Game Configuration
-- ============================================================================

-- Game config table (singleton, key-value store)
CREATE TABLE IF NOT EXISTS game_config (
  key VARCHAR(50) PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default config
INSERT INTO game_config (key, value, description) VALUES
  ('action_gauge_max', '1000', 'Maximum action gauge value before character acts'),
  ('critical_hit_base_chance', '5', 'Base critical hit chance (%)'),
  ('critical_hit_damage_multiplier', '150', 'Critical hit damage multiplier (%)'),
  ('dodge_chance_base', '5', 'Base dodge chance (%)'),
  ('exp_curve_exponent', '2.5', 'Exponent for EXP curve calculation'),
  ('skill_points_per_level', '1', 'Skill points gained per level'),
  ('stat_points_per_level', '3', 'Stat points gained per level'),
  ('treasure_room_item_count', '3', 'Number of items in treasure rooms'),
  ('boss_guaranteed_rare_chance', '50', 'Chance of guaranteed rare item from boss (%)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Calculate EXP required for next level
CREATE OR REPLACE FUNCTION calculate_exp_for_level(level INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN FLOOR(100 * POWER(level, 2.5));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update character timestamp on modification
CREATE OR REPLACE FUNCTION update_character_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER player_characters_update_timestamp
  BEFORE UPDATE ON player_characters
  FOR EACH ROW
  EXECUTE FUNCTION update_character_timestamp();

-- Validate HP/MP bounds on update
CREATE OR REPLACE FUNCTION validate_character_vitals()
RETURNS TRIGGER AS $$
BEGIN
  -- HP cannot exceed base_hp
  IF NEW.current_hp > NEW.base_hp THEN
    NEW.current_hp = NEW.base_hp;
  END IF;

  -- MP cannot exceed base_mp
  IF NEW.current_mp > NEW.base_mp THEN
    NEW.current_mp = NEW.base_mp;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER player_characters_validate_vitals
  BEFORE INSERT OR UPDATE ON player_characters
  FOR EACH ROW
  EXECUTE FUNCTION validate_character_vitals();

-- Update combat timestamp on modification
CREATE OR REPLACE FUNCTION update_combat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER combat_instances_update_timestamp
  BEFORE UPDATE ON combat_instances
  FOR EACH ROW
  EXECUTE FUNCTION update_combat_timestamp();

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Combat queries
CREATE INDEX idx_combat_instances_updated_at ON combat_instances(updated_at DESC);

-- Inventory queries
CREATE INDEX idx_inventory_items_item_template ON inventory_items(item_template_id);

-- Active dungeon runs
CREATE INDEX idx_dungeon_runs_active ON dungeon_runs(player_id, status) WHERE status = 'in_progress';

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE player_characters IS 'Player character entities with stats and progression';
COMMENT ON TABLE item_templates IS 'Item definitions (game data)';
COMMENT ON TABLE inventory_items IS 'Player-owned item instances';
COMMENT ON TABLE skill_templates IS 'Skill definitions (game data)';
COMMENT ON TABLE player_skills IS 'Skills learned by players';
COMMENT ON TABLE enemy_templates IS 'Enemy definitions (game data)';
COMMENT ON TABLE loot_tables IS 'Loot drop definitions (game data)';
COMMENT ON TABLE dungeon_templates IS 'Dungeon definitions (game data)';
COMMENT ON TABLE dungeon_runs IS 'Active dungeon run instances';
COMMENT ON TABLE combat_instances IS 'Active combat encounter instances';
COMMENT ON TABLE game_config IS 'Global game configuration (singleton key-value store)';
