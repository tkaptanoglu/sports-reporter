import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE, parseDay } from '../src/sources/thesportsdb.js';
import type { Coverage, SportsDbDay } from '../src/sources/thesportsdb.js';

const fixture = JSON.parse(
  readFileSync(join('test', 'fixtures', 'thesportsdb', 'motorsport-day.json'), 'utf8'),
) as SportsDbDay;

const motogp = COVERAGE.find((c) => c.sport === 'motogp');
const snooker: Coverage = { sport: 'snooker', theirSport: 'Snooker', fallback: 'Ranking Event' };

describe('the coverage table', () => {
  test('claims no sport that ESPN already covers', () => {
    const espnSports = ['football', 'tennis', 'basketball', 'formula1'];
    for (const coverage of COVERAGE) {
      assert.ok(!espnSports.includes(coverage.sport), `${coverage.sport} is covered twice`);
    }
  });

  test('leaves out the winter sports it has no data for', () => {
    const claimed = COVERAGE.map((c) => c.sport);
    for (const sport of ['alpine-skiing', 'curling']) {
      assert.ok(!claimed.includes(sport));
    }
  });
});

describe('parseDay', () => {
  test('filters a lumped-together sport down to the series asked for', () => {
    assert.ok(motogp);
    const events = parseDay(fixture, motogp);

    // The day also holds DTM and a rally. Neither is MotoGP.
    assert.deepEqual(
      events.map((e) => e.title),
      ['MotoGP San Marino Grand Prix', 'Moto2 San Marino Grand Prix'],
    );
  });

  test('reads their zoneless timestamp as UTC, not as local time', () => {
    assert.ok(motogp);
    const first = parseDay(fixture, motogp)[0];

    // "2026-09-13T12:00:00" with no marker. Reading it as local time would move
    // a lunchtime race by hours and could land it on the wrong day entirely.
    assert.equal(first?.startsAt.toISOString(), '2026-09-13T12:00:00.000Z');
  });

  test('drops a record with no date at all rather than inventing one', () => {
    assert.ok(motogp);
    const ids = parseDay(fixture, motogp).map((e) => e.id);
    assert.ok(!ids.includes('thesportsdb:2401005'));
  });

  test('falls back on a date-only record instead of discarding it', () => {
    const noFilter: Coverage = { sport: 'motogp', theirSport: 'Motorsport' };
    const rally = parseDay(fixture, noFilter).find((e) => e.title === 'Rally Chile');

    assert.ok(rally, 'a date-only stage event was dropped');
    assert.equal(rally.startsAt.toISOString(), '2026-09-13T12:00:00.000Z');
  });

  test('keeps their league name unmapped, because we asked for a whole sport', () => {
    assert.ok(motogp);
    assert.deepEqual(
      parseDay(fixture, motogp).map((e) => e.competition),
      ['MotoGP', 'Moto2'],
    );
  });

  test('carries a fallback so a bare series name is not scored as an unknown', () => {
    assert.ok(motogp);
    // "MotoGP" is not a substring match for "MotoGP Grand Prix" in the rules
    // table, so without this every race would score the unknown default.
    for (const event of parseDay(fixture, motogp)) {
      assert.equal(event.competitionFallback, 'MotoGP Grand Prix');
    }
  });

  test('treats their empty-string stage as no stage', () => {
    assert.ok(motogp);
    for (const event of parseDay(fixture, motogp)) assert.equal(event.stage, null);
  });

  test('prefixes ids with the source so two feeds cannot collide', () => {
    assert.ok(motogp);
    for (const event of parseDay(fixture, motogp)) {
      assert.match(event.id, /^thesportsdb:\d+$/);
      assert.equal(event.source, 'thesportsdb');
    }
  });

  test('survives a response with no events, which is what an off day returns', () => {
    assert.deepEqual(parseDay({ events: null }, snooker), []);
    assert.deepEqual(parseDay({}, snooker), []);
  });
});
