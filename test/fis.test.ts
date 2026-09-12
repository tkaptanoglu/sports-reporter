import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCalendar, parseDateRange, seasonCode, toSportEvents } from '../src/sources/fis.js';
import type { FetchRequest } from '../src/sources/types.js';

const html = readFileSync(join('test', 'fixtures', 'fis', 'calendar.html'), 'utf8');
const rows = parseCalendar(html, 2027);

const request = (over: Partial<FetchRequest> = {}): FetchRequest => ({
  sports: ['ski-jumping'],
  from: new Date('2026-11-01T00:00:00Z'),
  to: new Date('2026-12-31T00:00:00Z'),
  timezone: 'Europe/Istanbul',
  ...over,
});

describe('seasonCode', () => {
  test('names a winter season for the year it ends in', () => {
    // The 2026/27 season is FIS season 2027, and July is where it turns over.
    assert.equal(seasonCode(new Date('2026-09-12T00:00:00Z')), '2027');
    assert.equal(seasonCode(new Date('2027-02-01T00:00:00Z')), '2027');
    assert.equal(seasonCode(new Date('2027-06-30T00:00:00Z')), '2027');
    assert.equal(seasonCode(new Date('2027-07-01T00:00:00Z')), '2028');
  });
});

describe('parseCalendar', () => {
  test('reads the rows out of a captured page', () => {
    assert.ok(rows.length > 0, 'no rows parsed from a live capture');
  });

  test('takes the dates from the row attributes, not the printed text', () => {
    // The printed date is localised and abbreviated. The attributes are not.
    const ruka = rows.find((r) => r.place === 'Ruka');
    assert.ok(ruka, 'expected a Ruka stop in the captured season');
    assert.equal(ruka.from.toISODate(), '2026-11-28');
    assert.equal(ruka.to.toISODate(), '2026-11-29');
  });

  test('puts each stop in the right calendar year', () => {
    // A winter season straddles new year. Months from July belong to the
    // opening year and the rest to the closing one, so a December stop in
    // season 2027 is December 2026.
    for (const row of rows) {
      const expected = row.from.month >= 7 ? 2026 : 2027;
      assert.equal(row.from.year, expected, `${row.place} landed in the wrong year`);
    }
  });

  test('keeps the category code and the venue apart', () => {
    for (const row of rows) {
      assert.match(row.category, /^[A-Z]{2,4}$/, `bad category on ${row.place}`);
      assert.ok(row.place.length > 0);
      assert.ok(!row.place.includes('•'));
    }
  });

  test('returns nothing rather than guessing when the page changes shape', () => {
    assert.deepEqual(parseCalendar('<html><body>redesigned</body></html>', 2027), []);
  });
});

describe('parseDateRange', () => {
  test('reads a range inside one month', () => {
    const r = parseDateRange('20-22 Nov 2026');
    assert.equal(r?.from.toISODate(), '2026-11-20');
    assert.equal(r?.to.toISODate(), '2026-11-22');
  });

  test('reads a single day', () => {
    const r = parseDateRange('3 Jan 2027');
    assert.equal(r?.from.toISODate(), '2027-01-03');
    assert.equal(r?.to.toISODate(), '2027-01-03');
  });

  test('reads a range across new year and gets both years right', () => {
    // The Four Hills does this every season.
    const r = parseDateRange('30 Dec - 3 Jan 2027');
    assert.equal(r?.from.toISODate(), '2026-12-30');
    assert.equal(r?.to.toISODate(), '2027-01-03');
  });

  test('returns null for anything it cannot read', () => {
    assert.equal(parseDateRange('sometime in winter'), null);
  });
});

describe('toSportEvents', () => {
  const events = toSportEvents(rows, request());

  test('emits one event per day of a stop', () => {
    const ruka = rows.find((r) => r.place === 'Ruka');
    assert.ok(ruka);
    const mine = events.filter((e) => e.id.startsWith(`fis:${ruka.eventId}:`));
    assert.equal(mine.length, 2, 'a two-day stop should produce two events');
  });

  test('maps the FIS category onto the rules.yaml spelling', () => {
    const wc = events.find((e) => e.title.includes('WC'));
    assert.equal(wc?.competition, 'FIS Ski Jumping World Cup');
  });

  test('places an untimed event at local midday, never at midnight', () => {
    // FIS publishes no start times. Midnight would read as a lie and would
    // sort every jump above the early fixtures of the day.
    for (const event of events) {
      const hour = Number(
        event.startsAt.toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }),
      );
      assert.equal(hour, 12);
    }
  });

  test('never reaches outside the requested window', () => {
    const narrow = request({
      from: new Date('2026-11-28T00:00:00Z'),
      to: new Date('2026-11-30T00:00:00Z'),
    });

    for (const event of toSportEvents(rows, narrow)) {
      assert.ok(event.startsAt >= narrow.from);
      assert.ok(event.startsAt < narrow.to);
    }
  });

  test('every event is ski jumping, sourced and linked back', () => {
    for (const event of events) {
      assert.equal(event.sport, 'ski-jumping');
      assert.equal(event.source, 'fis');
      assert.match(event.url ?? '', /fis-ski\.com/);
    }
  });
});
