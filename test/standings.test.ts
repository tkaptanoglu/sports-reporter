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

  test('flags a six-pointer near the bottom from halfway, but not before', () => {
    // The mirror of top-of-table: two sides in the same predicament, at the
    // point in the season where the predicament is real.
    assert.deepEqual(detectStandingsFlags(between(18, 19), table(25), true), ['relegation-battle']);
    assert.deepEqual(detectStandingsFlags(between(18, 19), table(12), true), []);
  });

  test('catches a six-pointer just above the drop zone', () => {
    // 16th against 17th is exactly the fixture this is for, and a band drawn
    // only around the relegation places themselves would miss it.
    assert.deepEqual(detectStandingsFlags(between(16, 17), table(25), true), ['relegation-battle']);
  });

  test('escalates to a decider when both sides are in the drop zone late on', () => {
    // The bottom gets the same two tiers as the top: a six-pointer that
    // becomes a decider, rather than one flag that never escalates.
    assert.deepEqual(detectStandingsFlags(between(19, 20), table(31), true), ['relegation-decider']);
  });

  test('stays a six-pointer late on when only one side is actually in the drop', () => {
    // 16th is fighting, but it is not yet down there with them.
    assert.deepEqual(detectStandingsFlags(between(16, 19), table(31), true), ['relegation-battle']);
  });

  test('never raises both bottom flags at once', () => {
    for (const progress of [12, 25, 31, 38]) {
      const flags = detectStandingsFlags(between(19, 20), table(progress), true);
      assert.ok(
        !(flags.includes('relegation-battle') && flags.includes('relegation-decider')),
        `both bottom flags at ${progress} played`,
      );
    }
  });

  test('mirrors the top, which also never raises both of its flags at once', () => {
    for (const progress of [12, 25, 31, 38]) {
      const flags = detectStandingsFlags(between(1, 2), table(progress));
      assert.ok(!(flags.includes('top-of-table') && flags.includes('title-decider')));
    }
  });

  test('says nothing at all in the opening weeks', () => {
    // Three games in, the table is noise. Flagging it would be worse than
    // flagging nothing, because it would look authoritative.
    assert.deepEqual(detectStandingsFlags(between(1, 2), table(3)), []);
    assert.deepEqual(detectStandingsFlags(between(19, 20), table(3), true), []);
  });

  test('raises no relegation flag in a league nobody is relegated from', () => {
    // Nobody goes down from MLS or the NBA. Calling a bottom-of-the-table
    // fixture there a relegation decider is not a tuning question, it is
    // false, so the flags are off unless a competition is listed as having
    // relegation at all.
    assert.deepEqual(detectStandingsFlags(between(19, 20), table(31)), []);
    assert.deepEqual(detectStandingsFlags(between(16, 17), table(25)), []);
  });

  test('still reads the top of a closed league, which is a real thing there', () => {
    // A conference leader against the side behind it is a genuine fixture even
    // where the bottom of the table means nothing.
    assert.deepEqual(detectStandingsFlags(between(1, 2), table(30)), ['title-decider']);
    assert.deepEqual(detectStandingsFlags(between(2, 4), table(19)), ['top-of-table']);
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

describe('a league split into conferences', () => {
  // MLS and the NBA arrive as two conference groups, each ranked from 1.
  // Reading only the first left half the league invisible and made a season
  // five games old look complete, which fired late-season flags in October.
  const split: EspnStandings = {
    children: [
      { standings: { entries: [
        { team: { displayName: 'East Top' }, stats: [{ name: 'rank', value: 1 }, { name: 'points', value: 60 }, { name: 'gamesPlayed', value: 30 }] },
        { team: { displayName: 'East Bottom' }, stats: [{ name: 'rank', value: 2 }, { name: 'points', value: 10 }, { name: 'gamesPlayed', value: 30 }] },
      ] } },
      { standings: { entries: [
        { team: { displayName: 'West Top' }, stats: [{ name: 'rank', value: 1 }, { name: 'points', value: 70 }, { name: 'gamesPlayed', value: 30 }] },
        { team: { displayName: 'West Bottom' }, stats: [{ name: 'rank', value: 2 }, { name: 'points', value: 20 }, { name: 'gamesPlayed', value: 30 }] },
      ] } },
    ],
  };

  test('reads every conference, not just the first', () => {
    assert.equal(parseStandings(split, 'Major League Soccer')?.rows.length, 4);
  });

  test('ranks across the whole league, since conference ranks restart at 1', () => {
    // Two teams both ranked 1 in their own conference cannot both be first.
    const parsed = parseStandings(split, 'Major League Soccer');
    assert.deepEqual(parsed?.rows.map((r) => r.team), ['West Top', 'East Top', 'West Bottom', 'East Bottom']);
    assert.deepEqual(parsed?.rows.map((r) => r.rank), [1, 2, 3, 4]);
  });

  test('leaves a single-group league ranked the way the feed ranked it', () => {
    // The Premier League arrives as one group, already ordered on the
    // tiebreaks the competition actually uses.
    const single: EspnStandings = {
      children: [{ standings: { entries: [
        { team: { displayName: 'Second On Goal Difference' }, stats: [{ name: 'rank', value: 2 }, { name: 'points', value: 40 }] },
        { team: { displayName: 'First On Goal Difference' }, stats: [{ name: 'rank', value: 1 }, { name: 'points', value: 40 }] },
      ] } }],
    };

    assert.deepEqual(
      parseStandings(single, 'Premier League')?.rows.map((r) => r.team),
      ['First On Goal Difference', 'Second On Goal Difference'],
    );
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
