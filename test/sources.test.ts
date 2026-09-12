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

  test('every source is still a stub returning nothing', async () => {
    for (const source of sources) {
      const events = await quietly(() => source.fetchEvents(request()));
      assert.deepEqual(events, [], `${source.name} unexpectedly returned events`);
    }
  });
});
