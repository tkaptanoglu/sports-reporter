import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { buildReport } from '../src/report/build.js';
import { escape, renderHtml, writeHtmlReport } from '../src/report/render-html.js';
import { buildWindow } from '../src/util/days.js';
import { makeScored } from './helpers.js';
import type { ReportWindow } from '../src/util/days.js';

const NOW = DateTime.fromISO('2026-09-12T09:00', { zone: 'Europe/Istanbul' });

const window = (days = 2): ReportWindow =>
  buildWindow({ timezone: 'Europe/Istanbul', days_ahead: days }, NOW);

const report = (events = [makeScored()], scope = ['football']): ReturnType<typeof buildReport> =>
  buildReport(events, window(), scope, NOW.toJSDate());

describe('escape', () => {
  test('neutralises markup arriving from a feed', () => {
    // Team names come from somewhere nobody here controls.
    assert.equal(
      escape('<script>alert("x")</script>'),
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  test('escapes ampersands without double-escaping the result', () => {
    assert.equal(escape('Brighton & Hove Albion'), 'Brighton &amp; Hove Albion');
  });
});

describe('renderHtml', () => {
  const html = renderHtml(
    report([
      makeScored({ title: 'Liverpool vs Fulham', importance: 48 }),
      makeScored({ id: 'b', title: 'Blackburn vs Millwall', competition: 'EFL Championship', importance: 24 }),
    ]),
  );

  test('is a complete standalone document', () => {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>\s*$/);
  });

  test('carries its own styles and never reaches out for anything', () => {
    // A report saved in January must still render in June with no network.
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<link\b/);
    assert.doesNotMatch(html, /src="https?:/);
    assert.doesNotMatch(html, /@import/);
  });

  test('adapts to a dark colour scheme without a toggle', () => {
    assert.match(html, /prefers-color-scheme: dark/);
  });

  test('shows every day, and names the one that is today', () => {
    assert.match(html, /Saturday 12 September/);
    assert.match(html, /Sunday 13 September/);
    assert.match(html, /class="badge">today</);
  });

  test('leads with the score and the local time', () => {
    assert.match(html, /class="score">48</);
    assert.match(html, /class="time">21:00</);
  });

  test('shows the arithmetic behind each score', () => {
    // Seeing which rule produced a number is the only way to argue with it.
    assert.match(html, /Rule <code>Premier League<\/code> gives a base of 6/);
    assert.match(html, /Significance 6<\/strong> &times; your interest 8/);
  });

  test('names the division when its own rating was used', () => {
    // Otherwise a men's game would show "your interest 3 in volleyball" beside
    // a config file that plainly says 7.
    const page = renderHtml(
      report([makeScored({ sport: 'volleyball', interest: 3, interestDivision: 'men', importance: 18 })], ['volleyball']),
    );
    assert.match(page, /your interest 3 in men’s volleyball/);
  });

  test('says nothing about division when the ordinary rating was used', () => {
    assert.doesNotMatch(html, /’s football/);
  });

  test('says plainly when a competition had no rule', () => {
    const unrated = { matchedCompetition: null, base: 1, stageKey: null, stageAdjustment: 0, flags: [], clamped: false };
    const page = renderHtml(report([makeScored({ competition: 'Kit Kat Cup', breakdown: unrated })]));

    assert.match(page, /No rule for this competition/);
  });

  test('offers the missing rules as lines that paste into the table', () => {
    const unrated = { matchedCompetition: null, base: 1, stageKey: null, stageAdjustment: 0, flags: [], clamped: false };
    const page = renderHtml(report([makeScored({ competition: 'Kit Kat Cup', breakdown: unrated })]));

    assert.match(page, /competitions:/);
    assert.match(page, /Kit Kat Cup: 5/);
    assert.match(page, /1 event this week/);
  });

  test('reports the sports that produced nothing', () => {
    const page = renderHtml(report([makeScored()], ['football', 'curling', 'ski-jumping']));
    assert.match(page, /Nothing found for these/);
    assert.match(page, /curling/);
  });

  test('escapes everything that came from a feed', () => {
    const page = renderHtml(report([makeScored({ title: '<b>Arsenal</b> vs "Spurs"' })]));

    assert.match(page, /&lt;b&gt;Arsenal&lt;\/b&gt;/);
    assert.doesNotMatch(page, /<b>Arsenal<\/b>/);
  });

  test('renders an empty week without falling over', () => {
    const page = renderHtml(report([], ['football']));

    assert.match(page, /Nothing on\./);
    assert.match(page, /0 events over 2 days/);
  });

  test('starts with both filters hidden, so the page works without scripting', () => {
    assert.match(html, /<div class="filter" hidden>/);
  });

  test('offers a toggle per sport, busiest first, with its count', () => {
    const page = renderHtml(
      report(
        [
          makeScored({ id: 'a', sport: 'snooker' }),
          makeScored({ id: 'b', sport: 'snooker' }),
          makeScored({ id: 'c', sport: 'football' }),
        ],
        ['snooker', 'football'],
      ),
    );

    assert.match(page, /<div class="filter sports" hidden>/);
    // Snooker has two events and football one, so snooker leads.
    const order = [...page.matchAll(/class="sport-toggle on" data-sport="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ['snooker', 'football']);
    assert.match(page, /data-sport="snooker">snooker<span class="count">2<\/span>/);
    assert.match(page, /data-sport="football">football<span class="count">1<\/span>/);
  });

  test('every sport starts switched on', () => {
    const page = renderHtml(report([makeScored({ sport: 'snooker' }), makeScored({ id: 'b', sport: 'football' })], ['snooker', 'football']));
    const toggles = [...page.matchAll(/class="sport-toggle([^"]*)"/g)].map((m) => m[1]);

    assert.ok(toggles.length >= 2);
    for (const classes of toggles) assert.match(classes ?? '', /\bon\b/);
  });

  test('tags each event with its sport, so the toggles have something to act on', () => {
    assert.match(html, /data-sport="football"/);
  });

  test('leaves the sport row out when there is only one sport to toggle', () => {
    // A row with a single button that can only hide everything is just clutter.
    const page = renderHtml(report([makeScored()], ['football']));
    assert.doesNotMatch(page, /filter sports/);
  });

  test('grades the score colour against the best event in the week, not a fixed scale', () => {
    // Interest ratings differ per person, so a fixed threshold would leave one
    // reader with nothing marked and another with everything marked.
    assert.match(html, /class="event hot"/);
    assert.match(html, /class="event (warm|cool)"/);
  });
});

describe('writeHtmlReport', () => {
  test('writes the file and hands back where it went', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    const path = writeHtmlReport(report(), dir);

    assert.match(path, /2026-09-12\.html$/);
    assert.match(readFileSync(path, 'utf8'), /^<!doctype html>/);
  });

  test('creates the directory rather than requiring one', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sports-reporter-')), 'nested', 'reports');
    assert.ok(readFileSync(writeHtmlReport(report(), dir), 'utf8').length > 0);
  });

  test('names the file for the day it covers, so a rerun overwrites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sports-reporter-'));
    assert.equal(writeHtmlReport(report(), dir), writeHtmlReport(report(), dir));
  });
});
