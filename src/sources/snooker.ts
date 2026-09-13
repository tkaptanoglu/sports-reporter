import { DateTime } from 'luxon';
import { fetchText, mapWithLimit, reportFailures } from './http.js';
import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * snooker.org, the sport's long-running results database.
 *
 * The reason for a second snooker source is that the aggregators give you
 * "BetVictor English Open Final" and nothing else. Who is playing is the whole
 * question in an individual sport, and this site has it.
 *
 * The published draw only ever runs a round or two ahead, so most of a
 * tournament arrives as a tournament rather than as named matches. Where the
 * draw is out, you get the players. Where it is not, you get one event per day
 * of the tournament, which is the same compromise the tennis reader makes.
 *
 * A scraper, like the FIS one, and for the same reason: the site's own API
 * refuses this client outright. Its markup has barely moved in twenty years,
 * which is the best guarantee available here.
 */

const BASE = 'https://www.snooker.org/res/index.asp';

export interface Tournament {
  id: string;
  name: string;
  /**
   * Whether this is a qualifying tournament, decided from every label the site
   * uses for it rather than from whichever one happened to come first.
   */
  qualifying: boolean;
  from: DateTime;
  to: DateTime;
}

export interface DrawMatch {
  /** Round heading this match sat under, e.g. "Semifinals". */
  round: string | null;
  players: [string, string];
  startsAt: Date;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Reads the tournament list off the index page.
 *
 * Each link carries the event id, and its text carries the name and dates,
 * as "English Open (7-13 Sep)" or "Masters (10-17 Jan 2027)". A missing year
 * means the season's opening year.
 */
export function parseIndex(html: string, defaultYear: number): Tournament[] {
  // The same tournament is often linked more than once under different labels.
  // A running qualifier appears near the top as "Northern Ireland Open (q)" and
  // again in the season calendar as "Northern Ireland Open Qual". Every label is
  // gathered first, so no single one gets to decide what the tournament is.
  const labels = new Map<string, Array<{ name: string; dates: string }>>();

  for (const match of html.matchAll(/index\.asp\?event=(\d+)[^>]*>([^<]{3,90})<\/a>/g)) {
    const [, id, label] = match;
    if (id === undefined || label === undefined) continue;

    const text = decode(label);
    const dates = text.match(/\(([^)]+)\)\s*$/)?.[1];
    const name = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (dates === undefined || name.length === 0) continue;

    const list = labels.get(id) ?? [];
    list.push({ name, dates });
    labels.set(id, list);
  }

  const tournaments: Tournament[] = [];

  for (const [id, found] of labels) {
    // Which label came first depends only on which section of the page it sits
    // in, and a tournament moves between sections as it starts. If any label
    // says qualifier, it is one.
    const qualifying = found.some((label) => isQualifying(label.name));

    // Show the most descriptive name: for a qualifier, the label that spells it
    // out, so the report never shows a shorthand the reader has to decode.
    // Otherwise any label that is not the shorthand. Dates come from a label
    // that carries a year where one does.
    const named =
      found.find((label) => isQualifying(label.name) && !SHORTHAND.test(label.name)) ??
      found.find((label) => !SHORTHAND.test(label.name)) ??
      found[0];
    const dated = found.find((label) => /\d{4}/.test(label.dates)) ?? named;
    if (named === undefined || dated === undefined) continue;

    const range = parseDates(dated.dates, defaultYear);
    if (range === null) continue;

    tournaments.push({ id, name: named.name, qualifying, ...range });
  }

  return tournaments;
}

/** The site's shorthand for a qualifying event, as in "Northern Ireland Open (q)". */
const SHORTHAND = /\(q\)/i;

/** "7-13 Sep", "31 Oct - 7 Nov 2026", "10-17 Jan 2027". */
export function parseDates(
  text: string,
  defaultYear: number,
): { from: DateTime; to: DateTime } | null {
  const clean = decode(text).replace(/\s+/g, ' ').trim();

  const across = clean.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\w*\s*(\d{4})?\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\w*\s*(\d{4})?$/,
  );
  if (across) {
    const [, d1, m1, y1, d2, m2, y2] = across;
    const endYear = Number(y2 ?? defaultYear);
    const to = date(d2, m2, endYear);
    const from = date(d1, m1, Number(y1 ?? (monthOf(m1) > monthOf(m2) ? endYear - 1 : endYear)));
    return from && to ? { from, to } : null;
  }

  const within = clean.match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s+([A-Za-z]{3})\w*\s*(\d{4})?$/);
  if (within) {
    const [, d1, d2, m, y] = within;
    const year = Number(y ?? defaultYear);
    const from = date(d1, m, year);
    const to = date(d2 ?? d1, m, year);
    return from && to ? { from, to } : null;
  }

  return null;
}

/**
 * Reads the scheduled matches out of a draw page.
 *
 * A match still to be played shows "v" between the players and carries one or
 * more session times; a finished one shows the score and no time. Round names
 * arrive as single-cell heading rows above the matches they cover.
 */
export function parseDraw(html: string): DrawMatch[] {
  const table = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .split(/<table\b[^>]*class="[^"]*\bmatches\b[^"]*"[^>]*>/i)[1];
  if (table === undefined) return [];

  const matches: DrawMatch[] = [];
  let round: string | null = null;

  for (const row of table.split(/<tr\b/i).slice(1)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      decode(m[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length === 0) continue;

    // A lone cell is a round heading: "Semifinals (Losers receive ...)".
    if (cells.length === 1 && cells[0] !== undefined && cells[0].length > 0) {
      round = cells[0].replace(/\s*\(.*$/, '').trim() || null;
      continue;
    }

    // "v" in the middle means not yet played. A score there means it is over.
    if (!cells.includes('v')) continue;

    const named = cells.filter((c) => /[A-Za-z]{2,}/.test(c) && c !== 'v');
    const [one, two] = named;
    const when = firstTimestamp(cells[cells.length - 1] ?? '');
    if (one === undefined || two === undefined || when === null) continue;

    matches.push({ round, players: [stripSeed(one), stripSeed(two)], startsAt: when });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export const snookerOrg: EventSource = {
  name: 'snooker',
  sports: ['snooker'],

  async fetchEvents(request: FetchRequest): Promise<SportEvent[]> {
    if (!request.sports.includes('snooker')) return [];

    const index = await fetchText(BASE);
    const year = DateTime.fromJSDate(request.from).year;
    const running = parseIndex(index, year).filter(
      (t) =>
        t.to.endOf('day').toJSDate() >= request.from && t.from.toJSDate() < request.to,
    );

    if (running.length === 0) {
      log.info('snooker: nothing on the calendar this week.');
      return [];
    }

    const results = await mapWithLimit(running, 3, async (tournament) => {
      const draw = parseDraw(await fetchText(`${BASE}?event=${tournament.id}`));
      return draw.length > 0
        ? fromMatches(draw, tournament, request)
        : fromTournamentDays(tournament, request);
    });

    reportFailures('snooker', results);

    const events = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const named = events.filter((e) => e.participants.length > 0).length;
    log.info(
      `snooker: ${events.length} events from ${running.length} tournaments, ` +
        `${named} with the players named.`,
    );
    return events;
  },
};

/**
 * Whether this whole tournament is a qualifying event.
 *
 * The tour runs separate qualifying tournaments, named "Northern Ireland Open
 * Qual" and the like. Every match in one is a qualifier, however far through
 * its own draw it is, and the draw's own round headings never say so. Without
 * this, a qualifying final scored exactly like a ranking final.
 */
export function isQualifying(name: string): boolean {
  // The spelled-out forms and the site's own shorthand. The shorthand is what a
  // qualifier is called once it is under way, which is exactly when it matters.
  return /\bqual(s|if\w*)?\b/i.test(name) || SHORTHAND.test(name);
}

/**
 * Marks the stage so the scorer sees a qualifier as a qualifier.
 *
 * The round is kept after the word, not replaced by it, so the breakdown still
 * says which round. The stage matcher tries qualifying before any round
 * pattern, so the prefix is what wins.
 */
export function stageOf(tournament: Tournament, round: string | null): string | null {
  if (!tournament.qualifying) return round;
  return round === null ? 'Qualifying' : `Qualifying ${round}`;
}

/** One event per scheduled match, players and all. */
function fromMatches(
  matches: DrawMatch[],
  tournament: Tournament,
  request: FetchRequest,
): SportEvent[] {
  return matches
    .filter((m) => m.startsAt >= request.from && m.startsAt < request.to)
    .map((m, index) => ({
      id: `snooker:${tournament.id}:${m.startsAt.getTime()}:${index}`,
      sport: 'snooker',
      competition: tournament.name,
      competitionFallback: 'Ranking Event',
      title: `${m.players[0]} vs ${m.players[1]}`,
      startsAt: m.startsAt,
      stage: stageOf(tournament, m.round),
      division: null,
      participants: [...m.players],
      source: 'snooker',
      url: `${BASE}?event=${tournament.id}`,
    }));
}

/**
 * One event per day, for a tournament whose draw is not out yet.
 *
 * Most of a week's snooker lands here. A draw is published a round or two
 * ahead, so the later rounds are real fixtures with no known players.
 */
function fromTournamentDays(tournament: Tournament, request: FetchRequest): SportEvent[] {
  const events: SportEvent[] = [];

  for (let day = tournament.from; day <= tournament.to; day = day.plus({ days: 1 })) {
    const startsAt = day.setZone(request.timezone, { keepLocalTime: true }).plus({ hours: 13 });
    if (startsAt.toJSDate() < request.from || startsAt.toJSDate() >= request.to) continue;

    events.push({
      id: `snooker:${tournament.id}:${day.toFormat('yyyy-MM-dd')}`,
      sport: 'snooker',
      competition: tournament.name,
      competitionFallback: 'Ranking Event',
      title: tournament.name,
      startsAt: startsAt.toJSDate(),
      stage: stageOf(tournament, null),
      division: null,
      participants: [],
      source: 'snooker',
      url: `${BASE}?event=${tournament.id}`,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Seedings are noise in a fixture list: "Ali Carter [21]" is Ali Carter. */
function stripSeed(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
}

/** A session cell may list two start times. The first is when play begins. */
function firstTimestamp(cell: string): Date | null {
  const stamp = cell.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)Z?/);
  if (stamp === null) return null;

  const [, day, time] = stamp;
  if (day === undefined || time === undefined) return null;

  const parsed = new Date(`${day}T${time}${time.length === 5 ? ':00' : ''}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/‑/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&#8209;/g, '-')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&pound;/g, '£');
}

function monthOf(name: string | undefined): number {
  return MONTHS[(name ?? '').slice(0, 3).toLowerCase()] ?? 0;
}

function date(d: string | undefined, m: string | undefined, y: number): DateTime | null {
  const parsed = DateTime.fromObject(
    { year: y, month: monthOf(m), day: Number(d) },
    { zone: 'UTC' },
  );
  return parsed.isValid ? parsed : null;
}
