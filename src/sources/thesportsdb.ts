import { DateTime } from 'luxon';
import { fetchJson, mapWithLimit, reportFailures } from './http.js';
import { log } from '../util/log.js';
import type { SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * TheSportsDB, a community sports database with a documented JSON API.
 *
 * Used strictly to fill the gaps the other sources leave: cycling, athletics,
 * MotoGP, volleyball and handball. Snooker moved to its own source, which names
 * the players. It deliberately does not cover football,
 * tennis, basketball or Formula 1, because ESPN does those better and two
 * sources describing the same fixture would produce two entries, not one.
 *
 * THE FREE KEY IS SEVERELY LIMITED. The public test key returns at most three
 * events per query and rate limits after a few dozen requests, so an ordinary
 * run reports a handful of events per sport rather than all of them. Set
 * THESPORTSDB_KEY in the environment to use your own key and lift both limits.
 * That limit is theirs, not a bug here, and the log says so on every run.
 */

const TEST_KEY = '3';
const BASE = 'https://www.thesportsdb.com/api/v1/json';

export interface Coverage {
  sport: SportKey;
  /** Their name for the sport, used as the `s` query parameter. */
  theirSport: string;
  /**
   * Query these league ids directly instead of sweeping the whole sport day by
   * day.
   *
   * Worth it whenever one series is buried inside a sport that holds many. A
   * day of "Motorsport" returns three events under the free key, and on a
   * normal weekend those three are DTM, NASCAR and a rally, with the MotoGP
   * race nowhere in them. Asking for the league by id returns only that league,
   * in one request rather than seven.
   */
  leagues?: string[];
  /** Keeps only leagues matching this, for sports they lump together. */
  leagueFilter?: RegExp;
  /** Tried when the league name itself has no rule. */
  fallback?: string;
}

/**
 * The gap sports, and how to ask for each.
 *
 * Ski jumping, alpine skiing and curling are absent on purpose. TheSportsDB
 * returns nothing for them on any date tried, in or out of season.
 */
export const COVERAGE: Coverage[] = [
  { sport: 'cycling', theirSport: 'Cycling', fallback: 'UCI World Tour' },
  { sport: 'athletics', theirSport: 'Athletics', fallback: 'World Athletics Continental Tour' },
  { sport: 'volleyball', theirSport: 'Volleyball' },
  { sport: 'handball', theirSport: 'Handball' },
  // 4407 is MotoGP. Add the Moto2 and Moto3 ids here if you want the support
  // races too; the filter below keeps anything else out either way.
  {
    sport: 'motogp',
    theirSport: 'Motorsport',
    leagues: ['4407'],
    leagueFilter: /moto\s?(gp|2|3)/i,
    fallback: 'MotoGP Grand Prix',
  },
];

interface SportsDbEvent {
  idEvent?: string;
  strEvent?: string;
  strLeague?: string;
  strSport?: string;
  /** UTC, without a zone marker. "2026-09-13T02:00:00". */
  strTimestamp?: string | null;
  dateEvent?: string | null;
  strTime?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  strGroup?: string | null;
  intRound?: string | null;
}

export interface SportsDbDay {
  events?: SportsDbEvent[] | null;
}

/**
 * Converts one day of their events into ours.
 *
 * Because we ask for a whole sport rather than a named league, the competition
 * here is whatever they call it, unmapped. Anything the rules table does not
 * recognise surfaces in the unrated list at the foot of the report, which is
 * exactly how that table is meant to grow.
 */
export function parseDay(body: SportsDbDay, coverage: Coverage): SportEvent[] {
  const events: SportEvent[] = [];

  for (const raw of body.events ?? []) {
    const league = raw.strLeague ?? '';
    if (raw.idEvent === undefined) continue;
    if (coverage.leagueFilter && !coverage.leagueFilter.test(league)) continue;

    const startsAt = toDate(raw);
    if (startsAt === null) continue;

    const participants = [raw.strHomeTeam, raw.strAwayTeam].filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    );

    events.push({
      id: `thesportsdb:${raw.idEvent}`,
      sport: coverage.sport,
      competition: league,
      competitionFallback: coverage.fallback ?? null,
      title: raw.strEvent ?? participants.join(' vs ') ?? 'Event',
      startsAt,
      stage: cleanStage(raw.strGroup),
      // A whole-day feed across every league knows nothing about divisions, so
      // the competition name is the only signal and it is read later.
      division: null,
      participants,
      source: 'thesportsdb',
      url: null,
    });
  }

  return events;
}

export const theSportsDb: EventSource = {
  name: 'thesportsdb',
  sports: COVERAGE.map((c) => c.sport),

  async fetchEvents(request: FetchRequest): Promise<SportEvent[]> {
    const wanted = new Set(request.sports);
    const coverages = COVERAGE.filter((c) => wanted.has(c.sport));
    if (coverages.length === 0) return [];

    const key = process.env['THESPORTSDB_KEY'] ?? TEST_KEY;
    if (key === TEST_KEY) {
      log.warn(
        'thesportsdb: using the public test key, which returns at most 3 events per query. ' +
          'Set THESPORTSDB_KEY for full results.',
      );
    }

    // A sport naming its leagues is asked about those and nothing else. Every
    // other sport is swept day by day. Kept to two requests at a time because
    // the free tier answers with HTML error pages well before it answers 429.
    interface Job {
      coverage: Coverage;
      /** Exactly one of these is set. */
      date?: string;
      league?: string;
    }

    const jobs: Job[] = coverages.flatMap((coverage) =>
      coverage.leagues === undefined
        ? datesIn(request).map((date): Job => ({ coverage, date }))
        : coverage.leagues.map((league): Job => ({ coverage, league })),
    );

    const results = await mapWithLimit(jobs, 2, async ({ coverage, date, league }) => {
      const url =
        league === undefined
          ? `${BASE}/${key}/eventsday.php?d=${date ?? ''}&s=${encodeURIComponent(coverage.theirSport)}`
          : `${BASE}/${key}/eventsnextleague.php?id=${league}`;
      return parseDay(await fetchJson<SportsDbDay>(url), coverage);
    });

    reportFailures('thesportsdb', results);

    const events = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    log.info(`thesportsdb: ${events.length} events from ${jobs.length} queries.`);
    return events;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Their timestamps are UTC but carry no zone marker, so they must be told so
 * explicitly. Reading one as local time would shift every event by hours.
 */
function toDate(raw: SportsDbEvent): Date | null {
  if (typeof raw.strTimestamp === 'string' && raw.strTimestamp.length > 0) {
    const parsed = new Date(`${raw.strTimestamp}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // Some records carry only a date, usually multi-day events such as a stage
  // race. Midday UTC keeps them on the right calendar day either side of it.
  if (typeof raw.dateEvent === 'string' && raw.dateEvent.length > 0) {
    const time = typeof raw.strTime === 'string' && raw.strTime.length > 0 ? raw.strTime : '12:00:00';
    const parsed = new Date(`${raw.dateEvent}T${time}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

/** They use an empty string rather than null for "no stage". */
function cleanStage(group: string | null | undefined): string | null {
  const trimmed = group?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Every yyyy-MM-dd in the request window, in the reader's zone. */
function datesIn(request: FetchRequest): string[] {
  const dates: string[] = [];
  let cursor = DateTime.fromJSDate(request.from).setZone(request.timezone).startOf('day');
  const last = DateTime.fromJSDate(new Date(request.to.getTime() - 1))
    .setZone(request.timezone)
    .startOf('day');

  while (cursor <= last && dates.length < 31) {
    dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }

  return dates;
}
