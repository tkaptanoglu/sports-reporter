import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';
import { scoreSignificance } from '../src/scoring/significance.js';
import { COVERAGE, parseDay, splitRace } from '../src/sources/thesportsdb.js';
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

  test('asks for MotoGP by league rather than sweeping all of motorsport', () => {
    // A day of "Motorsport" returns three events under the free key, and on a
    // normal weekend those three are DTM, NASCAR and a rally, with the MotoGP
    // race nowhere among them. Asking for the league by id cannot be crowded
    // out, and costs one request instead of seven.
    const motogp = COVERAGE.find((c) => c.sport === 'motogp');
    assert.ok(motogp);
    assert.deepEqual(motogp.leagues, ['4407']);
  });

  test('sweeps by day for the sports that genuinely span many leagues', () => {
    // Cycling and the rest have no single league worth naming, so the day
    // query is right for them however wasteful it looks next to MotoGP.
    for (const sport of ['cycling', 'athletics', 'volleyball', 'handball']) {
      const coverage = COVERAGE.find((c) => c.sport === sport);
      assert.ok(coverage);
      assert.equal(coverage.leagues, undefined, `${sport} should not name leagues`);
    }
  });

  test('leaves out the winter sports it has no data for', () => {
    const claimed = COVERAGE.map((c) => c.sport);
    for (const sport of ['alpine-skiing', 'curling']) {
      assert.ok(!claimed.includes(sport));
    }
  });
});

describe('splitRace', () => {
  test('separates a grand tour from its stage', () => {
    assert.deepEqual(splitRace('Vuelta a España Stage 21'), { race: 'Vuelta a España', stage: 'Stage 21' });
  });

  test('copes with the separators feeds put between race and stage', () => {
    assert.deepEqual(splitRace('Tour de France - Stage 5'), { race: 'Tour de France', stage: 'Stage 5' });
    assert.deepEqual(splitRace('Tour de Pologne, Stage 3'), { race: 'Tour de Pologne', stage: 'Stage 3' });
  });

  test('ignores what follows the stage number', () => {
    assert.deepEqual(splitRace("Giro d'Italia Stage 12 (ITT)"), { race: "Giro d'Italia", stage: 'Stage 12' });
  });

  test('reads a prologue as a stage', () => {
    assert.deepEqual(splitRace('Paris-Nice Prologue'), { race: 'Paris-Nice', stage: 'Prologue' });
  });

  test('never splits a hyphenated race name at its hyphen', () => {
    assert.deepEqual(splitRace('Liège-Bastogne-Liège'), { race: 'Liège-Bastogne-Liège', stage: null });
  });

  test('returns a one-day race whole', () => {
    assert.deepEqual(splitRace('Grand Prix Cycliste de Montréal'), {
      race: 'Grand Prix Cycliste de Montréal',
      stage: null,
    });
  });
});

describe('cycling races filed under their series', () => {
  // Captured shape: the feed files every race under "UCI World Tour" and names
  // the race only in the event title. Scoring the series put the last stage of
  // a grand tour at the level of an ordinary World Tour race.
  const cycling = COVERAGE.find((c) => c.sport === 'cycling');
  const fixture = loadConfig(join('test', 'fixtures', 'config'));

  const day = (league: string, event: string): SportsDbDay => ({
    events: [{ idEvent: '1', strLeague: league, strEvent: event, strTimestamp: '2026-09-13T16:23:00' }],
  });

  test('scores the race named in the title, not the series it is filed under', () => {
    assert.ok(cycling);
    const [stage] = parseDay(day('UCI World Tour', 'Vuelta a España Stage 21'), cycling);

    assert.equal(stage?.competition, 'Vuelta a España');
    assert.equal(stage?.competitionFallback, 'UCI World Tour');
    assert.equal(stage?.stage, 'Stage 21');
  });

  test('a grand tour stage now scores by the grand tour rule', () => {
    assert.ok(cycling);
    const [stage] = parseDay(day('UCI World Tour', 'Vuelta a España Stage 12'), cycling);
    assert.ok(stage);

    const result = scoreSignificance(stage, fixture);
    assert.equal(result.breakdown.matchedCompetition, 'Vuelta a España');
    assert.equal(result.breakdown.base, 6);
  });

  test('a race with no rule of its own still scores at its series level', () => {
    assert.ok(cycling);
    const [oneDay] = parseDay(day('UCI World Tour', 'Grand Prix Cycliste de Montréal'), cycling);
    assert.ok(oneDay);

    const result = scoreSignificance(oneDay, fixture);
    assert.equal(result.breakdown.matchedCompetition, 'UCI World Tour');
    assert.equal(result.breakdown.base, 3);
  });

  test('a race falls back to its own series, not always the World Tour', () => {
    // A ProSeries race with no rule of its own should score at ProSeries level.
    assert.ok(cycling);
    const [race] = parseDay(day('UCI ProSeries', 'Tour of Norway Stage 2'), cycling);
    assert.ok(race);

    const result = scoreSignificance(race, fixture);
    assert.equal(result.breakdown.matchedCompetition, 'UCI ProSeries');
    assert.equal(result.breakdown.base, 2);
  });

  test('keeps the title intact, so the stage 21 decider still finds its stage', () => {
    assert.ok(cycling);
    const [stage] = parseDay(day('UCI World Tour', 'Vuelta a España Stage 21'), cycling);
    assert.equal(stage?.title, 'Vuelta a España Stage 21');
  });

  test('leaves a single event such as the world championships under its own name', () => {
    // The worlds is one competition with several races in it, not a series of
    // separate races, so the discipline in the title is not the competition.
    assert.ok(cycling);
    const [worlds] = parseDay(day('UCI Road World Championships', 'Womens Elite Individual Time Trial'), cycling);

    assert.equal(worlds?.competition, 'UCI Road World Championships');
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
