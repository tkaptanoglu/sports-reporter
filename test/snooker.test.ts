import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { isQualifying, parseDates, parseDraw, parseIndex, stageOf } from '../src/sources/snooker.js';
import type { Tournament } from '../src/sources/snooker.js';

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

describe('qualifying tournaments', () => {
  // The tour runs qualifying as separate tournaments, named "Northern Ireland
  // Open Qual". Nothing inside the draw says so: its rounds read "Round 1" and
  // "Final" exactly like the main event's. Without marking it, a qualifying
  // final scored the same as a ranking final.
  test('recognises the naming the tour actually uses', () => {
    assert.equal(isQualifying('Northern Ireland Open Qual'), true);
    assert.equal(isQualifying('International Championship Qual'), true);
    assert.equal(isQualifying('World Championship Qualifying'), true);
    assert.equal(isQualifying('German Masters Quals'), true);
  });

  test('recognises the shorthand the site uses once a qualifier is under way', () => {
    // A running qualifier is labelled "Northern Ireland Open (q)". Missing this
    // put a whole qualifying tournament in the report at main-draw strength.
    assert.equal(isQualifying('Northern Ireland Open (q)'), true);
    assert.equal(isQualifying('Scottish Open (Q)'), true);
  });

  test('does not mistake a main-draw tournament for a qualifier', () => {
    for (const name of ['Northern Ireland Open', 'UK Championship', 'The Masters', 'Shoot Out']) {
      assert.equal(isQualifying(name), false, name);
    }
  });

  const qualifier = (name: string): Tournament => ({
    id: '1',
    name,
    qualifying: isQualifying(name),
    from: DateTime.fromISO('2026-09-13', { zone: 'UTC' }),
    to: DateTime.fromISO('2026-09-16', { zone: 'UTC' }),
  });

  test('marks every round of a qualifier as qualifying', () => {
    const qual = qualifier('Northern Ireland Open Qual');

    assert.equal(stageOf(qual, 'Round 1'), 'Qualifying Round 1');
    assert.equal(stageOf(qual, 'Final'), 'Qualifying Final');
    assert.equal(stageOf(qual, null), 'Qualifying');
  });

  test('keeps the round after the word rather than replacing it', () => {
    // The breakdown should still say which round it was. The stage matcher
    // tries qualifying before any round pattern, so the prefix is what wins.
    assert.match(stageOf(qualifier('X Qual'), 'Semifinals') ?? '', /Semifinals$/);
  });

  test('leaves a main-draw tournament alone', () => {
    const main = qualifier('Northern Ireland Open');

    assert.equal(stageOf(main, 'Final'), 'Final');
    assert.equal(stageOf(main, null), null);
  });
});

describe('a tournament linked under two labels', () => {
  // Captured from the live index on the day the qualifiers started. The same
  // event id is linked twice: as "Northern Ireland Open (q)" in the section for
  // events under way, and as "Northern Ireland Open Qual" in the season
  // calendar. Keeping only the first label let page order decide whether a
  // qualifier was scored as one, and it flipped the day the event began.
  const running = parseIndex(fixture('index-running-qualifier'), 2026);
  // Selected by event id, not name: the main Northern Ireland Open in October
  // shares the name and is a different tournament that must stay one.
  const ni = running.filter((t) => t.id === '2770');
  const mainEvent = running.find((t) => t.id === '2548');

  test('the captured page really does contain both labels', () => {
    // Guards the fixture itself, so this block cannot quietly stop testing
    // the case it exists for.
    const html = fixture('index-running-qualifier');
    assert.match(html, /Northern Ireland Open \(q\)/);
    assert.match(html, /Northern Ireland Open Qual/);
  });

  test('becomes a single tournament, not two', () => {
    assert.equal(ni.length, 1);
  });

  test('is a qualifier whichever label happens to come first on the page', () => {
    assert.equal(ni[0]?.qualifying, true);
  });

  test('is shown under its full name rather than the shorthand', () => {
    assert.equal(ni[0]?.name, 'Northern Ireland Open Qual');
  });

  test('takes its dates from the label that carries a year', () => {
    assert.equal(ni[0]?.from.toISODate(), '2026-09-13');
    assert.equal(ni[0]?.to.toISODate(), '2026-09-16');
  });

  test('marks every match in it as qualifying', () => {
    const tournament = ni[0];
    assert.ok(tournament);
    assert.equal(stageOf(tournament, 'Round 1'), 'Qualifying Round 1');
  });

  test('leaves the main event of the same name as a main event', () => {
    // It shares every word of its name bar the marker. Merging by id rather
    // than by name is what keeps it from being dragged down with its qualifier.
    assert.ok(mainEvent, 'expected the October main event in the capture');
    assert.equal(mainEvent.qualifying, false);
    assert.equal(mainEvent.name, 'Northern Ireland Open');
  });

  test('still spots a qualifier when the first label uses a marker nobody taught it', () => {
    // The real capture cannot test this on its own: both of its labels are
    // recognisable, so reading only the first one happens to work. This is the
    // case the merge exists for, where the site invents a new shorthand and
    // lists it first, but another link to the same event still says "Qual".
    const html = [
      '<a href="index.asp?event=9999">Mystery Open [x] (1-3 Oct)</a>',
      '<a href="index.asp?event=9999">Mystery Open Qual (1-3 Oct 2026)</a>',
    ].join('\n');

    const [mystery] = parseIndex(html, 2026);
    assert.equal(mystery?.qualifying, true);
    assert.equal(mystery?.name, 'Mystery Open Qual');
  });

  test('does not turn a main-draw event into a qualifier by association', () => {
    for (const t of running) {
      if (/\bqual|\(q\)/i.test(t.name)) continue;
      assert.equal(t.qualifying, false, `${t.name} was marked as qualifying`);
    }
  });
});
