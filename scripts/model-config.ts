/**
 * Model Routing Configuration Management
 *
 * Manages model routing policies via:
 * 1. agents.json — per-agent default model & max model
 * 2. Environment variables — global overrides
 * 3. .omc-config.json — user preferences (ecomode default, etc.)
 *
 * Priority chain:
 *   Command payload (explicit) > Ecomode cap > Agent config > Auto-analysis
 */

import * as fs from "fs";
import * as path from "path";
import type { ModelTier } from "./model-router";
import type { DelegationCategory } from "./delegation-category";

// --- Agent Config Extension ---

export interface AgentModelConfig {
  id: string;
  defaultModel?: ModelTier;
  maxModel?: ModelTier;
  delegationCategory?: DelegationCategory;
  slimPrompt?: string;
}

/**
 * Load agent model configs from agents.json
 * Reads the extended fields: defaultModel, maxModel, delegationCategory, slimPrompt
 */
export function loadAgentModelConfigs(projectRoot: string): Map<string, AgentModelConfig> {
  const agentsJsonPath = path.join(projectRoot, "agents.json");
  const configs = new Map<string, AgentModelConfig>();

  try {
    const raw = fs.readFileSync(agentsJsonPath, "utf-8");
    const agents = JSON.parse(raw) as Array<{
      id: string;
      defaultModel?: ModelTier;
      maxModel?: ModelTier;
      delegationCategory?: DelegationCategory;
      slimPrompt?: string;
      enabled?: boolean;
    }>;

    for (const agent of agents) {
      if (agent.enabled === false) continue;
      configs.set(agent.id, {
        id: agent.id,
        defaultModel: agent.defaultModel,
        maxModel: agent.maxModel,
        delegationCategory: agent.delegationCategory,
        slimPrompt: agent.slimPrompt,
      });
    }
  } catch {
    console.warn("[model-config] Failed to load agents.json, using defaults");
  }

  return configs;
}

// --- Global Config ---

export interface GlobalModelRoutingConfig {
  /** Default ecomode state (can be overridden per command) */
  defaultEcomode: boolean;
  /** Global model cap (prevents any agent from using higher tier) */
  globalModelCap?: ModelTier;
  /** Disable model routing entirely (all agents use default CLI model) */
  disableModelRouting: boolean;
  /** Enable token usage tracking */
  enableTokenTracking: boolean;
  /** Base stale timeout in ms (default: 300000 = 5 min) */
  baseStaleTimeout: number;
}

const DEFAULT_GLOBAL_CONFIG: GlobalModelRoutingConfig = {
  defaultEcomode: false,
  disableModelRouting: false,
  enableTokenTracking: true,
  baseStaleTimeout: 300000,
};

/**
 * Load global model routing config from environment + .omc-config.json
 */
export function loadGlobalConfig(): GlobalModelRoutingConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG };

  // Environment variable overrides
  if (process.env.DEFAULT_ECOMODE === "true") {
    config.defaultEcomode = true;
  }
  if (process.env.GLOBAL_MODEL_CAP) {
    const cap = process.env.GLOBAL_MODEL_CAP.toLowerCase();
    if (cap === "haiku" || cap === "sonnet" || cap === "opus") {
      config.globalModelCap = cap;
    }
  }
  if (process.env.DISABLE_MODEL_ROUTING === "true") {
    config.disableModelRouting = true;
  }
  if (process.env.ENABLE_TOKEN_TRACKING === "false") {
    config.enableTokenTracking = false;
  }
  if (process.env.BASE_STALE_TIMEOUT) {
    const timeout = parseInt(process.env.BASE_STALE_TIMEOUT, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.baseStaleTimeout = timeout;
    }
  }

  // .omc-config.json overrides (user preferences from OMC setup)
  try {
    const omcConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      ".omc-config.json"
    );
    if (fs.existsSync(omcConfigPath)) {
      const omcConfig = JSON.parse(fs.readFileSync(omcConfigPath, "utf-8")) as {
        defaultExecutionMode?: string;
        defaultEcomode?: boolean;
        enableTokenTracking?: boolean;
      };
      if (omcConfig.defaultEcomode !== undefined) {
        config.defaultEcomode = omcConfig.defaultEcomode;
      }
      if (omcConfig.enableTokenTracking !== undefined) {
        config.enableTokenTracking = omcConfig.enableTokenTracking;
      }
    }
  } catch {
    // .omc-config.json is optional
  }

  return config;
}

// --- Model Cap Enforcement ---

const TIER_ORDER: Record<ModelTier, number> = { haiku: 0, sonnet: 1, opus: 2 };

/**
 * Enforce model caps: global cap + agent max model
 */
export function enforceModelCap(
  selectedModel: ModelTier,
  agentConfig?: AgentModelConfig,
  globalConfig?: GlobalModelRoutingConfig,
): ModelTier {
  let model = selectedModel;

  // Agent max model cap
  if (agentConfig?.maxModel) {
    const maxOrder = TIER_ORDER[agentConfig.maxModel];
    if (TIER_ORDER[model] > maxOrder) {
      model = agentConfig.maxModel;
    }
  }

  // Global model cap
  if (globalConfig?.globalModelCap) {
    const capOrder = TIER_ORDER[globalConfig.globalModelCap];
    if (TIER_ORDER[model] > capOrder) {
      model = globalConfig.globalModelCap;
    }
  }

  return model;
}

/**
 * Resolve effective ecomode status from command + global config
 */
export function resolveEcomode(
  explicitEcomode?: boolean,
  globalConfig?: GlobalModelRoutingConfig,
): boolean {
  // Explicit override from command payload
  if (explicitEcomode !== undefined) return explicitEcomode;
  // Global default
  return globalConfig?.defaultEcomode ?? false;
}
