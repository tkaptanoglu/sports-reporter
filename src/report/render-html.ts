import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DateTime } from 'luxon';
import { dayKeyFor, localTimeFor } from '../util/days.js';
import type { ScoredEvent } from '../model/event.js';
import type { DayReport, Report } from './types.js';

/**
 * The report you actually read: a self-contained HTML file.
 *
 * Self-contained is the constraint that shapes everything here. No CDN, no
 * external stylesheet, no font fetched when you open it. A report you saved in
 * January must still render in June on a train with no signal.
 *
 * The only script is a few lines to hide the low scorers, and the page is
 * complete without it.
 */

export function renderHtml(report: Report): string {
  const total = report.days.reduce((n, day) => n + day.events.length, 0);
  const ceiling = Math.max(1, ...report.days.flatMap((d) => d.events.map((e) => e.importance)));
  const today = dayKeyFor(report.generatedAt, report.timezone);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What to watch${report.days[0] ? ` &middot; ${escape(report.days[0].label)}` : ''}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>What to watch</h1>
  <p class="meta">
    ${total} event${total === 1 ? '' : 's'} over ${report.days.length} day${report.days.length === 1 ? '' : 's'}.
    Times in ${escape(report.timezone)}.
    Built ${escape(stamp(report.generatedAt, report.timezone))}.
  </p>
  ${renderFilter()}
</header>

<main>
${report.days.map((day) => renderDay(day, day.key === today, ceiling, report.timezone)).join('\n')}
</main>

${renderEmptySports(report)}
${renderUnrated(report)}

<script>${SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Writes the report and returns the path written.
 *
 * Named for the day it covers rather than the moment it was built, so running
 * it twice on a Saturday overwrites rather than accumulating near-duplicates.
 * reports/ is already in .gitignore.
 */
export function writeHtmlReport(report: Report, outDir = 'reports'): string {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });

  const first = report.days[0]?.key ?? dayKeyFor(report.generatedAt, report.timezone);
  const path = join(dir, `${first}.html`);
  writeFileSync(path, renderHtml(report), 'utf8');

  return path;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderDay(day: DayReport, isToday: boolean, ceiling: number, timezone: string): string {
  const classes = ['day', isToday ? 'today' : '', day.events.length === 0 ? 'quiet' : '']
    .filter(Boolean)
    .join(' ');

  const body =
    day.events.length === 0
      ? '<p class="nothing">Nothing on.</p>'
      : day.events.map((event) => renderEvent(event, ceiling, timezone)).join('\n');

  return `<section class="${classes}">
  <h2>${escape(day.label)}${isToday ? '<span class="badge">today</span>' : ''}</h2>
  ${body}
</section>`;
}

/**
 * One event, with its arithmetic folded away behind a disclosure triangle.
 *
 * The workings are the point of showing them at all: the only way to argue with
 * a score is to see which rule produced it.
 */
function renderEvent(event: ScoredEvent, ceiling: number, timezone: string): string {
  const heat = event.importance >= ceiling * 0.66 ? 'hot' : event.importance >= ceiling * 0.33 ? 'warm' : 'cool';

  return `  <details class="event ${heat}" data-importance="${event.importance}">
    <summary>
      <span class="score">${event.importance}</span>
      <span class="time">${escape(localTimeFor(event.startsAt, timezone))}</span>
      <span class="what">
        <span class="title">${escape(event.title)}</span>
        <span class="comp">${escape(event.competition)}<span class="sport">${escape(event.sport)}</span></span>
      </span>
    </summary>
    <div class="why">${renderWorkings(event)}</div>
  </details>`;
}

function renderWorkings(event: ScoredEvent): string {
  const b = event.breakdown;
  const parts: string[] = [];

  parts.push(
    b.matchedCompetition === null
      ? `<em>No rule for this competition.</em> Base ${b.base}, the default for an unknown.`
      : `Rule <code>${escape(b.matchedCompetition)}</code> gives a base of ${b.base}.`,
  );

  if (b.stageKey !== null) {
    parts.push(`Stage <code>${escape(b.stageKey)}</code> ${signed(b.stageAdjustment)}.`);
  }

  for (const flag of b.flags) {
    parts.push(`Flag <code>${escape(flag.flag)}</code> ${signed(flag.adjustment)}.`);
  }

  if (b.clamped) parts.push('Pulled back inside 0 to 10.');

  parts.push(
    `<strong>Significance ${event.significance}</strong> &times; your interest ${event.interest} ` +
      `in ${escape(event.sport)} = <strong>${event.importance}</strong>.`,
  );

  const link =
    event.url === null
      ? ''
      : `<p class="link"><a href="${escape(event.url)}" rel="noreferrer noopener">source</a></p>`;

  return `<p>${parts.join(' ')}</p>${link}`;
}

function renderEmptySports(report: Report): string {
  if (report.emptySports.length === 0) return '';

  return `<section class="note">
  <h2>Nothing found for these</h2>
  <p>Out of season, no source for them, a source failed, or your division filter removed everything. The terminal log says which.</p>
  <p class="tags">${report.emptySports.map((s) => `<span class="sport">${escape(s)}</span>`).join('')}</p>
</section>`;
}

/**
 * The competitions that matched no rule, formatted so the lines can be pasted
 * straight into rules.yaml. This is how that table is meant to grow.
 */
function renderUnrated(report: Report): string {
  if (report.unrated.length === 0) return '';

  const bySport = new Map<string, typeof report.unrated>();
  for (const item of report.unrated) {
    const list = bySport.get(item.sport);
    if (list === undefined) bySport.set(item.sport, [item]);
    else list.push(item);
  }

  const blocks = [...bySport]
    .map(([sport, items]) => {
      const lines = items.map((i) => `      ${i.competition}: 5   # ${i.count} event${i.count === 1 ? '' : 's'} this week`);
      return [`  ${sport}:`, '    competitions:', ...lines].join('\n');
    })
    .join('\n');

  return `<section class="note">
  <h2>No rule for these yet</h2>
  <p>They scored the unknown default. Paste any that matter into <code>config/rules.yaml</code> and pick a real number.</p>
  <pre>${escape(blocks)}</pre>
</section>`;
}

function renderFilter(): string {
  return `  <div class="filter" hidden>
    <span>Show</span>
    <button type="button" data-min="0" class="on">everything</button>
    <button type="button" data-min="0.33">the better half</button>
    <button type="button" data-min="0.66">only the big ones</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes text for HTML.
 *
 * Every string in this page comes from a sports feed, which is to say from
 * somewhere nobody here controls. A team name containing a stray angle bracket
 * should render as a stray angle bracket, not as markup.
 */
export function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function signed(n: number): string {
  return n === 0 ? 'changes nothing' : n > 0 ? `adds ${n}` : `takes off ${Math.abs(n)}`;
}

function stamp(when: Date, timezone: string): string {
  return DateTime.fromJSDate(when).setZone(timezone).toFormat('d LLLL yyyy, HH:mm');
}

const STYLES = `
:root {
  color-scheme: light;
  --bg: #fbfaf8;
  --panel: #ffffff;
  --ink: #1a1a18;
  --muted: #6b6a66;
  --line: #e4e2dd;
  --hot: #b3402a;
  --warm: #8a6a2f;
  --cool: #6b6a66;
  --badge-bg: #eceae5;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #16161a;
    --panel: #1d1d22;
    --ink: #e8e6e1;
    --muted: #98968f;
    --line: #2c2c33;
    --hot: #e8836a;
    --warm: #d2ac63;
    --cool: #98968f;
    --badge-bg: #2c2c33;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
  max-width: 46rem;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
h1 { font-size: 1.6rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
h2 { font-size: .95rem; margin: 0 0 .6rem; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.meta { margin: 0 0 1rem; color: var(--muted); font-size: .85rem; }
.badge {
  margin-left: .5rem; padding: .1rem .4rem; border-radius: 3px;
  background: var(--badge-bg); color: var(--ink);
  font-size: .7rem; letter-spacing: .04em;
}
.filter { display: flex; gap: .4rem; align-items: center; margin-bottom: 1.5rem; font-size: .8rem; color: var(--muted); }
.filter button {
  border: 1px solid var(--line); background: var(--panel); color: var(--muted);
  padding: .25rem .6rem; border-radius: 999px; cursor: pointer; font: inherit;
}
.filter button.on { color: var(--ink); border-color: var(--muted); }
.day { margin-bottom: 2rem; }
.day.quiet { opacity: .45; }
.nothing { color: var(--muted); font-style: italic; margin: 0; }
.event {
  border-top: 1px solid var(--line);
  padding: .55rem 0;
}
.event:last-of-type { border-bottom: 1px solid var(--line); }
.event > summary {
  display: grid;
  grid-template-columns: 2.6rem 3.2rem 1fr;
  gap: .75rem;
  align-items: baseline;
  cursor: pointer;
  list-style: none;
}
.event > summary::-webkit-details-marker { display: none; }
.score { font-variant-numeric: tabular-nums; font-weight: 650; text-align: right; }
.hot .score { color: var(--hot); }
.warm .score { color: var(--warm); }
.cool .score { color: var(--cool); }
.time { color: var(--muted); font-variant-numeric: tabular-nums; font-size: .85rem; }
.what { display: flex; flex-direction: column; gap: .1rem; }
.title { }
.comp { color: var(--muted); font-size: .8rem; }
.sport {
  display: inline-block; margin-left: .45rem; padding: 0 .35rem;
  border: 1px solid var(--line); border-radius: 3px;
  font-size: .68rem; letter-spacing: .03em; color: var(--muted);
}
.why { padding: .5rem 0 .3rem 6.5rem; color: var(--muted); font-size: .82rem; }
.why p { margin: 0 0 .3rem; }
.why strong { color: var(--ink); font-weight: 600; }
.why code, .note code { background: var(--badge-bg); padding: .05rem .3rem; border-radius: 3px; font-size: .95em; }
.why a { color: inherit; }
.note { margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
.note p { color: var(--muted); font-size: .85rem; margin: 0 0 .6rem; }
.tags { display: flex; flex-wrap: wrap; gap: .3rem; }
.note pre {
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: .75rem .9rem; overflow-x: auto; font-size: .8rem; line-height: 1.5; margin: 0;
}
@media (max-width: 32rem) {
  .event > summary { grid-template-columns: 2.2rem 1fr; }
  .time { grid-column: 2; }
  .what { grid-column: 2; }
  .why { padding-left: 3rem; }
}
`;

/**
 * Reveals the filter and wires it up. The page is complete without this, which
 * is why the buttons start hidden rather than starting broken.
 */
const SCRIPT = `
(function () {
  var bar = document.querySelector('.filter');
  if (!bar) return;
  bar.hidden = false;

  var events = Array.prototype.slice.call(document.querySelectorAll('.event'));
  var ceiling = events.reduce(function (max, el) {
    return Math.max(max, Number(el.dataset.importance) || 0);
  }, 1);

  bar.addEventListener('click', function (e) {
    var button = e.target.closest('button');
    if (!button) return;

    bar.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === button); });
    var floor = Number(button.dataset.min) * ceiling;

    events.forEach(function (el) {
      el.hidden = Number(el.dataset.importance) < floor;
    });
    document.querySelectorAll('.day').forEach(function (day) {
      var shown = day.querySelectorAll('.event:not([hidden])').length;
      day.classList.toggle('quiet', shown === 0);
    });
  });
})();
`;
