import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';
import { sourceCovers } from './types.js';

import { theSportsDb } from './thesportsdb.js';
import { espnScoreboard } from './espn.js';
import { calendarFeeds } from './calendars.js';
import { fisSkiJumping } from './fis.js';
import { snookerOrg } from './snooker.js';

/**
 * Every source the program knows about.
 *
 * They are deliberately not allowed to overlap. ESPN owns football, tennis,
 * basketball and Formula 1; TheSportsDB owns the sports ESPN has nothing for;
 * calendars own whatever you point them at. Snooker and ski jumping each have
 * a dedicated source because the general ones either miss them entirely or omit
 * the only detail that matters. Two sources describing the same
 * fixture would survive deduplication, because they would arrive under
 * different ids, and you would read the same match twice.
 */
export const sources: EventSource[] = [
  espnScoreboard,
  theSportsDb,
  snookerOrg,
  fisSkiJumping,
  calendarFeeds,
];

/**
 * Asks every relevant source in parallel and merges the results.
 *
 * A source that throws is logged and skipped. Losing one feed should cost you
 * some events, never the whole run.
 *
 * `from` defaults to the real registry and exists so tests can supply their own
 * sources without reaching into module state.
 */
export async function collectEvents(
  request: FetchRequest,
  from: EventSource[] = sources,
): Promise<SportEvent[]> {
  const relevant = from.filter((source) => sourceCovers(source, request.sports));

  if (relevant.length === 0) {
    log.warn('No source covers any of your sports.');
    return [];
  }

  const settled = await Promise.allSettled(
    relevant.map(async (source) => ({ source, events: await source.fetchEvents(request) })),
  );

  const collected: SportEvent[] = [];

  for (const [index, result] of settled.entries()) {
    const source = relevant[index];
    if (source === undefined) continue;

    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      log.error(
        `Source "${source.name}" failed: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      continue;
    }

    log.info(`Source "${source.name}" returned ${result.value.events.length} events.`);
    collected.push(...result.value.events);
  }

  return dedupe(withinWindow(collected, request));
}

/** Drops anything a source returned outside the requested range or sports. */
function withinWindow(events: SportEvent[], request: FetchRequest): SportEvent[] {
  const wanted = new Set(request.sports);
  return events.filter(
    (event) =>
      wanted.has(event.sport) &&
      event.startsAt >= request.from &&
      event.startsAt < request.to,
  );
}

/**
 * Collapses the same fixture reported by more than one source.
 *
 * Currently keyed on the event id, which only catches exact duplicates from the
 * same source. Real deduplication needs fuzzy matching on sport, participants
 * and kickoff time, because two feeds will spell the same match differently.
 */
function dedupe(events: SportEvent[]): SportEvent[] {
  const seen = new Map<string, SportEvent>();
  for (const event of events) {
    if (!seen.has(event.id)) seen.set(event.id, event);
  }
  return [...seen.values()];
}
