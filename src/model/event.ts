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
  /**
   * What competition this belongs to.
   *
   * Where a source knows exactly which competition it asked for, this is
   * normalised to the spelling used in rules.yaml, because a deliberate
   * mapping in one adapter beats hoping two spellings collide. Where a source
   * returns whatever it likes, such as a whole-day feed across every league,
   * this is the raw name and the unrated list at the foot of the report is what
   * catches it.
   */
  competition: string;
  /**
   * A broader competition name to fall back on when the specific one has no
   * rule. "Spanish Grand Prix" falls back to "Formula 1 Grand Prix", so an
   * unlisted race still scores like a race instead of like an unknown.
   */
  competitionFallback: string | null;
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
