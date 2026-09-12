import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStandings } from '../src/standings/espn.js';
import { detectStandingsFlags, findRow } from '../src/scoring/standings-flags.js';
import { makeEvent } from './helpers.js';
import type { EspnStandings } from '../src/standings/espn.js';
import type { LeagueTable } from '../src/standings/types.js';

/** A 20-team table, so a full season is 38 rounds. */
const table = (played: number): LeagueTable => ({
  competition: 'Premier League',
  progress: Math.min(1, played / 38),
  rows: Array.from({ length: 20 }, (_, i) => ({
    team: `Team ${i + 1}`,
    rank: i + 1,
    played,
    points: (20 - i) * 2,
  })),
});

const between = (a: number, b: number) =>
  makeEvent({ participants: [`Team ${a}`, `Team ${b}`], competition: 'Premier League' });

describe('parseStandings', () => {
  test('reads a table and works out how far through the season it is', () => {
    const body: EspnStandings = {
      standings: {
        entries: [
          { team: { displayName: 'Manchester City' }, stats: [{ name: 'rank', value: 1 }, { name: 'gamesPlayed', value: 19 }, { name: 'points', value: 45 }] },
          { team: { displayName: 'Arsenal' }, stats: [{ name: 'rank', value: 2 }, { name: 'gamesPlayed', value: 19 }, { name: 'points', value: 43 }] },
        ],
      },
    };

    const parsed = parseStandings(body, 'Premier League');
    assert.equal(parsed?.rows.length, 2);
    assert.equal(parsed?.rows[0]?.team, 'Manchester City');
    // Two teams is a two-round season, so 19 played reads as complete.
    assert.equal(parsed?.progress, 1);
  });

  test('sorts by rank however the feed ordered it', () => {
    const body: EspnStandings = {
      standings: {
        entries: [
          { team: { displayName: 'Second' }, stats: [{ name: 'rank', value: 2 }] },
          { team: { displayName: 'First' }, stats: [{ name: 'rank', value: 1 }] },
        ],
      },
    };

    assert.deepEqual(parseStandings(body, 'x')?.rows.map((r) => r.team), ['First', 'Second']);
  });

  test('returns null for a competition with no table, rather than an empty one', () => {
    // Every cup and every individual sport lands here.
    assert.equal(parseStandings({}, 'FA Cup'), null);
    assert.equal(parseStandings({ standings: { entries: [] } }, 'FA Cup'), null);
  });
});

describe('detectStandingsFlags', () => {
  test('flags a match between two sides near the top', () => {
    // The question that prompted this: two big clubs mid-season should beat
    // two mid-table ones.
    assert.deepEqual(detectStandingsFlags(between(2, 4), table(19)), ['top-of-table']);
  });

  test('leaves an ordinary mid-table fixture alone', () => {
    assert.deepEqual(detectStandingsFlags(between(11, 13), table(19)), []);
  });

  test('does not flag a big club playing a small one', () => {
    // Both sides have to qualify. One good team is just a fixture.
    assert.deepEqual(detectStandingsFlags(between(1, 15), table(19)), []);
  });

  test('calls first against second a title decider late on, not merely a big match', () => {
    assert.deepEqual(detectStandingsFlags(between(1, 2), table(30)), ['title-decider']);
  });

  test('treats first against second as an ordinary big match earlier in the season', () => {
    // In October the top two are the top two by accident as much as anything.
    assert.deepEqual(detectStandingsFlags(between(1, 2), table(12)), ['top-of-table']);
  });

  test('flags a fixture between two sides in the drop zone, but only after halfway', () => {
    assert.deepEqual(detectStandingsFlags(between(18, 19), table(25)), ['relegation-decider']);
    assert.deepEqual(detectStandingsFlags(between(18, 19), table(12)), []);
  });

  test('says nothing at all in the opening weeks', () => {
    // Three games in, the table is noise. Flagging it would be worse than
    // flagging nothing, because it would look authoritative.
    assert.deepEqual(detectStandingsFlags(between(1, 2), table(3)), []);
    assert.deepEqual(detectStandingsFlags(between(19, 20), table(3)), []);
  });

  test('says nothing when the competition has no table', () => {
    assert.deepEqual(detectStandingsFlags(between(1, 2), undefined), []);
  });

  test('says nothing when it cannot find both teams in the table', () => {
    const event = makeEvent({ participants: ['Team 1', 'Some Cup Minnows'] });
    assert.deepEqual(detectStandingsFlags(event, table(30)), []);
  });

  test('says nothing for an event with no named teams at all', () => {
    // Races, tournaments and anything a source gave only a title.
    assert.deepEqual(detectStandingsFlags(makeEvent({ participants: [] }), table(30)), []);
  });
});

describe('findRow', () => {
  test('finds a team spelled exactly as the table spells it', () => {
    assert.equal(findRow(table(19), 'Team 7')?.rank, 7);
  });

  test('finds a team when one side abbreviates the name', () => {
    const real: LeagueTable = {
      competition: 'Premier League',
      progress: 0.5,
      rows: [{ team: 'Brighton & Hove Albion', rank: 1, played: 19, points: 40 }],
    };

    assert.equal(findRow(real, 'Brighton')?.rank, 1);
    assert.equal(findRow(real, 'Brighton & Hove Albion')?.rank, 1);
  });

  test('returns null rather than a near miss', () => {
    assert.equal(findRow(table(19), 'Nottingham Forest'), null);
    assert.equal(findRow(table(19), ''), null);
  });
});
