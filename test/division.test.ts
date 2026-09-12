import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';
import { divisionOf, siftByDivision, wanted } from '../src/scoring/division.js';
import { makeEvent } from './helpers.js';
import type { SportInterest } from '../src/config/types.js';

const config = loadConfig(join('test', 'fixtures', 'config'));

const womensOnly: SportInterest = { interest: 7, only: 'women', also: ['Sultanlar Ligi'] };
const anything: SportInterest = { interest: 7 };

describe('divisionOf', () => {
  test('believes the source over the text when the source knows', () => {
    // ESPN asked the WTA endpoint. That is a fact, not an inference.
    const event = makeEvent({ division: 'women', competition: 'SP Open', title: 'SP Open' });
    assert.equal(divisionOf(event), 'women');
  });

  test('reads the marker out of the competition name when the source is silent', () => {
    assert.equal(
      divisionOf(makeEvent({ competition: 'Mens European Volleyball Championship' })),
      'men',
    );
    assert.equal(
      divisionOf(makeEvent({ competition: 'Womens European Volleyball Championship' })),
      'women',
    );
  });

  test('does not read "womens" as the word "men"', () => {
    // One substring away from inverting the whole preference.
    assert.equal(divisionOf(makeEvent({ competition: "Women's Super League" })), 'women');
  });

  test('recognises markers in other languages, because feeds are not all English', () => {
    assert.equal(divisionOf(makeEvent({ competition: 'Damen Bundesliga' })), 'women');
    assert.equal(divisionOf(makeEvent({ competition: 'Erkekler Voleybol Ligi' })), 'men');
  });

  test('never reads a club name as a division marker', () => {
    // "Man City" normalises to the word "man", which is exactly why the
    // singular forms are not markers.
    assert.equal(divisionOf(makeEvent({ title: 'Man City vs Man United' })), null);
    assert.equal(divisionOf(makeEvent({ title: 'Manchester City vs Arsenal' })), null);
  });

  test('says null rather than guessing at an unmarked competition', () => {
    assert.equal(divisionOf(makeEvent({ competition: 'German 1. Bundesliga' })), null);
    assert.equal(divisionOf(makeEvent({ competition: 'Sultanlar Ligi' })), null);
  });
});

describe('wanted', () => {
  test('keeps everything when no preference is set', () => {
    assert.equal(wanted(makeEvent({ competition: 'Mens European Championship' }), anything), true);
  });

  test('keeps the division asked for and drops the other', () => {
    const womens = makeEvent({ competition: 'Womens European Volleyball Championship' });
    const mens = makeEvent({ competition: 'Mens European Volleyball Championship' });

    assert.equal(wanted(womens, womensOnly), true);
    assert.equal(wanted(mens, womensOnly), false);
  });

  test('drops an unmarked competition rather than letting it through', () => {
    // A competition that does not say it is women's usually is not, and
    // quietly including it would defeat the point of asking.
    assert.equal(wanted(makeEvent({ competition: 'German 1. Bundesliga' }), womensOnly), false);
  });

  test('keeps an unmarked competition that you named yourself', () => {
    // Sultanlar Ligi is the women's Turkish league and its name says nothing.
    assert.equal(wanted(makeEvent({ competition: 'Sultanlar Ligi' }), womensOnly), true);
  });

  test('matches a named exception inside a longer feed spelling', () => {
    const event = makeEvent({ competition: 'Turkish Sultanlar Ligi 2026' });
    assert.equal(wanted(event, womensOnly), true);
  });
});

describe('preferring a division without excluding the other', () => {
  // `only` throws half a sport away. `prefer` keeps everything and gives one
  // side a bonus, so a men's Olympic final still reaches you below the
  // women's one.
  const leaning: SportInterest = { interest: 7, prefer: 'women' };

  test('keeps both sides, unlike only', () => {
    const mens = makeEvent({ competition: 'Mens European Volleyball Championship' });
    assert.equal(wanted(mens, leaning), true);
    assert.equal(wanted(mens, { interest: 7, only: 'women' }), false);
  });

  test('keeps an unmarked competition too', () => {
    assert.equal(wanted(makeEvent({ competition: 'German 1. Bundesliga' }), leaning), true);
  });
});

describe('siftByDivision', () => {
  const events = [
    makeEvent({ id: '1', sport: 'volleyball', competition: 'Womens European Volleyball Championship' }),
    makeEvent({ id: '2', sport: 'volleyball', competition: 'Mens European Volleyball Championship' }),
    makeEvent({ id: '3', sport: 'volleyball', competition: 'German 1. Bundesliga' }),
    makeEvent({ id: '4', sport: 'volleyball', competition: 'Sultanlar Ligi' }),
    makeEvent({ id: '5', sport: 'football', competition: 'Premier League' }),
  ];

  const { kept, dropped } = siftByDivision(events, config.interests.sports);

  test('keeps the wanted division, the named exceptions, and every other sport', () => {
    assert.deepEqual(kept.map((e) => e.id), ['1', '4', '5']);
  });

  test('says why each dropped event went, so nothing vanishes silently', () => {
    assert.deepEqual(
      dropped.map((d) => [d.event.id, d.reason]),
      [
        ['2', 'wrong-division'],
        ['3', 'no-division-stated'],
      ],
    );
  });

  test('leaves a sport with no preference completely alone', () => {
    const footballOnly = [makeEvent({ sport: 'football', competition: 'Mens FA Cup' })];
    assert.equal(siftByDivision(footballOnly, config.interests.sports).kept.length, 1);
  });

  test('leaves a sport that is not in interests at all alone', () => {
    // Out-of-scope sports are dropped elsewhere, by name. Not this filter's job.
    const stray = [makeEvent({ sport: 'curling', competition: 'Mens World Championship' })];
    assert.equal(siftByDivision(stray, config.interests.sports).kept.length, 1);
  });
});
