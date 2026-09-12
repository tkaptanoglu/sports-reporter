import { notImplemented } from '../util/todo.js';

export interface CompetitionMatch {
  /** The competition line from rules.yaml that won. */
  name: string;
  /** Its base score. */
  base: number;
}

/**
 * Resolves whatever a source called a competition against the rules table.
 *
 * Matching is case-insensitive and longest match wins, which is what lets
 * "FIS Alpine Ski World Cup Downhill" beat the generic "FIS Alpine Ski World
 * Cup" sitting beside it in the same block.
 *
 * Returns null when nothing matches. The caller then falls back to
 * defaults.unknown_competition and records the name so the report can list it.
 *
 * To implement:
 *   - normalise both sides: lowercase, collapse whitespace, strip punctuation
 *   - keep diacritics, since Süper Lig and Super Lig should both resolve
 *   - sort candidate keys by length descending and take the first substring hit
 *   - consider a length floor so a two-letter key cannot match half the calendar
 */
export function matchCompetition(
  _reported: string,
  _competitions: Record<string, number>,
): CompetitionMatch | null {
  return notImplemented('competition name matching');
}
