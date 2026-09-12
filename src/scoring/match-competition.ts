import { containsWords, normalise } from './text.js';

export interface CompetitionMatch {
  /** The competition line from rules.yaml that won. */
  name: string;
  /** Its base score. */
  base: number;
}

interface Candidate {
  name: string;
  base: number;
  normalised: string;
}

/**
 * Preparing a sport's competition list costs a normalise call per line, and the
 * list is the same object for every event in a run, so do it once.
 */
const prepared = new WeakMap<Record<string, number>, Candidate[]>();

/**
 * Resolves whatever a source called a competition against the rules table.
 *
 * Matching is on whole words, accent-insensitive, longest match first. Longest
 * first is what lets a specific line beat a general one sitting beside it:
 * "FIS Alpine Ski World Cup Downhill" wins over "FIS Alpine Ski World Cup", and
 * a rule for "Monaco Grand Prix" is found inside "Tag Heuer Monaco Grand Prix".
 *
 * Returns null when nothing matches, and the caller decides what that means.
 */
export function matchCompetition(
  reported: string,
  competitions: Record<string, number>,
): CompetitionMatch | null {
  const haystack = normalise(reported);
  if (haystack.length === 0) return null;

  for (const candidate of prepare(competitions)) {
    if (containsWords(haystack, candidate.normalised)) {
      return { name: candidate.name, base: candidate.base };
    }
  }

  return null;
}

function prepare(competitions: Record<string, number>): Candidate[] {
  const cached = prepared.get(competitions);
  if (cached !== undefined) return cached;

  const candidates = Object.entries(competitions)
    .map(([name, base]) => ({ name, base, normalised: normalise(name) }))
    .filter((candidate) => candidate.normalised.length > 0)
    // Longest first. Ties broken alphabetically so a run is reproducible.
    .sort((a, b) => b.normalised.length - a.normalised.length || a.name.localeCompare(b.name));

  prepared.set(competitions, candidates);
  return candidates;
}
