import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DateTime } from 'luxon';
import { parse as parseYaml } from 'yaml';
import { mapWithLimit, reportFailures } from './http.js';
import { log } from '../util/log.js';
import type { Division, SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * Calendar feeds, in iCalendar format.
 *
 * This exists for the sports the big aggregators ignore. Neither ESPN nor
 * TheSportsDB carries ski jumping, alpine skiing or curling in any form, and I
 * could not find a machine-readable calendar published by FIS, World Curling or
 * the EHF either: their schedule pages are rendered HTML with no feed behind
 * them. So the machinery here is real and tested, and it ships with no feeds.
 *
 * Point it at any .ics URL and it works. Create config/calendars.yaml:
 *
 *     feeds:
 *       - sport: alpine-skiing
 *         competition: FIS Alpine Ski World Cup
 *         url: https://example.org/whatever.ics
 *
 * `competition` should match a line in rules.yaml. Leave it out and each event
 * uses its own summary line instead, which will usually land in the unrated
 * list until you add a rule for it.
 *
 * Scraping those federation pages instead was the alternative. It was rejected:
 * a scraper for three sports that each run for four months would break every
 * close season and quietly report nothing.
 */

const CONFIG_FILE = 'calendars.yaml';

export interface CalendarFeed {
  sport: SportKey;
  url: string;
  /** rules.yaml spelling. Falls back to each event's own summary when absent. */
  competition?: string;
  /** Tried when `competition` has no rule. */
  fallback?: string;
  /** Set it when the feed covers only one side of the sport. */
  division?: Division;
}

interface CalendarsConfig {
  feeds?: CalendarFeed[];
}

/** Reads the optional feed list. Returns nothing at all when it is absent. */
export function loadFeeds(dir = 'config'): CalendarFeed[] {
  const path = join(dir, CONFIG_FILE);
  if (!existsSync(path)) return [];

  const parsed = parseYaml(readFileSync(path, 'utf8')) as CalendarsConfig | null;
  return (parsed?.feeds ?? []).filter((feed) => typeof feed.url === 'string' && feed.url.length > 0);
}

// ---------------------------------------------------------------------------
// iCalendar parsing
// ---------------------------------------------------------------------------

export interface IcsEvent {
  uid: string | null;
  summary: string | null;
  location: string | null;
  start: Date | null;
  /** True for an all-day entry, which carries a date but no clock time. */
  allDay: boolean;
}

/**
 * Parses the VEVENTs out of an iCalendar document.
 *
 * Deliberately small. It reads the five fields this program needs and ignores
 * recurrence, alarms, attendees and timezone definition blocks, because a
 * fixture list uses none of them.
 */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = { uid: null, summary: null, location: null, start: null, allDay: false };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current as IcsEvent);
      current = null;
      continue;
    }
    if (current === null) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;

    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name = '', ...params] = rawName.split(';');

    switch (name.toUpperCase()) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeText(value);
        break;
      case 'LOCATION':
        current.location = unescapeText(value);
        break;
      case 'DTSTART': {
        const parsed = parseIcsDate(value, params);
        current.start = parsed.date;
        current.allDay = parsed.allDay;
        break;
      }
      default:
        break;
    }
  }

  return events;
}

/**
 * iCalendar dates come in three flavours and getting them wrong shifts an event
 * by a whole day: a floating local time, an explicit zone via TZID, or UTC with
 * a trailing Z. An all-day entry is a bare date.
 */
export function parseIcsDate(
  value: string,
  params: string[] = [],
): { date: Date | null; allDay: boolean } {
  const tzid = params.find((p) => p.toUpperCase().startsWith('TZID='))?.slice(5);
  const isDateOnly =
    params.some((p) => p.toUpperCase() === 'VALUE=DATE') || /^\d{8}$/.test(value);

  if (isDateOnly) {
    const parsed = DateTime.fromFormat(value.slice(0, 8), 'yyyyMMdd', {
      zone: tzid ?? 'UTC',
    });
    // Midday keeps an all-day entry on its own calendar day in any zone the
    // reader might be in, rather than sliding into the day before.
    return { date: parsed.isValid ? parsed.plus({ hours: 12 }).toJSDate() : null, allDay: true };
  }

  const utc = value.endsWith('Z');
  const stamp = utc ? value.slice(0, -1) : value;
  const parsed = DateTime.fromFormat(stamp, "yyyyMMdd'T'HHmmss", {
    zone: utc ? 'UTC' : (tzid ?? 'UTC'),
  });

  return { date: parsed.isValid ? parsed.toJSDate() : null, allDay: false };
}

/** Turns ICS events into ours, dropping anything without a usable start. */
export function toSportEvents(events: IcsEvent[], feed: CalendarFeed): SportEvent[] {
  const out: SportEvent[] = [];

  for (const [index, event] of events.entries()) {
    if (event.start === null) continue;
    const summary = event.summary ?? 'Event';

    out.push({
      id: `calendar:${feed.sport}:${event.uid ?? `${feed.url}#${index}`}`,
      sport: feed.sport,
      competition: feed.competition ?? summary,
      competitionFallback: feed.fallback ?? (feed.competition === undefined ? null : summary),
      title: summary,
      startsAt: event.start,
      stage: null,
      division: feed.division ?? null,
      participants: [],
      source: 'calendar',
      url: feed.url,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// The source itself
// ---------------------------------------------------------------------------

export const calendarFeeds: EventSource = {
  name: 'calendar',
  sports: 'all',

  async fetchEvents(request: FetchRequest): Promise<SportEvent[]> {
    const wanted = new Set(request.sports);
    const feeds = loadFeeds().filter((feed) => wanted.has(feed.sport));

    if (feeds.length === 0) {
      const uncovered = ['alpine-skiing', 'curling'].filter((s) => wanted.has(s));
      if (uncovered.length > 0) {
        log.warn(
          `calendar: no feeds configured, so ${uncovered.join(', ')} will report nothing. ` +
            `No federation publishes a machine-readable calendar for these. ` +
            `Add config/calendars.yaml if you find one.`,
        );
      }
      return [];
    }

    const results = await mapWithLimit(feeds, 4, async (feed) => {
      const response = await fetch(feed.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${feed.url}`);
      return toSportEvents(parseIcs(await response.text()), feed);
    });

    reportFailures('calendar', results);

    const events = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    log.info(`calendar: ${events.length} events from ${feeds.length} feeds.`);
    return events;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * iCalendar wraps long lines at 75 octets and marks the continuation with a
 * leading space or tab. Unwrapping has to happen before anything else, or a
 * wrapped SUMMARY arrives truncated.
 */
function unfold(text: string): string[] {
  const lines: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }

  return lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}
