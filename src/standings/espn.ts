import { fetchJson, mapWithLimit, reportFailures } from '../sources/http.js';
import { LEAGUES } from '../sources/espn.js';
import { log } from '../util/log.js';
import type { LeagueTable, Tables, TeamRow } from './types.js';

/**
 * League tables from ESPN, for the competitions it serves as leagues.
 *
 * Fetched once per run and only for competitions that actually appear in this
 * week's fixtures, so a quiet week costs almost nothing. Knockout competitions
 * and individual sports have no table and are simply never asked about.
 */

const BASE = 'https://site.api.espn.com/apis/v2/sports';

interface EspnStat {
  name?: string;
  value?: number;
}

interface EspnEntry {
  team?: { displayName?: string; shortDisplayName?: string };
  stats?: EspnStat[];
}

export interface EspnStandings {
  standings?: { entries?: EspnEntry[] };
  children?: Array<{ standings?: { entries?: EspnEntry[] } }>;
}

/**
 * Turns one standings response into a table.
 *
 * Season length is derived from the size of the table rather than read from the
 * feed, which does not carry it. A league of N teams playing each other home
 * and away runs 2(N-1) rounds. That holds for every league here and is only an
 * approximation for formats that differ, which is why progress only ever gates
 * a flag rather than setting a score itself.
 */
export function parseStandings(body: EspnStandings, competition: string): LeagueTable | null {
  const entries = body.standings?.entries ?? body.children?.[0]?.standings?.entries ?? [];
  if (entries.length === 0) return null;

  const rows: TeamRow[] = [];

  for (const entry of entries) {
    const team = entry.team?.displayName;
    if (team === undefined) continue;

    const stat = (name: string): number | undefined =>
      entry.stats?.find((s) => s.name === name)?.value;

    rows.push({
      team,
      rank: stat('rank') ?? rows.length + 1,
      played: stat('gamesPlayed') ?? 0,
      points: stat('points') ?? 0,
    });
  }

  if (rows.length === 0) return null;
  rows.sort((a, b) => a.rank - b.rank);

  const rounds = Math.max(1, 2 * (rows.length - 1));
  const played = Math.max(...rows.map((r) => r.played));

  return { competition, rows, progress: Math.min(1, played / rounds) };
}

/**
 * Fetches tables for whichever of these competitions ESPN has one for.
 *
 * A competition with no table, which is every cup and every individual sport,
 * simply does not appear in the result. Callers treat a missing table as "no
 * idea", which is the correct answer rather than a failure.
 */
export async function fetchTables(competitions: string[]): Promise<Tables> {
  const wanted = new Set(competitions);
  const leagues = LEAGUES.filter((l) => l.layout === 'team' && wanted.has(l.competition));

  if (leagues.length === 0) return new Map();

  const results = await mapWithLimit(leagues, 5, async (league) => {
    const body = await fetchJson<EspnStandings>(`${BASE}/${league.path}/standings`);
    return parseStandings(body, league.competition);
  });

  reportFailures('standings', results);

  const tables: Tables = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled' || result.value === null) continue;
    tables.set(result.value.competition, result.value);
  }

  log.info(`standings: ${tables.size} league tables for ${leagues.length} competitions.`);
  return tables;
}
