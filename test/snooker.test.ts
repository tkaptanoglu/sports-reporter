import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDates, parseDraw, parseIndex } from '../src/sources/snooker.js';

const fixture = (name: string): string =>
  readFileSync(join('test', 'fixtures', 'snooker', `${name}.html`), 'utf8');

const tournaments = parseIndex(fixture('index'), 2026);
const draw = parseDraw(fixture('draw'));

describe('parseIndex', () => {
  test('reads the season calendar off the index page', () => {
    assert.ok(tournaments.length > 0);
    const english = tournaments.find((t) => t.name === 'English Open');
    assert.ok(english, 'expected the English Open in the captured calendar');
    assert.equal(english.from.toISODate(), '2026-09-07');
    assert.equal(english.to.toISODate(), '2026-09-13');
  });

  test('separates the name from the dates that follow it', () => {
    for (const t of tournaments) {
      assert.ok(!t.name.includes('('), `dates left in the name: ${t.name}`);
      assert.ok(t.name.trim().length > 0);
    }
  });

  test('lists each tournament once, however many times it is linked', () => {
    const ids = tournaments.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('parseDates', () => {
  test('fills in a missing year from the season', () => {
    // Early-season entries print no year at all.
    const r = parseDates('7-13 Sep', 2026);
    assert.equal(r?.from.toISODate(), '2026-09-07');
    assert.equal(r?.to.toISODate(), '2026-09-13');
  });

  test('reads a range that crosses a month', () => {
    const r = parseDates('31 Oct - 7 Nov 2026', 2026);
    assert.equal(r?.from.toISODate(), '2026-10-31');
    assert.equal(r?.to.toISODate(), '2026-11-07');
  });

  test('reads a range that crosses new year', () => {
    const r = parseDates('28 Dec - 6 Jan 2027', 2027);
    assert.equal(r?.from.toISODate(), '2026-12-28');
    assert.equal(r?.to.toISODate(), '2027-01-06');
  });

  test('returns null for anything unreadable', () => {
    assert.equal(parseDates('to be confirmed', 2026), null);
  });
});

describe('parseDraw', () => {
  test('finds the matches still to be played, with both players named', () => {
    // The whole point of this source. The aggregators give you the tournament
    // and the round; only this gives you who is at the table.
    assert.ok(draw.length > 0, 'no scheduled matches parsed');

    const semi = draw.find((m) => m.round === 'Semifinals');
    assert.ok(semi, 'expected a semi-final in the captured draw');
    assert.deepEqual(semi.players, ['Shaun Murphy', 'Mark J Williams']);
  });

  test('keeps the round each match sits under', () => {
    for (const match of draw) {
      assert.ok(match.round !== null && match.round.length > 0);
      assert.ok(!match.round.includes('('), 'prize money left in the round name');
    }
  });

  test('strips the seeding, which is noise in a fixture list', () => {
    // The page writes "Ali Carter [21]".
    for (const match of draw) {
      for (const player of match.players) assert.ok(!player.includes('['), player);
    }
  });

  test('reads the first session time of a match', () => {
    const semi = draw.find((m) => m.round === 'Semifinals');
    assert.equal(semi?.startsAt.toISOString(), '2026-09-12T18:00:00.000Z');
  });

  test('takes the earlier of two sessions when a match is split over a day', () => {
    // The final carries both a noon and an evening session.
    const final = draw.find((m) => m.round === 'Final');
    assert.equal(final?.startsAt.toISOString(), '2026-09-13T12:00:00.000Z');
  });

  test('keeps a match whose opponent is not decided yet', () => {
    // A final against "S Murphy / M J Williams" is still worth listing, and
    // inventing a name for the winner would be worse than showing both.
    const final = draw.find((m) => m.round === 'Final');
    assert.ok(final);
    assert.equal(final.players[0], 'Ali Carter');
    assert.match(final.players[1], /Murphy|Williams/);
  });

  test('leaves out matches that have already been played', () => {
    // Those rows carry a score rather than a "v", and no time.
    assert.ok(draw.every((m) => !Number.isNaN(m.startsAt.getTime())));
    assert.ok(draw.length < 10, 'finished matches appear to be leaking in');
  });

  test('returns nothing rather than guessing when the page changes shape', () => {
    assert.deepEqual(parseDraw('<html><body>redesigned</body></html>'), []);
  });
});
