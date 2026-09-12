import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { DEFAULT_SETTINGS, interestIn, loadConfig, unmatchedSportKeys, validateConfig } from '../src/config/load.js';

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

describe('report settings', () => {
  test('falls back to central European time when none is given', () => {
    // There was no default at all before: an omitted timezone reached the
    // window builder as undefined and failed with a message about an unknown
    // zone rather than a missing one.
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    writeFileSync(join(dir, 'interests.yaml'), 'sports:\n  football: 8\n');
    writeFileSync(join(dir, 'rules.yaml'), 'sports:\n  football:\n    competitions:\n      X: 1\n');

    const config = loadConfig(dir);
    assert.equal(config.interests.settings.timezone, DEFAULT_SETTINGS.timezone);
    assert.equal(config.interests.settings.days_ahead, 7);
  });

  test('the default is a zone the timezone database actually knows', () => {
    assert.ok(DateTime.now().setZone(DEFAULT_SETTINGS.timezone).isValid);
  });

  test('the default keeps summer time rather than being a fixed offset', () => {
    // CET the zone is not "UTC+1 always". An evening kickoff has to read
    // correctly in July as well as January.
    const summer = DateTime.fromISO('2026-07-15T18:30Z').setZone(DEFAULT_SETTINGS.timezone);
    const winter = DateTime.fromISO('2027-01-15T18:30Z').setZone(DEFAULT_SETTINGS.timezone);

    assert.equal(summer.toFormat('HH:mm'), '20:30');
    assert.equal(winter.toFormat('HH:mm'), '19:30');
  });

  test('anything you do set wins over the default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    writeFileSync(
      join(dir, 'interests.yaml'),
      'sports:\n  football: 8\nsettings:\n  timezone: America/New_York\n  days_ahead: 3\n',
    );
    writeFileSync(join(dir, 'rules.yaml'), 'sports:\n  football:\n    competitions:\n      X: 1\n');

    const config = loadConfig(dir);
    assert.equal(config.interests.settings.timezone, 'America/New_York');
    assert.equal(config.interests.settings.days_ahead, 3);
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
