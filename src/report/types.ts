import type { SportKey } from '../config/types.js';
import type { ScoredEvent } from '../model/event.js';

/** One day of the report. */
export interface DayReport {
  /** yyyy-MM-dd in the reader's zone. */
  key: string;
  /** "Saturday 13 September". */
  label: string;
  /** Sorted by importance, highest first. */
  events: ScoredEvent[];
}

/** A competition that scored the unknown default, so you can add a rule for it. */
export interface UnratedCompetition {
  sport: SportKey;
  /** The name exactly as the source reported it, ready to paste into rules.yaml. */
  competition: string;
  /** How many events in this window used it. */
  count: number;
}

export interface Report {
  generatedAt: Date;
  timezone: string;
  days: DayReport[];
  /** Listed at the foot of the report so the rules table grows through use. */
  unrated: UnratedCompetition[];
  /**
   * Sports in scope that produced nothing. Usually out of season rather than
   * broken, and worth saying so, because silence looks like a bug.
   */
  emptySports: SportKey[];
}
