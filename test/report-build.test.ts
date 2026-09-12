import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { buildReport } from '../src/report/build.js';
import { buildWindow } from '../src/util/days.js';
import { makeScored } from './helpers.js';
import type { ReportWindow } from '../src/util/days.js';

const window = (days = 3): ReportWindow =>
  buildWindow(
    { timezone: 'Europe/Istanbul', days_ahead: days },
    DateTime.fromISO('2026-09-12T09:00', { zone: 'Europe/Istanbul' }),
  );

describe('buildReport', () => {
  test('keeps a day with nothing on it rather than hiding it', () => {
    const report = buildReport([], window(), ['football']);

    assert.equal(report.days.length, 3);
    assert.deepEqual(
      report.days.map((d) => d.events.length),
      [0, 0, 0],
    );
  });

  test('files each event under the day the reader would call it', () => {
    const report = buildReport(
      [
        makeScored({ id: 'late', startsAt: new Date('2026-09-12T21:45:00Z') }),
        makeScored({ id: 'early', startsAt: new Date('2026-09-12T09:00:00Z') }),
      ],
      window(),
      ['football'],
    );

    // 21:45 UTC is 00:45 the next morning in Istanbul, so it belongs to day two.
    assert.deepEqual(report.days[0]?.events.map((e) => e.id), ['early']);
    assert.deepEqual(report.days[1]?.events.map((e) => e.id), ['late']);
  });

  test('sorts each day by importance, highest first', () => {
    const report = buildReport(
      [
        makeScored({ id: 'small', importance: 12 }),
        makeScored({ id: 'huge', importance: 90 }),
        makeScored({ id: 'middling', importance: 48 }),
      ],
      window(),
      ['football'],
    );

    assert.deepEqual(report.days[0]?.events.map((e) => e.id), ['huge', 'middling', 'small']);
  });

  test('a big event in a sport you barely follow loses to a small one you love', () => {
    // The multiplication rule, stated as a test so it cannot drift.
    const perfectEventYouIgnore = makeScored({
      id: 'darts-final',
      sport: 'darts',
      interest: 1,
      significance: 10,
      importance: 10,
    });
    const ordinaryEventYouLove = makeScored({
      id: 'league-match',
      sport: 'football',
      interest: 8,
      significance: 6,
      importance: 48,
    });

    const report = buildReport([perfectEventYouIgnore, ordinaryEventYouLove], window(), [
      'football',
      'darts',
    ]);

    assert.deepEqual(report.days[0]?.events.map((e) => e.id), ['league-match', 'darts-final']);
  });

  test('breaks a tie on the earlier start, then alphabetically', () => {
    const report = buildReport(
      [
        makeScored({ id: 'c', importance: 40, startsAt: new Date('2026-09-12T18:00:00Z'), title: 'Zulu' }),
        makeScored({ id: 'a', importance: 40, startsAt: new Date('2026-09-12T12:00:00Z'), title: 'Bravo' }),
        makeScored({ id: 'b', importance: 40, startsAt: new Date('2026-09-12T18:00:00Z'), title: 'Alpha' }),
      ],
      window(),
      ['football'],
    );

    assert.deepEqual(report.days[0]?.events.map((e) => e.id), ['a', 'b', 'c']);
  });

  test('names the sports that produced nothing', () => {
    const report = buildReport([makeScored({ sport: 'football' })], window(), [
      'football',
      'curling',
      'ski-jumping',
    ]);

    assert.deepEqual(report.emptySports, ['curling', 'ski-jumping']);
  });

  test('collects competitions with no rule, counted and commonest first', () => {
    const unrated = { matchedCompetition: null, base: 2, stageKey: null, stageAdjustment: 0, flags: [], clamped: false };

    const report = buildReport(
      [
        makeScored({ id: '1', competition: 'Kit Kat Cup', breakdown: { ...unrated } }),
        makeScored({ id: '2', competition: 'Kit Kat Cup', breakdown: { ...unrated } }),
        makeScored({ id: '3', competition: 'Regional Shield', breakdown: { ...unrated } }),
        makeScored({ id: '4', competition: 'Premier League' }),
      ],
      window(),
      ['football'],
    );

    assert.deepEqual(report.unrated, [
      { sport: 'football', competition: 'Kit Kat Cup', count: 2 },
      { sport: 'football', competition: 'Regional Shield', count: 1 },
    ]);
  });

  test('the same competition name in two sports is counted separately', () => {
    const unrated = { matchedCompetition: null, base: 2, stageKey: null, stageAdjustment: 0, flags: [], clamped: false };

    const report = buildReport(
      [
        makeScored({ id: '1', sport: 'snooker', competition: 'World Grand Prix', breakdown: { ...unrated } }),
        makeScored({ id: '2', sport: 'darts', competition: 'World Grand Prix', breakdown: { ...unrated } }),
      ],
      window(),
      ['snooker', 'darts'],
    );

    assert.equal(report.unrated.length, 2);
  });

  test('carries the timezone through so renderers do not have to guess', () => {
    const report = buildReport([], window(), []);
    assert.equal(report.timezone, 'Europe/Istanbul');
  });
});
