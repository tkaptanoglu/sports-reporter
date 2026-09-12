import { notImplemented } from '../util/todo.js';
import type { RulesConfig } from '../config/types.js';
import type { ScoreBreakdown, SportEvent } from '../model/event.js';

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
 *
 * To implement:
 *   - look up the sport's rules block; throw if it is missing, since the caller
 *     is supposed to have dropped out-of-scope sports already
 *   - matchCompetition for the base, falling back to unknown_competition and
 *     recording matchedCompetition as null so the report can list it
 *   - matchStage for the adjustment, contributing zero when it returns null
 *   - detectContextFlags, summing each flag's adjustment from rules.context
 *   - clamp, and set breakdown.clamped when the raw total was outside the range
 */
export function scoreSignificance(_event: SportEvent, _rules: RulesConfig): SignificanceResult {
  return notImplemented('significance scoring');
}
