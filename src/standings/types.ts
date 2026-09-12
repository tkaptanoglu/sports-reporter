/**
 * League tables, the one thing a fixture list never contains.
 *
 * A schedule says Manchester United play Chelsea. Only the table says whether
 * that is first against second or fourteenth against fifteenth, and that is the
 * difference between a match worth staying in for and one worth ignoring.
 */

export interface TeamRow {
  /** As the source spells it, e.g. "Manchester United". */
  team: string;
  /** 1 is top of the table. */
  rank: number;
  played: number;
  points: number;
}

export interface LeagueTable {
  /** The rules.yaml competition name this table belongs to. */
  competition: string;
  rows: TeamRow[];
  /**
   * How far through the season the league is, 0 to 1.
   *
   * Everything here is gated on this. A table after three matches is noise, and
   * flagging a "top of the table clash" in August because both sides won their
   * opener would be worse than flagging nothing.
   */
  progress: number;
}

/** Tables for a run, keyed by competition name. */
export type Tables = Map<string, LeagueTable>;
