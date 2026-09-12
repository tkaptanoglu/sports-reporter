/**
 * The shapes of the two YAML files in config/.
 *
 * These types are the contract between what you edit by hand and what the code
 * reads. If you add a key to either YAML file, add it here first.
 */

/** A sport key such as "football" or "alpine-skiing". Must match in both files. */
export type SportKey = string;

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

export interface InterestsConfig {
  /** Sport key to your interest in it, 1 to 10. Sports absent here are out of scope. */
  sports: Record<SportKey, number>;
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
