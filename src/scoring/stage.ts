import { notImplemented } from '../util/todo.js';
import type { RulesConfig, SportKey } from '../config/types.js';

export interface StageMatch {
  /** The stage key from rules.yaml that fired, e.g. "semi-final". */
  key: string;
  adjustment: number;
}

/**
 * Turns a source's free-text stage into one of the stage keys in rules.yaml.
 *
 * Sources are wildly inconsistent here. The same round arrives as "Semi-final",
 * "SF", "Semi Finals" and "Round 5", so this needs a synonym table rather than
 * a straight lookup.
 *
 * Returns null when the stage cannot be identified, which is the common case
 * for leagues and for single-day sports. The caller then applies no adjustment,
 * which is the correct neutral behaviour.
 *
 * To implement:
 *   - a synonym table mapping many spellings onto each rules.yaml stage key
 *   - prefer the sport's own `stages` block, falling back to `default_stages`
 *   - never invent a stage from the competition name alone
 */
export function matchStage(
  _sport: SportKey,
  _reportedStage: string | null,
  _rules: RulesConfig,
): StageMatch | null {
  return notImplemented('stage matching');
}
