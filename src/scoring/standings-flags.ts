import { containsWords, normalise } from './text.js';
import type { ContextFlag } from '../config/types.js';
import type { SportEvent } from '../model/event.js';
import type { LeagueTable, TeamRow } from '../standings/types.js';

/**
 * The flags that need a league table.
 *
 * Everything here is gated on how far through the season the league is. A table
 * after three matches says nothing, and a "top of the table clash" flagged in
 * August because both sides won their opener would be worse than no flag at
 * all. The thresholds below are deliberately late rather than eager.
 */

/**
 * Both ends of the table get the same two-tier treatment.
 *
 * A six-pointer is a meeting of two sides in the same predicament, and it
 * starts to mean something around the middle of the season. A decider is the
 * narrower, later thing: the two sides who will actually settle it between
 * them. The bottom of a table is every bit as watchable as the top, so the
 * shape mirrors, with the thresholds at the bottom a little later because a
 * relegation fight takes longer to become real than a title race.
 */
const TIERS = {
  /** Both sides high up, a quarter of the season in. */
  topOfTable: { earliest: 0.25, share: 0.3 },
  /** Both sides in the drop zone or just above it, from halfway. */
  relegationBattle: { earliest: 0.5, share: 0.25 },
  /** First against second, three-quarters in. */
  title: { earliest: 0.7, places: 2 },
  /** Two sides in the relegation places themselves, three-quarters in. */
  relegation: { earliest: 0.75, share: 0.15 },
};

export function detectStandingsFlags(event: SportEvent, table: LeagueTable | undefined): ContextFlag[] {
  if (table === undefined) return [];

  const rows = event.participants
    .map((name) => findRow(table, name))
    .filter((row): row is TeamRow => row !== null);

  // Both sides have to be found. Matching one and guessing the other would be
  // worse than leaving the fixture alone.
  if (rows.length < 2) return [];

  const size = table.rows.length;
  const flags: ContextFlag[] = [];
  const everyone = (test: (row: TeamRow) => boolean): boolean => rows.every(test);

  const topCut = Math.max(2, Math.ceil(size * TIERS.topOfTable.share));
  const battleCut = size - Math.max(3, Math.ceil(size * TIERS.relegationBattle.share));
  const dropCut = size - Math.max(2, Math.ceil(size * TIERS.relegation.share));

  // Each end resolves to one flag, the stronger where both would fit. A
  // fixture cannot be a title decider and merely a big match at the same time.
  if (table.progress >= TIERS.title.earliest && everyone((r) => r.rank <= TIERS.title.places)) {
    flags.push('title-decider');
  } else if (table.progress >= TIERS.topOfTable.earliest && everyone((r) => r.rank <= topCut)) {
    flags.push('top-of-table');
  }

  if (table.progress >= TIERS.relegation.earliest && everyone((r) => r.rank > dropCut)) {
    flags.push('relegation-decider');
  } else if (
    table.progress >= TIERS.relegationBattle.earliest &&
    everyone((r) => r.rank > battleCut)
  ) {
    flags.push('relegation-battle');
  }

  return flags;
}

/**
 * Finds a team in the table by name.
 *
 * Both sides come from the same source here, so the spellings normally match
 * exactly. The whole-word fallback covers the case where a source abbreviates
 * one of them, and returns nothing rather than a near miss.
 */
export function findRow(table: LeagueTable, name: string): TeamRow | null {
  const wanted = normalise(name);
  if (wanted.length === 0) return null;

  const exact = table.rows.find((row) => normalise(row.team) === wanted);
  if (exact !== undefined) return exact;

  return (
    table.rows.find(
      (row) => containsWords(normalise(row.team), wanted) || containsWords(wanted, normalise(row.team)),
    ) ?? null
  );
}
