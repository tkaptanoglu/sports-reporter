import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents, sources } from '../src/sources/registry.js';
import { sourceCovers } from '../src/sources/types.js';
import { brokenSource, fakeSource, makeEvent, quietly } from './helpers.js';
import type { FetchRequest } from '../src/sources/types.js';

const request = (over: Partial<FetchRequest> = {}): FetchRequest => ({
  sports: ['football'],
  from: new Date('2026-09-12T00:00:00Z'),
  to: new Date('2026-09-19T00:00:00Z'),
  timezone: 'Europe/Istanbul',
  ...over,
});

describe('sourceCovers', () => {
  test('a source claiming everything is always asked', () => {
    assert.equal(sourceCovers(fakeSource('all', [], 'all'), ['curling']), true);
  });

  test('a specialist source is asked when it overlaps', () => {
    const fis = fakeSource('fis', [], ['alpine-skiing', 'ski-jumping']);
    assert.equal(sourceCovers(fis, ['football', 'ski-jumping']), true);
  });

  test('a specialist source is skipped when it does not', () => {
    const fis = fakeSource('fis', [], ['alpine-skiing', 'ski-jumping']);
    assert.equal(sourceCovers(fis, ['football', 'tennis']), false);
  });
});

describe('collectEvents', () => {
  test('merges what every source returns', async () => {
    const events = await quietly(() =>
      collectEvents(request(), [
        fakeSource('a', [makeEvent({ id: 'a:1' })]),
        fakeSource('b', [makeEvent({ id: 'b:1' })]),
      ]),
    );

    assert.deepEqual(events.map((e) => e.id).sort(), ['a:1', 'b:1']);
  });

  test('one broken feed does not cost you the whole run', async () => {
    const events = await quietly(() =>
      collectEvents(request(), [
        brokenSource('dead'),
        fakeSource('alive', [makeEvent({ id: 'alive:1' })]),
      ]),
    );

    assert.deepEqual(
      events.map((e) => e.id),
      ['alive:1'],
    );
  });

  test('drops events outside the requested window', async () => {
    const events = await quietly(() =>
      collectEvents(request(), [
        fakeSource('a', [
          makeEvent({ id: 'before', startsAt: new Date('2026-09-11T12:00:00Z') }),
          makeEvent({ id: 'inside', startsAt: new Date('2026-09-14T12:00:00Z') }),
          makeEvent({ id: 'after', startsAt: new Date('2026-09-20T12:00:00Z') }),
        ]),
      ]),
    );

    assert.deepEqual(
      events.map((e) => e.id),
      ['inside'],
    );
  });

  test('the window end is exclusive, so it cannot double-count a boundary', async () => {
    const events = await quietly(() =>
      collectEvents(request(), [
        fakeSource('a', [
          makeEvent({ id: 'at-start', startsAt: new Date('2026-09-12T00:00:00Z') }),
          makeEvent({ id: 'at-end', startsAt: new Date('2026-09-19T00:00:00Z') }),
        ]),
      ]),
    );

    assert.deepEqual(
      events.map((e) => e.id),
      ['at-start'],
    );
  });

  test('drops sports that were not asked for, even if a source volunteers them', async () => {
    const events = await quietly(() =>
      collectEvents(request({ sports: ['football'] }), [
        fakeSource('a', [
          makeEvent({ id: 'wanted', sport: 'football' }),
          makeEvent({ id: 'unwanted', sport: 'darts' }),
        ]),
      ]),
    );

    assert.deepEqual(
      events.map((e) => e.id),
      ['wanted'],
    );
  });

  test('collapses the same event id reported twice', async () => {
    const events = await quietly(() =>
      collectEvents(request(), [
        fakeSource('a', [makeEvent({ id: 'same', title: 'First' })]),
        fakeSource('b', [makeEvent({ id: 'same', title: 'Second' })]),
      ]),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, 'First', 'the first source to answer should win');
  });

  test('returns nothing when no source covers the sports asked for', async () => {
    const events = await quietly(() =>
      collectEvents(request({ sports: ['curling'] }), [fakeSource('a', [], ['football'])]),
    );

    assert.deepEqual(events, []);
  });
});

describe('the real registry', () => {
  test('every registered source has a distinct name', () => {
    const names = sources.map((s) => s.name);
    assert.equal(new Set(names).size, names.length);
  });

  test('no two sources claim the same sport', () => {
    // The design decision, written down so it cannot quietly erode. Two
    // sources describing one fixture would produce two entries, not one,
    // because they arrive under different ids and survive deduplication.
    const owner = new Map<string, string>();

    for (const source of sources) {
      if (source.sports === 'all') continue;
      for (const sport of source.sports) {
        const already = owner.get(sport);
        assert.equal(already, undefined, `${sport} is claimed by both ${already} and ${source.name}`);
        owner.set(sport, source.name);
      }
    }
  });

  test('snooker and ski jumping belong to their dedicated sources', () => {
    // Both were moved off the general sources on purpose: one to get the
    // players named, the other because nothing else carries the sport at all.
    const owns = (name: string, sport: string): boolean => {
      const source = sources.find((s) => s.name === name);
      return source !== undefined && source.sports !== 'all' && source.sports.includes(sport);
    };

    assert.ok(owns('snooker', 'snooker'));
    assert.ok(owns('fis', 'ski-jumping'));
    assert.ok(!owns('thesportsdb', 'snooker'));
  });

  test('between them the sources cover every sport that has a source at all', () => {
    const claimed = new Set(sources.flatMap((s) => (s.sports === 'all' ? [] : s.sports)));

    for (const sport of ['football', 'tennis', 'formula1', 'basketball', 'cycling', 'athletics', 'motogp', 'snooker', 'volleyball', 'handball', 'ski-jumping']) {
      assert.ok(claimed.has(sport), `no source claims ${sport}`);
    }

    // Stated as a test so it is impossible to forget: nothing covers these.
    for (const sport of ['alpine-skiing', 'curling']) {
      assert.ok(!claimed.has(sport), `${sport} now has a source, so update the README`);
    }
  });
});
