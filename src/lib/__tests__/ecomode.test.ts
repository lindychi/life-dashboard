import { describe, it, expect } from "vitest";

// These imports will fail until ecomode.ts is created (TDD RED phase)
import {
  resolveModelForTier,
  estimateTaskCost,
  estimatePlanCost,
  suggestTierDowngrades,
  type ModelTier,
} from "../ecomode";

describe("Ecomode - ModelTier resolution", () => {
  it('resolveModelForTier("low") returns "haiku"', () => {
    expect(resolveModelForTier("low")).toBe("haiku");
  });

  it('resolveModelForTier("medium") returns "sonnet"', () => {
    expect(resolveModelForTier("medium")).toBe("sonnet");
  });

  it('resolveModelForTier("high") returns "opus"', () => {
    expect(resolveModelForTier("high")).toBe("opus");
  });

  it("resolveModelForTier(undefined) returns the agent default model when provided", () => {
    expect(resolveModelForTier(undefined, "claude-3-5-sonnet")).toBe(
      "claude-3-5-sonnet"
    );
  });

  it("resolveModelForTier(undefined) returns sonnet when no default model is provided", () => {
    expect(resolveModelForTier(undefined)).toBe("sonnet");
  });
});

describe("Ecomode - Task cost estimation", () => {
  it("estimateTaskCost returns a positive number for valid inputs", () => {
    const cost = estimateTaskCost("medium", 60);
    expect(cost).toBeGreaterThan(0);
  });

  it("low tier costs less than medium tier for same duration", () => {
    const lowCost = estimateTaskCost("low", 120);
    const mediumCost = estimateTaskCost("medium", 120);
    expect(lowCost).toBeLessThan(mediumCost);
  });

  it("medium tier costs less than high tier for same duration", () => {
    const mediumCost = estimateTaskCost("medium", 120);
    const highCost = estimateTaskCost("high", 120);
    expect(mediumCost).toBeLessThan(highCost);
  });

  it("low tier costs less than high tier for same duration", () => {
    const lowCost = estimateTaskCost("low", 120);
    const highCost = estimateTaskCost("high", 120);
    expect(lowCost).toBeLessThan(highCost);
  });

  it("haiku at 60 seconds costs approximately $0.001/min", () => {
    // haiku: $0.001/min → 60s = 1min → $0.001
    const cost = estimateTaskCost("low", 60);
    expect(cost).toBeCloseTo(0.001, 4);
  });

  it("sonnet at 60 seconds costs approximately $0.005/min", () => {
    // sonnet: $0.005/min → 60s = 1min → $0.005
    const cost = estimateTaskCost("medium", 60);
    expect(cost).toBeCloseTo(0.005, 4);
  });

  it("opus at 60 seconds costs approximately $0.025/min", () => {
    // opus: $0.025/min → 60s = 1min → $0.025
    const cost = estimateTaskCost("high", 60);
    expect(cost).toBeCloseTo(0.025, 4);
  });

  it("cost scales linearly with duration", () => {
    const cost60 = estimateTaskCost("medium", 60);
    const cost120 = estimateTaskCost("medium", 120);
    expect(cost120).toBeCloseTo(cost60 * 2, 6);
  });

  it("returns zero cost for zero duration", () => {
    expect(estimateTaskCost("high", 0)).toBe(0);
  });
});

describe("Ecomode - Plan cost estimation", () => {
  it("estimatePlanCost returns sum of individual task costs", () => {
    const tasks = [
      { modelTier: "low" as ModelTier, estimatedDurationSec: 60 },
      { modelTier: "medium" as ModelTier, estimatedDurationSec: 60 },
      { modelTier: "high" as ModelTier, estimatedDurationSec: 60 },
    ];

    const totalCost = estimatePlanCost(tasks);
    const expectedCost =
      estimateTaskCost("low", 60) +
      estimateTaskCost("medium", 60) +
      estimateTaskCost("high", 60);

    expect(totalCost).toBeCloseTo(expectedCost, 6);
  });

  it("estimatePlanCost returns 0 for empty task list", () => {
    expect(estimatePlanCost([])).toBe(0);
  });

  it("estimatePlanCost treats undefined modelTier as medium", () => {
    const tasksWithUndefinedTier = [
      { estimatedDurationSec: 60 }, // no modelTier
    ];
    const tasksWithMedium = [
      { modelTier: "medium" as ModelTier, estimatedDurationSec: 60 },
    ];

    expect(estimatePlanCost(tasksWithUndefinedTier)).toBeCloseTo(
      estimatePlanCost(tasksWithMedium),
      6
    );
  });

  it("estimatePlanCost treats undefined estimatedDurationSec as 0", () => {
    const tasks = [{ modelTier: "high" as ModelTier }]; // no duration
    expect(estimatePlanCost(tasks)).toBe(0);
  });
});

describe("Ecomode - Tier downgrade suggestions", () => {
  it("returns empty suggestions when plan is within budget", () => {
    const tasks = [
      { modelTier: "low" as ModelTier, estimatedDurationSec: 60 },
    ];
    const budget = 10; // very large budget
    const suggestions = suggestTierDowngrades(tasks, budget);
    expect(suggestions).toHaveLength(0);
  });

  it("suggests downgrading high-tier tasks first when plan exceeds budget", () => {
    const tasks = [
      { modelTier: "high" as ModelTier, estimatedDurationSec: 600 },
      { modelTier: "medium" as ModelTier, estimatedDurationSec: 60 },
    ];
    const budget = 0.001; // very small budget
    const suggestions = suggestTierDowngrades(tasks, budget);

    // Should suggest downgrading at least the high-tier task
    expect(suggestions.length).toBeGreaterThan(0);
    const highTierSuggestion = suggestions.find((s) => s.currentTier === "high");
    expect(highTierSuggestion).toBeDefined();
    expect(highTierSuggestion?.suggestedTier).toBe("medium");
  });

  it("suggests downgrading medium to low when budget is extremely tight", () => {
    const tasks = [
      { modelTier: "medium" as ModelTier, estimatedDurationSec: 600 },
    ];
    const budget = 0.0001; // extremely tight budget
    const suggestions = suggestTierDowngrades(tasks, budget);

    expect(suggestions.length).toBeGreaterThan(0);
    const suggestion = suggestions[0];
    expect(suggestion.currentTier).toBe("medium");
    expect(suggestion.suggestedTier).toBe("low");
  });

  it("does not suggest downgrading tasks already at low tier", () => {
    const tasks = [
      { modelTier: "low" as ModelTier, estimatedDurationSec: 600 },
    ];
    const budget = 0.0001; // extremely tight budget
    const suggestions = suggestTierDowngrades(tasks, budget);

    // Low is already the cheapest - no downgrade possible
    expect(suggestions).toHaveLength(0);
  });

  it("returns correct index for each suggested downgrade", () => {
    const tasks = [
      { modelTier: "low" as ModelTier, estimatedDurationSec: 60 },
      { modelTier: "high" as ModelTier, estimatedDurationSec: 600 },
      { modelTier: "medium" as ModelTier, estimatedDurationSec: 60 },
    ];
    const budget = 0.0001;
    const suggestions = suggestTierDowngrades(tasks, budget);

    // All returned suggestions must have a valid index
    for (const s of suggestions) {
      expect(s.index).toBeGreaterThanOrEqual(0);
      expect(s.index).toBeLessThan(tasks.length);
      expect(tasks[s.index].modelTier).toBe(s.currentTier);
    }
  });

  it("suggestions are advisory only — original task list is not mutated", () => {
    const tasks = [
      { modelTier: "high" as ModelTier, estimatedDurationSec: 600 },
    ];
    const budget = 0.0001;
    suggestTierDowngrades(tasks, budget);

    // Original task should remain unchanged
    expect(tasks[0].modelTier).toBe("high");
  });
});
