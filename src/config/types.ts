/**
 * The shapes of the two YAML files in config/.
 *
 * These types are the contract between what you edit by hand and what the code
 * reads. If you add a key to either YAML file, add it here first.
 */

/** A sport key such as "football" or "alpine-skiing". Must match in both files. */
export type SportKey = string;

/**
 * Which side of a sport that runs parallel competitions an event belongs to.
 *
 * Null is a real and common third answer, not a gap. Plenty of competitions
 * carry no marker at all, and guessing which one they are would be worse than
 * admitting we do not know.
 */
export type Division = 'women' | 'men';

/** Every context flag the rules table knows how to apply. */
export type ContextFlag =
  | 'title-decider'
  | 'trophy-decider'
  | 'promotion-decider'
  | 'relegation-decider'
  | 'derby'
  | 'record-attempt'
  | 'dead-rubber'
  | 'exhibition'
  | 'youth-or-reserve';

// ---------------------------------------------------------------------------
// interests.yaml
// ---------------------------------------------------------------------------

export interface Settings {
  /** IANA zone name, e.g. "Europe/Istanbul". Decides which day an event is on. */
  timezone: string;
  /** How many days forward to report, starting with today. */
  days_ahead: number;
}

/**
 * What you want from one sport.
 *
 * In the YAML this is usually just a number. The long form exists for sports
 * where you follow only one half of the calendar.
 */
export interface SportInterest {
  /** How much you care, 1 to 10. */
  interest: number;
  /**
   * Keep only this side of the sport. Anything that carries no marker at all
   * is dropped too, unless it is named in `also`, because a competition that
   * does not say it is women's usually is not.
   */
  only?: Division;
  /**
   * Competitions to keep despite carrying no marker. The escape hatch for
   * leagues whose name gives nothing away, such as Sultanlar Ligi.
   */
  also?: string[];
}

/** interests.yaml exactly as written: a bare rating, or the long form. */
export interface RawInterestsConfig {
  sports: Record<SportKey, number | SportInterest>;
  settings: Settings;
}

/** interests.yaml after loading, with every entry in the long form. */
export interface InterestsConfig {
  /** Sports absent here are out of scope and never reach the report. */
  sports: Record<SportKey, SportInterest>;
  settings: Settings;
}

// ---------------------------------------------------------------------------
// rules.yaml
// ---------------------------------------------------------------------------

export interface RuleDefaults {
  /** Score given to a competition with no entry in the table. */
  unknown_competition: number;
  min_score: number;
  max_score: number;
}

export interface SportRules {
  /** Competition name to its base score. */
  competitions: Record<string, number>;
  /** Optional per-sport override of `default_stages`. */
  stages?: Record<string, number>;
}

export interface RulesConfig {
  defaults: RuleDefaults;
  /** Stage name to adjustment, used by any sport without its own `stages`. */
  default_stages: Record<string, number>;
  /** Context flag to adjustment. Applied across every sport. */
  context: Record<ContextFlag, number>;
  sports: Record<SportKey, SportRules>;
}

/** Both files, parsed. */
export interface LoadedConfig {
  interests: InterestsConfig;
  rules: RulesConfig;
}
