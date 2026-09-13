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
  | 'relegation-battle'
  | 'derby'
  | 'favourite'
  | 'top-of-table'
  | 'preferred-division'
  | 'decisive-qualifying'
  | 'record-attempt'
  | 'dead-rubber'
  | 'exhibition'
  | 'youth-or-reserve';

/**
 * A team or athlete you care about more than the fixture alone would suggest.
 *
 * Lives in interests.yaml rather than context.yaml, because who you support is
 * the most personal thing in this whole program and that file never leaves
 * your machine.
 */
export interface Favourite {
  /** Matched on whole words against the participants and the title. */
  name: string;
  /** Confines it to one sport. Absent means every sport you follow. */
  sport?: SportKey;
  /**
   * Confines it to one side of a sport that runs parallel calendars, so the
   * women's national team can be a favourite while the men's is not.
   */
  division?: Division;
}

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
  /**
   * Lean towards this side without excluding the other.
   *
   * Where `only` throws half a sport away, this keeps everything and gives the
   * side you prefer a bonus. An Olympic men's final still reaches you; it just
   * sits below the women's one.
   */
  prefer?: Division;
  /**
   * A different interest for one side of the sport, replacing `interest` for
   * events known to belong to it.
   *
   * Only an event positively identified as that division is affected. A
   * competition whose name gives no clue keeps the ordinary `interest`, because
   * lowering a game for being possibly men's would quietly demote women's
   * fixtures whose feed simply forgot to say so.
   */
  interest_by_division?: Partial<Record<Division, number>>;
}

/** interests.yaml exactly as written: bare forms allowed throughout. */
export interface RawInterestsConfig {
  sports: Record<SportKey, number | SportInterest>;
  favourites?: Array<string | Favourite>;
  settings: Settings;
}

/** interests.yaml after loading, with every entry in its long form. */
export interface InterestsConfig {
  /** Sports absent here are out of scope and never reach the report. */
  sports: Record<SportKey, SportInterest>;
  /** Teams and athletes worth a bonus wherever they turn up. */
  favourites: Favourite[];
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

// ---------------------------------------------------------------------------
// context.yaml
// ---------------------------------------------------------------------------

/**
 * The knowledge no sports feed carries: which fixtures are grudge matches, and
 * which event a competition is settled on.
 *
 * Both are lists a person maintains, because both are matters of history and
 * judgement rather than data.
 */
export interface ContextConfig {
  /** Sport key to pairs of names. A fixture with both names is a derby. */
  rivalries?: Record<SportKey, string[][]>;
  /** Sport key to rules. Every phrase in a rule must appear in the event. */
  deciders?: Record<SportKey, string[][]>;
  /**
   * Qualifying sessions that largely settle the race that follows, at venues
   * where passing is so hard that grid position is most of the result. Same
   * shape as `deciders`: every phrase in a rule must appear in the event.
   */
  decisive_qualifying?: Record<SportKey, string[][]>;
}

/** Every config file, parsed. */
export interface LoadedConfig {
  interests: InterestsConfig;
  rules: RulesConfig;
  context: ContextConfig;
}
