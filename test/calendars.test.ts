import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFeeds, parseIcs, parseIcsDate, toSportEvents } from '../src/sources/calendars.js';
import type { CalendarFeed } from '../src/sources/calendars.js';

const feed: CalendarFeed = {
  sport: 'alpine-skiing',
  url: 'https://example.org/fis.ics',
  competition: 'FIS Alpine Ski World Cup',
};

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:race-1@example.org',
  'DTSTART:20270116T103000Z',
  'SUMMARY:Men\\, Downhill',
  'LOCATION:Wengen',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:race-2@example.org',
  'DTSTART;TZID=Europe/Zurich:20270117T123000',
  'SUMMARY:Men Slalom, second run at the Lauberhorn with a very long name that',
  ' wraps across two lines',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:race-3@example.org',
  'DTSTART;VALUE=DATE:20270118',
  'SUMMARY:Rest day',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcsDate', () => {
  test('reads a UTC stamp', () => {
    const { date, allDay } = parseIcsDate('20270116T103000Z');
    assert.equal(date?.toISOString(), '2027-01-16T10:30:00.000Z');
    assert.equal(allDay, false);
  });

  test('honours an explicit timezone rather than assuming UTC', () => {
    // Zurich is UTC+1 in January. Ignoring TZID would put this race an hour out.
    const { date } = parseIcsDate('20270117T123000', ['TZID=Europe/Zurich']);
    assert.equal(date?.toISOString(), '2027-01-17T11:30:00.000Z');
  });

  test('places an all-day entry at midday so it cannot slide into the day before', () => {
    const { date, allDay } = parseIcsDate('20270118', ['VALUE=DATE']);
    assert.equal(allDay, true);
    assert.equal(date?.toISOString(), '2027-01-18T12:00:00.000Z');
  });

  test('returns null for something it cannot read', () => {
    assert.equal(parseIcsDate('not-a-date').date, null);
  });
});

describe('parseIcs', () => {
  const events = parseIcs(ICS);

  test('finds every event', () => {
    assert.equal(events.length, 3);
  });

  test('unwraps a summary folded across two lines', () => {
    // iCalendar wraps at 75 octets and marks the continuation with a space.
    // Reading it naively truncates the title mid-word.
    assert.match(events[1]?.summary ?? '', /wraps across two lines$/);
  });

  test('unescapes the characters iCalendar requires escaping', () => {
    assert.equal(events[0]?.summary, 'Men, Downhill');
  });

  test('keeps the identifiers and places', () => {
    assert.equal(events[0]?.uid, 'race-1@example.org');
    assert.equal(events[0]?.location, 'Wengen');
  });
});

describe('toSportEvents', () => {
  test('uses the configured competition, not each event summary', () => {
    const events = toSportEvents(parseIcs(ICS), feed);

    for (const event of events) {
      assert.equal(event.competition, 'FIS Alpine Ski World Cup');
      assert.equal(event.sport, 'alpine-skiing');
      assert.equal(event.source, 'calendar');
    }
  });

  test('falls back to the event summary when no competition is configured', () => {
    const bare: CalendarFeed = { sport: 'curling', url: 'https://example.org/c.ics' };
    assert.equal(toSportEvents(parseIcs(ICS), bare)[0]?.competition, 'Men, Downhill');
  });

  test('builds ids from the feed uid so a re-fetch does not duplicate anything', () => {
    const ids = toSportEvents(parseIcs(ICS), feed).map((e) => e.id);
    assert.deepEqual(ids, [
      'calendar:alpine-skiing:race-1@example.org',
      'calendar:alpine-skiing:race-2@example.org',
      'calendar:alpine-skiing:race-3@example.org',
    ]);
  });

  test('drops an event with no usable start', () => {
    const broken = parseIcs('BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:No date\r\nEND:VEVENT');
    assert.deepEqual(toSportEvents(broken, feed), []);
  });
});

describe('loadFeeds', () => {
  test('returns nothing when no feed file exists, which is the shipped state', () => {
    assert.deepEqual(loadFeeds(mkdtempSync(join(tmpdir(), 'sports-reporter-'))), []);
  });

  test('reads a feed list when one is provided', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    writeFileSync(
      join(dir, 'calendars.yaml'),
      'feeds:\n  - sport: curling\n    competition: World Curling Championship\n    url: https://example.org/c.ics\n',
    );

    const feeds = loadFeeds(dir);
    assert.equal(feeds.length, 1);
    assert.equal(feeds[0]?.sport, 'curling');
    assert.equal(feeds[0]?.competition, 'World Curling Championship');
  });

  test('ignores an entry with no url instead of failing the run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    writeFileSync(join(dir, 'calendars.yaml'), 'feeds:\n  - sport: curling\n');

    assert.deepEqual(loadFeeds(dir), []);
  });
});
