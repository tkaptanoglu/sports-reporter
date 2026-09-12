import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEAGUES,
  parseRacingScoreboard,
  parseTeamScoreboard,
  parseTennisScoreboard,
} from '../src/sources/espn.js';
import type { EspnScoreboard, League } from '../src/sources/espn.js';
import type { FetchRequest } from '../src/sources/types.js';

/**
 * Parsed against responses captured from the live API, so these break when
 * ESPN changes shape rather than when someone guesses the shape wrong.
 */
const fixture = (name: string): EspnScoreboard =>
  JSON.parse(readFileSync(join('test', 'fixtures', 'espn', `${name}.json`), 'utf8')) as EspnScoreboard;

const premierLeague: League = {
  sport: 'football',
  path: 'soccer/eng.1',
  competition: 'Premier League',
  layout: 'team',
};

const f1: League = {
  sport: 'formula1',
  path: 'racing/f1',
  competition: 'Formula 1 Grand Prix',
  layout: 'racing',
};

const atp: League = {
  sport: 'tennis',
  path: 'tennis/atp',
  competition: 'ATP',
  layout: 'tennis',
  fallback: 'ATP 250',
};

// Wide enough to cover the captured tournament from its first day, which is
// where the fixture's matches and therefore its round labels live.
const request = (over: Partial<FetchRequest> = {}): FetchRequest => ({
  sports: ['tennis'],
  from: new Date('2026-08-24T00:00:00Z'),
  to: new Date('2026-09-15T00:00:00Z'),
  timezone: 'Europe/Istanbul',
  ...over,
});

describe('the league table', () => {
  test('no league is listed twice', () => {
    const paths = LEAGUES.map((l) => l.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  test('tennis entries carry a fallback tier, so an unlisted tournament is not an unknown', () => {
    for (const league of LEAGUES.filter((l) => l.layout === 'tennis')) {
      assert.ok(league.fallback, `${league.path} has no fallback`);
    }
  });
});

describe('parseTeamScoreboard', () => {
  const events = parseTeamScoreboard(fixture('soccer-eng1'), premierLeague);

  test('finds the fixtures', () => {
    assert.ok(events.length > 0, 'no events parsed from a live capture');
  });

  test('uses the rules.yaml spelling, not ESPN’s own league name', () => {
    // ESPN calls it "English Premier League". Matching on that would need a
    // feed-specific alias in the user's table, which is exactly what we avoid.
    for (const event of events) assert.equal(event.competition, 'Premier League');
  });

  test('names the fixture home team first, the way a fixture list reads', () => {
    const first = events[0];
    assert.ok(first);
    assert.match(first.title, / vs /);
    assert.equal(first.participants.length, 2);
    assert.ok(first.title.startsWith(first.participants[0] ?? ''));
  });

  test('gives every event a source-prefixed id and a real start time', () => {
    for (const event of events) {
      assert.match(event.id, /^espn:\d+$/);
      assert.ok(!Number.isNaN(event.startsAt.getTime()));
      assert.equal(event.sport, 'football');
      assert.equal(event.source, 'espn');
    }
  });

  test('skips a fixture that has already been played', () => {
    const body: EspnScoreboard = {
      events: [
        { id: '1', date: '2026-09-13T13:00Z', status: { type: { state: 'pre' } }, competitions: [{}] },
        { id: '2', date: '2026-09-13T13:00Z', status: { type: { state: 'post' } }, competitions: [{}] },
      ],
    };

    assert.deepEqual(
      parseTeamScoreboard(body, premierLeague).map((e) => e.id),
      ['espn:1'],
    );
  });

  test('reads the knockout round out of the notes', () => {
    const body: EspnScoreboard = {
      events: [
        {
          id: '9',
          date: '2026-09-13T19:00Z',
          status: { type: { state: 'pre' } },
          competitions: [{ notes: [{ headline: 'UEFA Champions League - Quarterfinals' }] }],
        },
      ],
    };

    assert.equal(parseTeamScoreboard(body, premierLeague)[0]?.stage, 'UEFA Champions League - Quarterfinals');
  });
});

describe('parseRacingScoreboard', () => {
  test('offers only the sessions still to come', () => {
    // In the captured weekend all three practices are final and qualifying is
    // over, though ESPN still reports qualifying as in progress because the
    // weekend has not ended. Only the race is actually left to watch.
    assert.deepEqual(
      parseRacingScoreboard(fixture('racing-f1'), f1).map((e) => e.competition),
      ['Tag Heuer Spanish Grand Prix'],
    );
  });

  const body: EspnScoreboard = {
    events: [
      {
        id: '600057443',
        name: 'Tag Heuer Monaco Grand Prix',
        competitions: [
          { id: '1', date: '2026-05-22T11:30Z', type: { abbreviation: 'FP1' }, status: { type: { state: 'pre' } } },
          { id: '2', date: '2026-05-23T14:00Z', type: { abbreviation: 'Qual' }, status: { type: { state: 'pre' } } },
          { id: '3', date: '2026-05-24T13:00Z', type: { abbreviation: 'Race' }, status: { type: { state: 'pre' } } },
        ],
      },
    ],
  };

  const sessions = parseRacingScoreboard(body, f1);

  test('splits a race weekend into its separate sessions', () => {
    assert.equal(sessions.length, 3);
    assert.deepEqual(
      sessions.map((s) => s.competition),
      ['Formula 1 Practice', 'Formula 1 Qualifying', 'Tag Heuer Monaco Grand Prix'],
    );
  });

  test('the race keeps the weekend name, so a rule for Monaco can match inside it', () => {
    const race = sessions[2];
    assert.ok(race);
    assert.match(race.competition, /Monaco Grand Prix/);
    assert.equal(race.competitionFallback, 'Formula 1 Grand Prix');
  });

  test('practice and qualifying need no fallback, being named exactly', () => {
    assert.equal(sessions[0]?.competitionFallback, null);
    assert.equal(sessions[1]?.competitionFallback, null);
  });

  test('each session keeps its own start time', () => {
    assert.equal(sessions[0]?.startsAt.toISOString(), '2026-05-22T11:30:00.000Z');
    assert.equal(sessions[2]?.startsAt.toISOString(), '2026-05-24T13:00:00.000Z');
  });
});

describe('parseTennisScoreboard', () => {
  const events = parseTennisScoreboard(fixture('tennis-atp'), atp, request());

  test('emits one event per tournament day, not one per match', () => {
    // The captured draw holds dozens of matches. Listing each would bury a
    // week of every other sport under one tournament.
    assert.ok(events.length > 0);
    assert.ok(events.length < 30, `got ${events.length} events, which looks like per-match output`);

    const days = events.map((e) => e.id);
    assert.equal(new Set(days).size, days.length, 'a day appeared twice');
  });

  test('labels the day with the furthest round being played', () => {
    const labelled = events.filter((e) => e.stage !== null);
    assert.ok(labelled.length > 0, 'no round labels derived from the draw');
    for (const event of labelled) assert.match(event.title, /, /);
  });

  test('a major needs no fallback tier, being in the rules table by name', () => {
    for (const event of events) {
      assert.equal(event.competition, 'US Open');
      assert.equal(event.competitionFallback, null);
    }
  });

  test('a lesser tournament falls back to the bottom tour tier', () => {
    const body: EspnScoreboard = {
      events: [
        {
          id: '500-2026',
          name: 'Winston-Salem Open',
          date: '2026-09-13T00:00Z',
          endDate: '2026-09-14T00:00Z',
          major: false,
          groupings: [],
        },
      ],
    };

    const parsed = parseTennisScoreboard(body, atp, request());
    assert.equal(parsed[0]?.competition, 'Winston-Salem Open');
    assert.equal(parsed[0]?.competitionFallback, 'ATP 250');
  });

  test('never reaches outside the requested window', () => {
    const narrow = request({
      from: new Date('2026-09-10T00:00:00Z'),
      to: new Date('2026-09-12T00:00:00Z'),
    });

    for (const event of parseTennisScoreboard(fixture('tennis-atp'), atp, narrow)) {
      assert.ok(event.startsAt >= new Date('2026-09-09T00:00:00Z'));
      assert.ok(event.startsAt < narrow.to);
    }
  });
});
