import { detectContextFlags } from './context-flags.js';
import { matchCompetition } from './match-competition.js';
import { matchStage } from './stage.js';
import type { LoadedConfig } from '../config/types.js';
import type { ScoreBreakdown, SportEvent } from '../model/event.js';
import type { Tables } from '../standings/types.js';

export interface SignificanceResult {
  /** Clamped to defaults.min_score..defaults.max_score. */
  significance: number;
  /** Kept so the report can show why, which is what makes the table tunable. */
  breakdown: ScoreBreakdown;
}

/**
 * Scores how significant an event is within its own sport.
 *
 *     significance = base + stage adjustment + sum of context adjustments
 *
 * then clamped. This is the heart of the program and the one function whose
 * output you will argue with, so it returns a full breakdown rather than a bare
 * number. Without the breakdown, tuning rules.yaml is guesswork.
 */
export function scoreSignificance(
  event: SportEvent,
  config: LoadedConfig,
  tables: Tables = new Map(),
): SignificanceResult {
  const { rules } = config;
  const sportRules = rules.sports[event.sport];
  if (sportRules === undefined) {
    throw new Error(
      `No rules for sport "${event.sport}". Out-of-scope sports should have been ` +
        `filtered out before scoring.`,
    );
  }

  // The competition as reported, then the broader name the source offered as a
  // fallback. "Tag Heuer Spanish Grand Prix" has no rule of its own, but it is
  // still a grand prix and should score like one rather than like an unknown.
  const matched =
    matchCompetition(event.competition, sportRules.competitions) ??
    (event.competitionFallback === null
      ? null
      : matchCompetition(event.competitionFallback, sportRules.competitions));

  const base = matched?.base ?? rules.defaults.unknown_competition;

  const stage = matchStage(event.sport, event.stage, rules);
  const stageAdjustment = stage?.adjustment ?? 0;

  const flags = detectContextFlags(event, config, tables).map((flag) => ({
    flag,
    adjustment: rules.context[flag] ?? 0,
  }));
  const contextAdjustment = flags.reduce((total, f) => total + f.adjustment, 0);

  const raw = base + stageAdjustment + contextAdjustment;
  const significance = clamp(raw, rules.defaults.min_score, rules.defaults.max_score);

  return {
    significance,
    breakdown: {
      matchedCompetition: matched?.name ?? null,
      base,
      stageKey: stage?.key ?? null,
      stageAdjustment,
      flags,
      clamped: raw !== significance,
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
