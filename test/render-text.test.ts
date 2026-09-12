import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { buildReport } from '../src/report/build.js';
import { renderText } from '../src/report/render-text.js';
import { buildWindow } from '../src/util/days.js';
import { makeScored } from './helpers.js';
import type { ReportWindow } from '../src/util/days.js';

const window = (): ReportWindow =>
  buildWindow(
    { timezone: 'Europe/Istanbul', days_ahead: 2 },
    DateTime.fromISO('2026-09-12T09:00', { zone: 'Europe/Istanbul' }),
  );

describe('renderText', () => {
  test('heads every day, including the empty ones', () => {
    const text = renderText(buildReport([], window(), []));

    assert.match(text, /Saturday 12 September/);
    assert.match(text, /Sunday 13 September/);
    assert.match(text, /nothing/);
  });

  test('shows the local kickoff time, not the raw instant', () => {
    const report = buildReport(
      [makeScored({ startsAt: new Date('2026-09-12T18:00:00Z') })],
      window(),
      ['football'],
    );

    assert.match(renderText(report), /21:00/);
  });

  test('shows what an event is worth and what it is', () => {
    const report = buildReport(
      [makeScored({ title: 'Liverpool vs Arsenal', competition: 'Premier League', importance: 48 })],
      window(),
      ['football'],
    );
    const text = renderText(report);

    assert.match(text, /48/);
    assert.match(text, /Liverpool vs Arsenal/);
    assert.match(text, /Premier League/);
  });

  test('explains silence rather than leaving it looking like a bug', () => {
    const text = renderText(buildReport([], window(), ['curling', 'ski-jumping']));

    assert.match(text, /Out of season/);
    assert.match(text, /curling, ski-jumping/);
  });

  test('lists competitions with no rule so the table can grow', () => {
    const report = buildReport(
      [
        makeScored({
          competition: 'Kit Kat Cup',
          breakdown: { matchedCompetition: null, base: 2, stageKey: null, stageAdjustment: 0, flags: [], clamped: false },
        }),
      ],
      window(),
      ['football'],
    );
    const text = renderText(report);

    assert.match(text, /not in rules\.yaml/);
    assert.match(text, /football: Kit Kat Cup/);
  });

  test('says nothing about unrated competitions when there are none', () => {
    const text = renderText(buildReport([makeScored()], window(), ['football']));

    assert.doesNotMatch(text, /not in rules\.yaml/);
  });

  test('states the timezone, because every time in the report depends on it', () => {
    assert.match(renderText(buildReport([], window(), [])), /Europe\/Istanbul/);
  });
});
