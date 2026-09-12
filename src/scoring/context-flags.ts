import { divisionOf } from './division.js';
import { detectStandingsFlags } from './standings-flags.js';
import { containsWords, normalise } from './text.js';
import type { ContextConfig, ContextFlag, Favourite, LoadedConfig, SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';
import type { Tables } from '../standings/types.js';

/**
 * Works out which context flags an event genuinely earns.
 *
 * The contract has not changed: a flag is raised only when it can be proved.
 * What has changed is that two of them now can be, because context.yaml
 * supplies the knowledge no sports API carries. A rivalry is a matter of
 * history, and which stage settles a grand tour is a matter of the calendar.
 * Neither arrives in a feed, so both are lists a person maintains.
 *
 * League position now arrives too, from a standings source, which is what lets
 * first against second read differently from fourteenth against fifteenth. The
 * one flag still absent is the dead rubber: proving nothing is at stake needs
 * per-team arithmetic over every fixture left, not just a table.
 */

/**
 * Deciders that need no configuration, because the feed says so outright.
 * Matched against the same text as the configured rules.
 */
const GENERIC_DECIDERS = [
  'final stage',
  'last stage',
  'season finale',
  'title decider',
  'championship decider',
];

export function detectContextFlags(
  event: SportEvent,
  config: LoadedConfig,
  tables: Tables = new Map(),
): ContextFlag[] {
  const { context, interests } = config;
  const flags = new Set<ContextFlag>();

  if (isDerby(event, context.rivalries?.[event.sport] ?? [])) flags.add('derby');
  if (isDecider(event, context.deciders?.[event.sport] ?? [])) flags.add('title-decider');
  if (isDecisiveQualifying(event, context.decisive_qualifying?.[event.sport] ?? [])) {
    flags.add('decisive-qualifying');
  }
  if (involvesFavourite(event, interests.favourites)) flags.add('favourite');

  const prefer = interests.sports[event.sport]?.prefer;
  if (prefer !== undefined && divisionOf(event) === prefer) flags.add('preferred-division');

  // A set, because a title decider can be reached two ways: from the calendar
  // via context.yaml, and from the table via the standings. Either is enough
  // and both together must not count twice.
  for (const flag of detectStandingsFlags(event, tables.get(event.competition))) {
    flags.add(flag);
  }

  return [...flags];
}

/**
 * Whether one of your favourites is involved.
 *
 * Matched against the named participants and the title together, because an
 * individual sport may give you two players and a team sport two clubs, and a
 * scraped source sometimes gives only a title. A favourite pinned to a sport is
 * ignored everywhere else, which is what lets one club name mean the football
 * side in football and nothing at all in volleyball.
 */
export function involvesFavourite(event: SportEvent, favourites: Favourite[]): boolean {
  const text = [...event.participants, event.title].map(normalise).join(' | ');

  return favourites.some((favourite) => {
    if (favourite.sport !== undefined && favourite.sport !== event.sport) return false;
    // A favourite pinned to a division must be on that side of the sport. This
    // is what separates a national women's team from the men's team of the same
    // name, which every feed calls simply by the country.
    if (favourite.division !== undefined && divisionOf(event) !== favourite.division) return false;
    return containsWords(text, normalise(favourite.name));
  });
}

/**
 * Whether both halves of a listed rivalry appear in this fixture.
 *
 * Matched against the participants and the title together rather than against
 * one side each. Some sources give two named teams and some give only a title
 * reading "Galatasaray vs Fenerbahce", and requiring both names to be present
 * somewhere works for both without having to guess where one team's name ends
 * and the other's begins.
 */
export function isDerby(event: SportEvent, rivalries: string[][]): boolean {
  const text = [...event.participants, event.title].map(normalise).join(' | ');

  return rivalries.some((pair) => {
    const [left, right] = pair;
    if (left === undefined || right === undefined) return false;
    return containsWords(text, normalise(left)) && containsWords(text, normalise(right));
  });
}

/**
 * Whether this is the event a competition is settled on.
 *
 * Every phrase in a rule must appear. The competition, title and stage are
 * searched as one string because feeds scatter the pieces across all three:
 * the Vuelta arrives under the league "UCI World Tour" with the race and its
 * stage number only in the title.
 */
export function isDecider(event: SportEvent, deciders: string[][]): boolean {
  if (GENERIC_DECIDERS.some((phrase) => containsWords(searchText(event), phrase))) return true;
  return matchesAnyRule(event, deciders);
}

/**
 * Whether this is a qualifying session that largely settles the race after it.
 *
 * "Qualifying" means two unrelated things. In tennis and snooker it is a
 * separate tournament for players outside the top of the rankings, and it is
 * penalised as a weaker field in those sports' stage tables. In Formula 1 it is
 * the same field on the same weekend, fighting for grid position against the
 * same title rivals. At a circuit where passing is close to impossible, that
 * session decides most of what happens on Sunday.
 *
 * Which circuits qualify is a judgement about the track, not something any feed
 * reports, so it is a list in context.yaml rather than a rule in code.
 */
export function isDecisiveQualifying(event: SportEvent, rules: string[][]): boolean {
  return matchesAnyRule(event, rules);
}

/**
 * Whether every phrase of at least one rule appears in the event.
 *
 * The competition, title and stage are searched as one string, because feeds
 * scatter the pieces: a qualifying session arrives as competition "Formula 1
 * Qualifying" with the circuit only in the title.
 */
function matchesAnyRule(event: SportEvent, rules: string[][]): boolean {
  const text = searchText(event);
  return rules.some(
    (phrases) =>
      phrases.length > 0 && phrases.every((phrase) => containsWords(text, normalise(phrase))),
  );
}

function searchText(event: SportEvent): string {
  return [event.competition, event.title, event.stage ?? ''].map(normalise).join(' | ');
}

/** Rivalries listed for a sport, for callers that want to inspect the list. */
export function rivalriesFor(context: ContextConfig, sport: SportKey): string[][] {
  return context.rivalries?.[sport] ?? [];
}
