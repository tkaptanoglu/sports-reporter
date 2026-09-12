import type { ContextFlag, SportKey } from '../config/types.js';

/**
 * One sporting event, normalised into a single shape regardless of which source
 * it came from. Everything downstream works on this and nothing else, so adding
 * a new source never means touching the scorer or the report.
 */
export interface SportEvent {
  /** Stable and unique, prefixed by source, e.g. "thesportsdb:1234567". */
  id: string;
  /** Which sport this belongs to. Must be a key in rules.yaml. */
  sport: SportKey;
  /** Competition name exactly as the source reported it, not cleaned up. */
  competition: string;
  /** What to show the reader, e.g. "Liverpool vs Arsenal" or "Qualifying". */
  title: string;
  /** Absolute start time. Converting to a local day happens in the report. */
  startsAt: Date;
  /** Raw stage text from the source, e.g. "Semi-final". Null when it says nothing. */
  stage: string | null;
  /** Two names for a match, many for a race, empty when not applicable. */
  participants: string[];
  /** Which source produced this record. */
  source: string;
  /** Link back to the source page, when there is one. */
  url: string | null;
}

/** How a significance score was arrived at, kept so the report can explain itself. */
export interface ScoreBreakdown {
  /** The competition line that matched, or null if it fell through to the default. */
  matchedCompetition: string | null;
  base: number;
  /** Which stage key was applied, or null if the stage layer did not fire. */
  stageKey: string | null;
  stageAdjustment: number;
  flags: Array<{ flag: ContextFlag; adjustment: number }>;
  /** True when the raw total fell outside min_score..max_score and was pulled back. */
  clamped: boolean;
}

/** A SportEvent with its ratings attached. */
export interface ScoredEvent extends SportEvent {
  /** 0 to 10, judged within the sport. */
  significance: number;
  /** 1 to 10, straight from interests.yaml. */
  interest: number;
  /** interest * significance. This is what the report sorts on. */
  importance: number;
  breakdown: ScoreBreakdown;
}
