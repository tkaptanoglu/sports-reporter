import { DateTime } from 'luxon';
import { HttpError, fetchJson, mapWithLimit, reportFailures } from './http.js';
import { log } from '../util/log.js';
import type { SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * ESPN's public scoreboard endpoints.
 *
 * Undocumented but stable, free, keyless, and uncapped, which makes it the
 * backbone of this program. It covers football, tennis, Formula 1 and
 * basketball properly. It has nothing at all for cycling, athletics, snooker,
 * handball or any winter sport, which is what the other two sources are for.
 *
 * Undocumented also means unsupported. Treat a shape change here as expected
 * rather than exceptional: everything below reads defensively and a league that
 * fails takes only itself down.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

/** How the events in a scoreboard are laid out. The three shapes differ a lot. */
type Layout = 'team' | 'racing' | 'tennis';

export interface League {
  sport: SportKey;
  /** Path segment pair, e.g. "soccer/eng.1". */
  path: string;
  /**
   * The rules.yaml spelling for this competition. Set deliberately rather than
   * taken from the feed, because we know exactly which league we asked for and
   * ESPN's own names do not match the table.
   */
  competition: string;
  layout: Layout;
  /** Tried when `competition` has no rule. See SportEvent.competitionFallback. */
  fallback?: string;
}

/**
 * Which leagues to ask about.
 *
 * Add a line to widen coverage. The `competition` column must match a line in
 * rules.yaml or everything from that league scores the unknown default.
 */
export const LEAGUES: League[] = [
  // --- Football
  { sport: 'football', path: 'soccer/eng.1', competition: 'Premier League', layout: 'team' },
  { sport: 'football', path: 'soccer/esp.1', competition: 'La Liga', layout: 'team' },
  { sport: 'football', path: 'soccer/ita.1', competition: 'Serie A', layout: 'team' },
  { sport: 'football', path: 'soccer/ger.1', competition: 'Bundesliga', layout: 'team' },
  { sport: 'football', path: 'soccer/fra.1', competition: 'Ligue 1', layout: 'team' },
  { sport: 'football', path: 'soccer/tur.1', competition: 'Süper Lig', layout: 'team' },
  { sport: 'football', path: 'soccer/ned.1', competition: 'Eredivisie', layout: 'team' },
  { sport: 'football', path: 'soccer/por.1', competition: 'Primeira Liga', layout: 'team' },
  { sport: 'football', path: 'soccer/eng.2', competition: 'EFL Championship', layout: 'team' },
  { sport: 'football', path: 'soccer/usa.1', competition: 'Major League Soccer', layout: 'team' },
  { sport: 'football', path: 'soccer/ksa.1', competition: 'Saudi Pro League', layout: 'team' },
  { sport: 'football', path: 'soccer/uefa.champions', competition: 'UEFA Champions League', layout: 'team' },
  { sport: 'football', path: 'soccer/uefa.europa', competition: 'UEFA Europa League', layout: 'team' },
  { sport: 'football', path: 'soccer/uefa.europa.conf', competition: 'UEFA Conference League', layout: 'team' },
  { sport: 'football', path: 'soccer/uefa.nations', competition: 'UEFA Nations League', layout: 'team' },
  { sport: 'football', path: 'soccer/fifa.world', competition: 'FIFA World Cup', layout: 'team' },
  { sport: 'football', path: 'soccer/fifa.worldq.uefa', competition: 'FIFA World Cup Qualifying', layout: 'team' },
  { sport: 'football', path: 'soccer/eng.fa', competition: 'FA Cup', layout: 'team' },
  { sport: 'football', path: 'soccer/esp.copa_del_rey', competition: 'Copa del Rey', layout: 'team' },
  { sport: 'football', path: 'soccer/ger.dfb_pokal', competition: 'DFB-Pokal', layout: 'team' },
  { sport: 'football', path: 'soccer/ita.coppa_italia', competition: 'Coppa Italia', layout: 'team' },
  // ESPN has no Turkish cup endpoint under any slug tried, and nothing below
  // the second tier, so TFF 2. Lig and 3. Lig have no source at all.
  { sport: 'football', path: 'soccer/tur.2', competition: 'TFF 1. Lig', layout: 'team' },

  // --- Basketball
  { sport: 'basketball', path: 'basketball/nba', competition: 'NBA', layout: 'team' },
  { sport: 'basketball', path: 'basketball/wnba', competition: 'WNBA', layout: 'team' },
  { sport: 'basketball', path: 'basketball/mens-college-basketball', competition: 'NCAA Tournament', layout: 'team' },

  // --- Motorsport
  { sport: 'formula1', path: 'racing/f1', competition: 'Formula 1 Grand Prix', layout: 'racing' },

  // --- Tennis. An unlisted tournament falls back to the lowest tour tier,
  //     which is closer to the truth than scoring it as an unknown.
  { sport: 'tennis', path: 'tennis/atp', competition: 'ATP', layout: 'tennis', fallback: 'ATP 250' },
  { sport: 'tennis', path: 'tennis/wta', competition: 'WTA', layout: 'tennis', fallback: 'WTA 250' },
];

// ---------------------------------------------------------------------------
// The shapes we read. Everything optional: this is an undocumented API.
// ---------------------------------------------------------------------------

interface EspnStatusType {
  state?: string;
  name?: string;
  completed?: boolean;
}

interface EspnCompetitor {
  homeAway?: string;
  team?: { displayName?: string; shortDisplayName?: string };
  athlete?: { displayName?: string; shortName?: string };
}

interface EspnCompetition {
  id?: string;
  date?: string;
  type?: { abbreviation?: string; text?: string };
  round?: { id?: string; displayName?: string };
  status?: { type?: EspnStatusType };
  notes?: Array<{ headline?: string }>;
  competitors?: EspnCompetitor[];
}

interface EspnGrouping {
  grouping?: { displayName?: string; slug?: string };
  competitions?: EspnCompetition[];
}

interface EspnEvent {
  id?: string;
  date?: string;
  endDate?: string;
  name?: string;
  shortName?: string;
  major?: boolean;
  status?: { type?: EspnStatusType };
  competitions?: EspnCompetition[];
  groupings?: EspnGrouping[];
  links?: Array<{ href?: string }>;
}

export interface EspnScoreboard {
  events?: EspnEvent[];
}

// ---------------------------------------------------------------------------
// Parsers. Kept separate from fetching so they can be tested against captured
// responses without touching the network.
// ---------------------------------------------------------------------------

/** Team sports: one event per fixture. Football, basketball, hockey. */
export function parseTeamScoreboard(body: EspnScoreboard, league: League): SportEvent[] {
  const events: SportEvent[] = [];

  for (const event of body.events ?? []) {
    const competition = event.competitions?.[0];
    const startsAt = toDate(event.date ?? competition?.date);
    if (event.id === undefined || startsAt === null) continue;
    if (isFinished(event.status?.type ?? competition?.status?.type)) continue;

    const home = competition?.competitors?.find((c) => c.homeAway === 'home');
    const away = competition?.competitors?.find((c) => c.homeAway === 'away');
    const title =
      home?.team?.displayName && away?.team?.displayName
        ? `${home.team.displayName} vs ${away.team.displayName}`
        : (event.name ?? event.shortName ?? 'Fixture');

    events.push({
      id: `espn:${event.id}`,
      sport: league.sport,
      competition: league.competition,
      competitionFallback: league.fallback ?? null,
      title,
      startsAt,
      stage: competition?.notes?.[0]?.headline ?? null,
      participants: [home, away]
        .map((c) => c?.team?.displayName)
        .filter((n): n is string => n !== undefined),
      source: 'espn',
      url: event.links?.[0]?.href ?? null,
    });
  }

  return events;
}

/**
 * Racing: one ESPN event is a whole race weekend, and the sessions inside it
 * are separate things you would choose to watch or skip. Each becomes its own
 * event so practice never outranks the race.
 */
export function parseRacingScoreboard(body: EspnScoreboard, league: League): SportEvent[] {
  const events: SportEvent[] = [];

  for (const event of body.events ?? []) {
    const weekend = event.name ?? event.shortName ?? 'Race weekend';

    for (const session of event.competitions ?? []) {
      const startsAt = toDate(session.date);
      if (session.id === undefined || startsAt === null) continue;
      if (isFinished(session.status?.type)) continue;

      const kind = sessionKind(session.type?.abbreviation ?? session.type?.text ?? '');

      events.push({
        id: `espn:${session.id}`,
        sport: league.sport,
        // The race itself keeps the weekend's own name, so a rule for
        // "Monaco Grand Prix" can match inside "Tag Heuer Monaco Grand Prix".
        competition: kind === null ? weekend : kind,
        competitionFallback: kind === null ? league.competition : null,
        title: kind === null ? weekend : `${weekend}, ${sessionLabel(kind)}`,
        startsAt,
        stage: null,
        participants: [],
        source: 'espn',
        url: event.links?.[0]?.href ?? null,
      });
    }
  }

  return events;
}

/**
 * Tennis: an ESPN event is a fortnight-long tournament holding hundreds of
 * matches. Listing every first-round match would bury the report, so this emits
 * one event per tournament per day, labelled with the furthest round being
 * played that day. That is the unit a viewer actually chooses.
 */
export function parseTennisScoreboard(
  body: EspnScoreboard,
  league: League,
  request: FetchRequest,
): SportEvent[] {
  const events: SportEvent[] = [];

  for (const tournament of body.events ?? []) {
    if (tournament.id === undefined) continue;
    const start = toDate(tournament.date);
    const end = toDate(tournament.endDate) ?? start;
    if (start === null || end === null) continue;

    const roundsByDay = roundsPerDay(tournament, request.timezone);

    for (const day of daysBetween(
      new Date(Math.max(start.getTime(), request.from.getTime())),
      new Date(Math.min(end.getTime(), request.to.getTime() - 1)),
      request.timezone,
    )) {
      const round = roundsByDay.get(day.key) ?? null;
      const name = tournament.name ?? 'Tournament';

      events.push({
        id: `espn:${tournament.id}:${day.key}`,
        sport: league.sport,
        competition: name,
        // Slams are all in the rules table by name. Anything else drops to the
        // bottom tour tier rather than scoring as a complete unknown.
        competitionFallback: tournament.major === true ? null : (league.fallback ?? null),
        title: round === null ? name : `${name}, ${round}`,
        startsAt: day.start,
        stage: round,
        participants: [],
        source: 'espn',
        url: tournament.links?.[0]?.href ?? null,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// The source itself
// ---------------------------------------------------------------------------

export const espnScoreboard: EventSource = {
  name: 'espn',
  sports: [...new Set(LEAGUES.map((l) => l.sport))],

  async fetchEvents(request: FetchRequest): Promise<SportEvent[]> {
    const wanted = new Set(request.sports);
    const leagues = LEAGUES.filter((l) => wanted.has(l.sport));
    if (leagues.length === 0) return [];

    const range = `${yyyymmdd(request.from, request.timezone)}-${yyyymmdd(new Date(request.to.getTime() - 1), request.timezone)}`;

    const results = await mapWithLimit(leagues, 6, async (league) => {
      const url = `${BASE}/${league.path}/scoreboard?dates=${range}&limit=300`;

      let body: EspnScoreboard;
      try {
        body = await fetchJson<EspnScoreboard>(url);
      } catch (error) {
        // A league out of season answers 404 for a date range it has nothing
        // in. That is an empty week, not a broken feed, and warning about it
        // every summer would train you to ignore the warnings that matter.
        if (error instanceof HttpError && error.status === 404) return [];
        throw error;
      }

      switch (league.layout) {
        case 'team':
          return parseTeamScoreboard(body, league);
        case 'racing':
          return parseRacingScoreboard(body, league);
        case 'tennis':
          return parseTennisScoreboard(body, league, request);
      }
    });

    reportFailures('espn', results);

    const events = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    log.info(`espn: ${events.length} events from ${leagues.length} leagues.`);
    return events;
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ESPN dates come as "2026-09-13T13:00Z", which Date parses correctly. */
function toDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Something already played is not something to watch.
 *
 * State alone is not enough. A race weekend reports a completed qualifying
 * session as state "in" with the name STATUS_SESSION_COMPLETE, because the
 * weekend as a whole is still in progress. Filtering on state would offer you
 * a session that finished yesterday.
 */
function isFinished(status: EspnStatusType | undefined): boolean {
  if (status === undefined) return false;
  if (status.completed === true || status.state === 'post') return true;
  return /COMPLETE|FINAL/i.test(status.name ?? '');
}

function yyyymmdd(when: Date, timezone: string): string {
  return DateTime.fromJSDate(when).setZone(timezone).toFormat('yyyyMMdd');
}

/** Maps ESPN's session abbreviations onto rules.yaml competition names. */
function sessionKind(abbreviation: string): string | null {
  const a = abbreviation.toLowerCase();
  if (a.startsWith('fp') || a.includes('practice')) return 'Formula 1 Practice';
  if (a.includes('sprint')) return 'Formula 1 Sprint';
  if (a.startsWith('qual')) return 'Formula 1 Qualifying';
  return null; // the race itself
}

function sessionLabel(kind: string): string {
  return kind.replace(/^Formula 1 /, '');
}

/** The furthest-advanced round being played on each day of a tennis draw. */
function roundsPerDay(tournament: EspnEvent, timezone: string): Map<string, string> {
  const best = new Map<string, { rank: number; name: string }>();

  for (const grouping of tournament.groupings ?? []) {
    for (const match of grouping.competitions ?? []) {
      const when = toDate(match.date);
      const name = match.round?.displayName;
      if (when === null || name === undefined) continue;

      const key = DateTime.fromJSDate(when).setZone(timezone).toFormat('yyyy-MM-dd');
      const rank = Number(match.round?.id ?? 0);
      const current = best.get(key);
      if (current === undefined || rank > current.rank) best.set(key, { rank, name });
    }
  }

  return new Map([...best].map(([key, value]) => [key, value.name]));
}

/** Local midnights from `from` to `to` inclusive. */
function daysBetween(
  from: Date,
  to: Date,
  timezone: string,
): Array<{ key: string; start: Date }> {
  const days: Array<{ key: string; start: Date }> = [];
  let cursor = DateTime.fromJSDate(from).setZone(timezone).startOf('day');
  const last = DateTime.fromJSDate(to).setZone(timezone).startOf('day');

  while (cursor <= last && days.length < 60) {
    days.push({ key: cursor.toFormat('yyyy-MM-dd'), start: cursor.toJSDate() });
    cursor = cursor.plus({ days: 1 });
  }

  return days;
}
