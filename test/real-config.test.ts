import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { parse } from 'yaml';
import { loadConfig } from '../src/config/load.js';
import { KNOWN_STAGE_KEYS } from '../src/scoring/stage.js';
import type { RawInterestsConfig, RulesConfig, SportInterest } from '../src/config/types.js';

/**
 * Guards the two YAML files that actually ship, rather than fixtures.
 *
 * These are hand-edited by a person, so a stray tab or a renamed sport should
 * fail here in a second rather than halfway through a run.
 *
 * Note the asymmetry: rules.yaml and interests.example.yaml are tracked in git
 * and always present, so they are asserted unconditionally. Your own
 * interests.yaml is deliberately untracked, so it is only checked when it
 * exists. That keeps the suite green on a fresh clone.
 */

const rules = parse(readFileSync('config/rules.yaml', 'utf8')) as RulesConfig;
const example = parse(readFileSync('config/interests.example.yaml', 'utf8')) as RawInterestsConfig;

const isInteger = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n);

/** interests.yaml allows a bare rating or the long form; both mean a rating. */
const ratingOf = (v: number | SportInterest): number => (typeof v === 'number' ? v : v.interest);

describe('config/rules.yaml', () => {
  test('every sport has at least one competition', () => {
    for (const [sport, block] of Object.entries(rules.sports)) {
      const count = Object.keys(block.competitions).length;
      assert.ok(count > 0, `${sport} has no competitions`);
    }
  });

  test('every base score is a whole number inside the allowed range', () => {
    const { min_score, max_score } = rules.defaults;

    for (const [sport, block] of Object.entries(rules.sports)) {
      for (const [name, score] of Object.entries(block.competitions)) {
        assert.ok(isInteger(score), `${sport} / ${name} is not a whole number: ${String(score)}`);
        assert.ok(
          score >= min_score && score <= max_score,
          `${sport} / ${name} scores ${score}, outside ${min_score}..${max_score}`,
        );
      }
    }
  });

  test('every stage and context adjustment is a whole number', () => {
    for (const [stage, adj] of Object.entries(rules.default_stages)) {
      assert.ok(isInteger(adj), `default stage "${stage}" is not a whole number`);
    }
    for (const [flag, adj] of Object.entries(rules.context)) {
      assert.ok(isInteger(adj), `context flag "${flag}" is not a whole number`);
    }
    for (const [sport, block] of Object.entries(rules.sports)) {
      for (const [stage, adj] of Object.entries(block.stages ?? {})) {
        assert.ok(isInteger(adj), `${sport} stage "${stage}" is not a whole number`);
      }
    }
  });

  test('every stage key in the table is one the matcher can recognise', () => {
    // A stage key with no pattern behind it can never fire, so its adjustment
    // would sit in the file looking effective while doing nothing.
    const tables = [rules.default_stages, ...Object.values(rules.sports).map((s) => s.stages ?? {})];

    for (const table of tables) {
      for (const key of Object.keys(table)) {
        assert.ok(KNOWN_STAGE_KEYS.includes(key), `no pattern recognises the stage "${key}"`);
      }
    }
  });

  test('the shared stage curve does not penalise qualifying', () => {
    // A qualifying penalty encodes "weaker field". That is true of a tennis or
    // snooker qualifying tournament and false of a Formula 1 qualifying session
    // or a World Cup qualifier. In the shared curve it reached every sport
    // without its own block, so it belongs only in the sports where it is true.
    assert.equal(
      rules.default_stages['qualifying'],
      undefined,
      'qualifying is back in default_stages, where it penalises sports whose qualifying is not a weaker field',
    );
  });

  test('the sports whose qualifying really is a weaker field still penalise it', () => {
    for (const sport of ['tennis', 'snooker']) {
      const penalty = rules.sports[sport]?.stages?.['qualifying'];
      if (rules.sports[sport] === undefined) continue; // you are free to drop a sport entirely
      assert.ok(penalty !== undefined && penalty < 0, `${sport} no longer penalises its qualifiers`);
    }
  });

  test('no competition is listed twice within one sport', () => {
    // YAML silently keeps the last of two identical keys, so a duplicate would
    // otherwise vanish without complaint.
    for (const [sport, block] of Object.entries(rules.sports)) {
      const lowered = Object.keys(block.competitions).map((n) => n.toLowerCase());
      assert.equal(new Set(lowered).size, lowered.length, `${sport} lists a competition twice`);
    }
  });

  test('the anchor cases still score the way they were specified', () => {
    // These two came straight from the brief and are the calibration points for
    // the whole table. If either moves, every other score is suspect.
    const football = rules.sports['football'];
    assert.ok(football);

    const worldCupFinal = (football.competitions['FIFA World Cup'] ?? 0) + rules.default_stages['final']!;
    assert.equal(worldCupFinal, 10, 'a World Cup final should top out at 10');

    assert.equal(football.competitions['TFF 3. Lig'], 1, 'a Turkish third division match should be a 1');
  });
});

describe('config/interests.example.yaml', () => {
  test('every sport it lists exists in the rules table', () => {
    for (const sport of Object.keys(example.sports)) {
      assert.ok(rules.sports[sport], `example lists "${sport}", which has no rules entry`);
    }
  });

  test('every interest rating is a whole number from 1 to 10', () => {
    for (const [sport, rating] of Object.entries(example.sports)) {
      const n = ratingOf(rating);
      assert.ok(isInteger(n) && n >= 1 && n <= 10, `${sport} is rated ${String(n)}`);
    }
  });

  test('it carries usable report settings', () => {
    assert.ok(example.settings.days_ahead >= 1);
    // Checked against the real timezone database rather than a shape regex. A
    // name-shaped string that no zone answers to would pass a regex and then
    // fail every run, and "CET" is a real zone with no slash in it.
    assert.ok(
      DateTime.now().setZone(example.settings.timezone).isValid,
      `${example.settings.timezone} is not a timezone`,
    );
  });
});

describe('config/interests.yaml', () => {
  const present = existsSync('config/interests.yaml');

  test('loads cleanly and every sport resolves', { skip: !present }, () => {
    const config = loadConfig();

    for (const [sport, rating] of Object.entries(config.interests.sports)) {
      assert.ok(rules.sports[sport], `you list "${sport}", which has no rules entry`);
      const n = ratingOf(rating);
      assert.ok(isInteger(n) && n >= 1 && n <= 10, `${sport} is rated ${String(n)}`);
    }
  });
});
