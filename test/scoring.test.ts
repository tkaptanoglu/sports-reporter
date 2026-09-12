import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';
import { detectContextFlags } from '../src/scoring/context-flags.js';
import { matchCompetition } from '../src/scoring/match-competition.js';
import { scoreSignificance } from '../src/scoring/significance.js';
import { matchStage } from '../src/scoring/stage.js';
import { scoreEvent } from '../src/scoring/importance.js';
import { renderHtml, writeHtmlReport } from '../src/report/render-html.js';
import { notImplemented } from '../src/util/todo.js';
import { makeEvent } from './helpers.js';

const config = loadConfig(join('test', 'fixtures', 'config'));

describe('notImplemented', () => {
  test('names what is missing, so a stack trace is enough to act on', () => {
    assert.throws(() => notImplemented('the thing'), /Not implemented yet: the thing/);
  });
});

describe('scoreEvent', () => {
  test('refuses an event in a sport you never asked for', () => {
    // This is a programming error rather than a data problem: out-of-scope
    // sports are supposed to be filtered out well before scoring.
    assert.throws(
      () => scoreEvent(makeEvent({ sport: 'curling' }), config),
      /not in interests\.yaml/,
    );
  });

  test('checks scope before it tries to score, so the message is the useful one', () => {
    // If the order were reversed you would get "Not implemented yet" and never
    // learn that the real problem was an unfiltered sport.
    assert.throws(() => scoreEvent(makeEvent({ sport: 'curling' }), config), /interests\.yaml/);
  });
});

describe('detectContextFlags', () => {
  test('claims nothing, because it can currently prove nothing', () => {
    // Deliberate, not an oversight. A wrongly applied title-decider flag would
    // push a meaningless fixture to the top of a Saturday with no explanation.
    assert.deepEqual(detectContextFlags(makeEvent()), []);
    assert.deepEqual(detectContextFlags(makeEvent({ title: 'Derby Day', stage: 'Final' })), []);
  });
});

describe('the unwritten scoring logic', () => {
  // These stubs stop rather than returning a plausible number. A scorer that
  // quietly returns zero would look like a working program producing a boring
  // week, which is the worst possible failure for this app.

  test('competition matching stops rather than guessing', () => {
    assert.throws(() => matchCompetition('Premier League', { 'Premier League': 6 }), /Not implemented yet/);
  });

  test('stage matching stops rather than guessing', () => {
    assert.throws(() => matchStage('football', 'Final', config.rules), /Not implemented yet/);
  });

  test('significance scoring stops rather than guessing', () => {
    assert.throws(() => scoreSignificance(makeEvent(), config.rules), /Not implemented yet/);
  });

  test('the HTML report stops rather than writing an empty page', () => {
    const empty = { generatedAt: new Date(), timezone: 'UTC', days: [], unrated: [], emptySports: [] };
    assert.throws(() => renderHtml(empty), /Not implemented yet/);
    assert.throws(() => writeHtmlReport(empty), /Not implemented yet/);
  });
});
