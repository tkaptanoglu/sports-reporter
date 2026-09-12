import { DateTime } from 'luxon';
import { fetchText } from './http.js';
import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * The FIS season calendar for ski jumping.
 *
 * This is a scraper, which everything else in this program deliberately is not.
 * It exists because ski jumping has no alternative: no aggregator carries it,
 * and FIS publishes its calendar as rendered HTML with no feed behind it. The
 * choice was a parser or nothing.
 *
 * Flashscore was the other candidate and was rejected. Its terms forbid
 * automated access and it is built to detect and block exactly this, so a
 * scraper pointed at it would be both against the rules and short-lived.
 *
 * Treat a break here as expected rather than exceptional. One request per run,
 * failing on its own without touching any other sport.
 *
 * WHAT IT CAN AND CANNOT GIVE YOU
 *   The calendar lists a venue and a date range per stop on the tour, so this
 *   emits one event per day of each weekend. It does not carry individual
 *   competition start times, so there are no clock times for ski jumping.
 */

const CALENDAR = 'https://www.fis-ski.com/DB/ski-jumping/calendar-results.html';

/**
 * FIS category codes, mapped onto the rules.yaml spellings.
 *
 * A code with no entry here still produces events; they just score the unknown
 * default and surface in the report's unrated list, ready for you to rate.
 */
const CATEGORIES: Record<string, string> = {
  WC: 'FIS Ski Jumping World Cup',
  COC: 'FIS Ski Jumping Continental Cup',
  GP: 'FIS Ski Jumping Grand Prix',
  WSC: 'FIS Nordic World Ski Championships',
  SFWC: 'Ski Flying World Championships',
  WSFH: 'Ski Flying World Championships',
  OWG: 'Olympic Ski Jumping',
  FC: 'FIS Ski Jumping Cup',
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface CalendarRow {
  eventId: string;
  place: string;
  /** FIS category code, e.g. "WC". */
  category: string;
  /** Inclusive, as local calendar dates. */
  from: DateTime;
  to: DateTime;
}

/**
 * Pulls the calendar rows out of the page.
 *
 * Reads the visible text of each row rather than hunting for class names,
 * because FIS restyles the site far more often than it changes what a row says.
 * A row reads: a date or date range, the venue, then the category code.
 */
export function parseCalendar(html: string, season: number): CalendarRow[] {
  const rows: CalendarRow[] = [];

  for (const block of html.split(/(?=<div\b[^>]*\bclass="[^"]*\btable-row\b)/i).slice(1)) {
    const head = block.slice(0, block.indexOf('>') + 1);

    // The row opens with the whole date range in attributes. Reading those
    // beats parsing the printed date, which is localised and abbreviated.
    const eventId = head.match(/\bid="(\d+)"/)?.[1];
    const startDay = Number(head.match(/data-navstart="(\d+)"/)?.[1]);
    const endDay = Number(head.match(/data-navend="(\d+)"/)?.[1]);
    const navMonth = Number(head.match(/data-navmonth="(\d+)"/)?.[1]);
    if (eventId === undefined) continue;

    const tokens = block
      .split(/<[^>]+>/)
      .map((t) => t.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 0);

    let range: { from: DateTime; to: DateTime } | null = null;

    if (Number.isFinite(startDay) && Number.isFinite(endDay) && Number.isFinite(navMonth)) {
      // A winter season straddles new year: months from July belong to the
      // opening year, the rest to the closing one.
      const year = navMonth >= 7 ? season - 1 : season;
      const from = DateTime.fromObject({ year, month: navMonth, day: startDay }, { zone: 'UTC' });
      const to = DateTime.fromObject({ year, month: navMonth, day: endDay }, { zone: 'UTC' });
      // A stop running across a month boundary reports the later day as
      // smaller, e.g. 30 to 2. Roll the end into the following month.
      if (from.isValid && to.isValid) {
        range = { from, to: to < from ? to.plus({ months: 1 }) : to };
      }
    }

    // Fall back to the printed date if the attributes ever disappear.
    if (range === null) {
      const printed = tokens.find((t) => DATE_RANGE.test(t));
      range = printed === undefined ? null : parseDateRange(printed);
    }
    if (range === null) continue;

    // A row in progress carries a "live" badge and repeats its own date, which
    // would otherwise be read as the venue. Start from the last date and drop
    // the noise before picking anything out.
    const lastDate = tokens.map((t) => DATE_RANGE.test(t)).lastIndexOf(true);
    const after = (lastDate === -1 ? tokens : tokens.slice(lastDate + 1)).filter(
      (t) => t.length > 1 && t.toLowerCase() !== 'live' && !DATE_RANGE.test(t),
    );

    const place = after[0] ?? '';
    const category = after.slice(1, 6).find((t) => /^[A-Z]{2,6}\b/.test(t)) ?? '';

    rows.push({
      eventId,
      place,
      category: (category.split('•')[0] ?? '').trim(),
      from: range.from,
      to: range.to,
    });
  }

  return rows;
}

// "20-22 Nov 2026", "3 Jan 2027", "30 Dec 2026 - 3 Jan 2027"
const DATE_RANGE = /^\d{1,2}(\s*-\s*\d{1,2})?\s+[A-Za-z]{3}/;

/** Reads a FIS date cell into a pair of calendar dates. */
export function parseDateRange(text: string): { from: DateTime; to: DateTime } | null {
  const clean = text.replace(/‑/g, '-').replace(/\s+/g, ' ').trim();

  // Both halves carry a month: "30 Dec 2026 - 3 Jan 2027" or "30 Dec - 3 Jan 2027".
  const across = clean.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\w*\s*(\d{4})?\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/,
  );
  if (across) {
    const [, d1, m1, y1, d2, m2, y2] = across;
    const to = date(d2, m2, y2);
    const from = date(d1, m1, y1 ?? String(Number(y2) - (month(m1) > month(m2) ? 1 : 0)));
    return from && to ? { from, to } : null;
  }

  // One month for both: "20-22 Nov 2026" or a single day "3 Jan 2027".
  const within = clean.match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+([A-Za-z]{3})\w*\s+(\d{4})$/);
  if (within) {
    const [, d1, d2, m, y] = within;
    const from = date(d1, m, y);
    const to = date(d2 ?? d1, m, y);
    return from && to ? { from, to } : null;
  }

  return null;
}

/** Turns the rows into one event per day of each weekend inside the window. */
export function toSportEvents(rows: CalendarRow[], request: FetchRequest): SportEvent[] {
  const events: SportEvent[] = [];

  for (const row of rows) {
    const competition = CATEGORIES[row.category.toUpperCase()] ?? row.category;

    for (let day = row.from; day <= row.to; day = day.plus({ days: 1 })) {
      // No start times are published here, so midday stands in. It keeps the
      // event on its own calendar day and sorts it sensibly against fixtures
      // that do carry a time.
      const startsAt = day.setZone(request.timezone, { keepLocalTime: true }).plus({ hours: 12 });
      if (startsAt.toJSDate() < request.from || startsAt.toJSDate() >= request.to) continue;

      events.push({
        id: `fis:${row.eventId}:${day.toFormat('yyyy-MM-dd')}`,
        sport: 'ski-jumping',
        competition,
        // No fallback on purpose. An unmapped code is some minor summer or
        // regional meeting, and defaulting it to the World Cup would put a
        // FESA Cup jump above a Champions League tie. Left unmatched, it scores
        // the unknown default and appears in the report's unrated list, where
        // you can give it a real number.
        competitionFallback: null,
        title: `${row.place}${row.category ? `, ${row.category}` : ''}`,
        startsAt: startsAt.toJSDate(),
        stage: null,
        division: null,
        participants: [],
        source: 'fis',
        url: `https://www.fis-ski.com/DB/general/event-details.html?sectorcode=JP&eventid=${row.eventId}`,
      });
    }
  }

  return events;
}

export const fisSkiJumping: EventSource = {
  name: 'fis',
  sports: ['ski-jumping'],

  async fetchEvents(request: FetchRequest): Promise<SportEvent[]> {
    if (!request.sports.includes('ski-jumping')) return [];

    const season = seasonCode(request.from);
    const html = await fetchText(`${CALENDAR}?sectorcode=JP&seasoncode=${season}`);
    const rows = parseCalendar(html, Number(season));

    if (rows.length === 0) {
      log.warn('fis: the calendar page parsed to nothing. The site has probably changed shape.');
      return [];
    }

    const events = toSportEvents(rows, request);
    log.info(`fis: ${events.length} events from ${rows.length} calendar rows, season ${season}.`);
    return events;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A winter season is named for the year it ends in. 2026/27 is season 2027. */
export function seasonCode(when: Date): string {
  const d = DateTime.fromJSDate(when).setZone('UTC');
  return String(d.month >= 7 ? d.year + 1 : d.year);
}

function month(name: string | undefined): number {
  return MONTHS[(name ?? '').slice(0, 3).toLowerCase()] ?? 0;
}

function date(d: string | undefined, m: string | undefined, y: string | undefined): DateTime | null {
  const parsed = DateTime.fromObject(
    { year: Number(y), month: month(m), day: Number(d) },
    { zone: 'UTC' },
  );
  return parsed.isValid ? parsed : null;
}
