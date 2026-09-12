import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { notImplemented } from '../util/todo.js';
import type {
  InterestsConfig,
  LoadedConfig,
  RawInterestsConfig,
  RulesConfig,
  SportInterest,
  SportKey,
} from './types.js';

const INTERESTS_FILE = 'interests.yaml';
const RULES_FILE = 'rules.yaml';

/**
 * Reads both YAML files from disk.
 *
 * The read and parse are real. Deep validation is not written yet, so a
 * malformed file will currently fail somewhere downstream with a worse message
 * than it deserves. See `validateConfig` below.
 */
export function loadConfig(dir = 'config'): LoadedConfig {
  const base = resolve(dir);
  const interestsPath = join(base, INTERESTS_FILE);
  const rulesPath = join(base, RULES_FILE);

  if (!existsSync(interestsPath)) {
    throw new Error(
      `No ${INTERESTS_FILE} found at ${interestsPath}.\n` +
        `Copy config/interests.example.yaml to config/${INTERESTS_FILE} and edit it. ` +
        `Your own copy is deliberately not tracked in git.`,
    );
  }
  if (!existsSync(rulesPath)) {
    throw new Error(`No ${RULES_FILE} found at ${rulesPath}.`);
  }

  const raw = parse(readFileSync(interestsPath, 'utf8')) as RawInterestsConfig;
  const rules = parse(readFileSync(rulesPath, 'utf8')) as RulesConfig;

  return { interests: normaliseInterests(raw), rules };
}

/**
 * Expands the short form of an interest entry into the long one.
 *
 * `football: 8` and `football: { interest: 8 }` mean the same thing, and doing
 * this once here is what stops every consumer downstream having to ask which
 * shape it received.
 */
function normaliseInterests(raw: RawInterestsConfig): InterestsConfig {
  const sports: Record<SportKey, SportInterest> = {};

  for (const [sport, value] of Object.entries(raw.sports ?? {})) {
    sports[sport] = typeof value === 'number' ? { interest: value } : value;
  }

  return { sports, settings: raw.settings };
}

/**
 * Sport keys listed in interests.yaml that have no entry in rules.yaml.
 *
 * These cannot be scored, so the caller warns about them and drops them. This
 * is the check that stops a typo from quietly shortening your report.
 */
export function unmatchedSportKeys(config: LoadedConfig): SportKey[] {
  const known = new Set(Object.keys(config.rules.sports));
  return Object.keys(config.interests.sports).filter((key) => !known.has(key));
}

/** Interest rating for a sport, or null when it is out of scope. */
export function interestIn(config: LoadedConfig, sport: SportKey): number | null {
  return config.interests.sports[sport]?.interest ?? null;
}

/**
 * Checks both files properly: types, ranges, required keys, and interest values
 * inside 1..10. Should throw one error listing every problem at once rather than
 * stopping at the first, because fixing config one error per run is miserable.
 */
export function validateConfig(_config: LoadedConfig): void {
  return notImplemented('full config validation');
}
