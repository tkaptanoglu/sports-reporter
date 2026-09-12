import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interestIn, loadConfig, unmatchedSportKeys, validateConfig } from '../src/config/load.js';

const FIXTURES = join('test', 'fixtures', 'config');

describe('loadConfig', () => {
  test('reads both files and returns them parsed', () => {
    const config = loadConfig(FIXTURES);

    assert.equal(config.interests.sports['football']?.interest, 8);
    assert.equal(config.interests.settings.timezone, 'Europe/Istanbul');
    assert.equal(config.rules.defaults.unknown_competition, 2);
    assert.equal(config.rules.sports['football']?.competitions['Premier League'], 6);
  });

  test('keeps a per-sport stage override separate from the default curve', () => {
    const config = loadConfig(FIXTURES);

    assert.equal(config.rules.default_stages['final'], 2);
    assert.equal(config.rules.sports['tennis']?.stages?.['final'], 1);
    assert.equal(config.rules.sports['football']?.stages, undefined);
  });

  test('points at the example file when your own interests file is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sports-reporter-'));

    assert.throws(() => loadConfig(empty), /interests\.example\.yaml/);
  });

  test('says which file is missing when the rules table is absent', () => {
    const partial = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    writeFileSync(join(partial, 'interests.yaml'), 'sports: {}\n');

    assert.throws(() => loadConfig(partial), /No rules\.yaml/);
  });
});

describe('unmatchedSportKeys', () => {
  test('finds a sport that has no entry in the rules table', () => {
    const config = loadConfig(FIXTURES);

    assert.deepEqual(unmatchedSportKeys(config), ['quidditch']);
  });

  test('returns nothing when every sport is known', () => {
    const config = loadConfig(FIXTURES);
    delete config.interests.sports['quidditch'];

    assert.deepEqual(unmatchedSportKeys(config), []);
  });
});

describe('interestIn', () => {
  test('returns your rating for a sport in scope', () => {
    assert.equal(interestIn(loadConfig(FIXTURES), 'tennis'), 4);
  });

  test('returns null rather than zero for a sport out of scope', () => {
    // Zero would silently rank every event in that sport at the very bottom.
    // Null forces the caller to decide, which is what we want.
    assert.equal(interestIn(loadConfig(FIXTURES), 'curling'), null);
  });
});

describe('validateConfig', () => {
  test('is still a stub, and says so plainly', () => {
    assert.throws(() => validateConfig(loadConfig(FIXTURES)), /Not implemented yet/);
  });
});
