import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { buildWindow, dayKeyFor, localTimeFor } from '../src/util/days.js';
import type { Settings } from '../src/config/types.js';

const settings = (over: Partial<Settings> = {}): Settings => ({
  timezone: 'Europe/Istanbul',
  days_ahead: 7,
  ...over,
});

const at = (iso: string, zone: string): DateTime => DateTime.fromISO(iso, { zone });

describe('buildWindow', () => {
  test('produces one day per requested day, starting today', () => {
    const now = at('2026-09-12T15:30', 'Europe/Istanbul');
    const win = buildWindow(settings(), now);

    assert.equal(win.days.length, 7);
    assert.equal(win.days[0]?.key, '2026-09-12');
    assert.equal(win.days[6]?.key, '2026-09-18');
  });

  test('days are consecutive with no gaps or repeats', () => {
    const win = buildWindow(settings(), at('2026-12-29T09:00', 'Europe/Istanbul'));
    const keys = win.days.map((d) => d.key);

    assert.deepEqual(keys, [
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
      '2027-01-04',
    ]);
  });

  test('labels read the way a person would say them', () => {
    const win = buildWindow(settings({ days_ahead: 1 }), at('2026-09-12T15:30', 'Europe/Istanbul'));
    assert.equal(win.days[0]?.label, 'Saturday 12 September');
  });

  test('window starts at local midnight and ends exclusively', () => {
    const win = buildWindow(settings({ days_ahead: 2 }), at('2026-09-12T23:59', 'Europe/Istanbul'));

    assert.equal(win.from.toISOString(), '2026-09-11T21:00:00.000Z');
    assert.equal(win.to.toISOString(), '2026-09-13T21:00:00.000Z');
    assert.equal(win.to.getTime(), win.days[1]?.end.getTime());
  });

  test('a late evening event still lands on the day the reader calls it', () => {
    // 21:45 UTC is the small hours of the next day in Istanbul, but still the
    // same evening in London. Both readers should see it where they expect.
    const kickoff = new Date('2026-09-12T21:45:00Z');

    assert.equal(dayKeyFor(kickoff, 'Europe/Istanbul'), '2026-09-13');
    assert.equal(dayKeyFor(kickoff, 'Europe/London'), '2026-09-12');
  });

  test('survives a clock change without losing or repeating a day', () => {
    // British Summer Time starts on 29 March 2026, making that day 23 hours.
    const win = buildWindow(
      { timezone: 'Europe/London', days_ahead: 3 },
      at('2026-03-28T12:00', 'Europe/London'),
    );

    assert.deepEqual(
      win.days.map((d) => d.key),
      ['2026-03-28', '2026-03-29', '2026-03-30'],
    );

    const shortDay = win.days[1];
    assert.ok(shortDay);
    const hours = (shortDay.end.getTime() - shortDay.start.getTime()) / 3_600_000;
    assert.equal(hours, 23, 'the day the clocks go forward should be 23 hours long');
  });

  test('rejects a timezone that is not a real IANA name', () => {
    assert.throws(
      () => buildWindow(settings({ timezone: 'Europe/Istanbull' })),
      /Unknown timezone "Europe\/Istanbull"/,
    );
  });

  test('rejects a window of no days', () => {
    assert.throws(() => buildWindow(settings({ days_ahead: 0 })), /at least 1/);
  });
});

describe('localTimeFor', () => {
  test('renders the clock time the reader would see', () => {
    const kickoff = new Date('2026-09-12T18:00:00Z');
    assert.equal(localTimeFor(kickoff, 'Europe/Istanbul'), '21:00');
    assert.equal(localTimeFor(kickoff, 'Europe/London'), '19:00');
  });
});
