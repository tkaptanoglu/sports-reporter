import { normalise } from './text.js';
import type { RulesConfig, SportKey } from '../config/types.js';

export interface StageMatch {
  /** The stage key from rules.yaml that fired, e.g. "semi-final". */
  key: string;
  adjustment: number;
}

/**
 * Every spelling a feed might use for a stage, mapped onto a rules.yaml key.
 *
 * ORDER IS THE WHOLE DESIGN. Patterns are tried in sequence and the first hit
 * wins, so the specific must come before the general. "Semifinals" contains
 * "final", and a tennis qualifier called "Qualifying 1st Round" is a qualifier
 * before it is an early round. Getting either the wrong way round would quietly
 * promote minor fixtures for a whole season.
 */
const PATTERNS: Array<{ key: string; test: RegExp }> = [
  { key: 'conference-final', test: /conference ?finals?/ },
  { key: 'quarter-final', test: /quarter ?finals?|\bqf\b/ },
  { key: 'semi-final', test: /semi ?finals?|\bsf\b/ },
  { key: 'third-place', test: /third place|3rd place|bronze/ },

  { key: 'round-of-16', test: /round of 16|last 16|\br16\b/ },
  { key: 'round-of-32', test: /round of 32|last 32|\br32\b/ },

  // Before any round pattern: a qualifier is a qualifier first.
  { key: 'qualifying', test: /qualif/ },
  { key: 'preseason', test: /pre ?season|friendly tournament/ },

  { key: 'round-robin', test: /round robin/ },
  // A UEFA league phase is the old group stage under a new name.
  { key: 'group', test: /\bgroup\b|league phase/ },
  { key: 'playoff', test: /play ?offs?|knockout play/ },
  { key: 'regular-season', test: /regular season|match ?day|\bmatchweek\b|\bweek \d+/ },
  { key: 'friendly', test: /friendly|exhibition/ },

  // Golf numbers its rounds; these keys exist only in that sport's table.
  { key: 'final-round', test: /final round|round 4|fourth round/ },
  { key: 'round-3', test: /round 3|third round|3rd round/ },
  { key: 'round-2', test: /round 2|second round|2nd round/ },
  { key: 'round-1', test: /round 1|first round|1st round/ },

  // Tennis lumps everything before the last 16 together.
  { key: 'early-round', test: /round [123]\b|[123](?:st|nd|rd) round|first round|second round|third round|round of (?:64|128)/ },

  // Last, because almost every compound above contains the word.
  { key: 'final', test: /\bfinals?\b/ },
];

/** Stage keys this matcher knows how to recognise. */
export const KNOWN_STAGE_KEYS: string[] = [...new Set(PATTERNS.map((p) => p.key))];

/**
 * Turns a source's free-text stage into one of the stage keys in rules.yaml.
 *
 * Only keys present in the applicable table are considered, which is what lets
 * "Round 1" mean the first round of a golf tournament in one sport and an early
 * round of a draw in another. The sport's own `stages` block wins over the
 * shared default curve.
 *
 * Returns null when the stage cannot be identified, which is the common case
 * for league fixtures and for single-day sports. The caller then applies no
 * adjustment, which is the correct neutral behaviour.
 */
export function matchStage(
  sport: SportKey,
  reportedStage: string | null,
  rules: RulesConfig,
): StageMatch | null {
  if (reportedStage === null) return null;

  const text = normalise(reportedStage);
  if (text.length === 0) return null;

  const table = rules.sports[sport]?.stages ?? rules.default_stages;

  for (const { key, test } of PATTERNS) {
    const adjustment = table[key];
    if (adjustment === undefined) continue;
    if (test.test(text)) return { key, adjustment };
  }

  return null;
}
