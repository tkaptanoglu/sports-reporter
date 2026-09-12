import { containsWords, normalise } from './text.js';
import type { ContextConfig, ContextFlag, Favourite, LoadedConfig, SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';

/**
 * Works out which context flags an event genuinely earns.
 *
 * The contract has not changed: a flag is raised only when it can be proved.
 * What has changed is that two of them now can be, because context.yaml
 * supplies the knowledge no sports API carries. A rivalry is a matter of
 * history, and which stage settles a grand tour is a matter of the calendar.
 * Neither arrives in a feed, so both are lists a person maintains.
 *
 * The flags still absent all need league standings and the fixtures left to
 * play: title races in progress, relegation six-pointers, dead rubbers. Those
 * need a standings source and real arithmetic, not a list.
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

export function detectContextFlags(event: SportEvent, config: LoadedConfig): ContextFlag[] {
  const { context, interests } = config;
  const flags: ContextFlag[] = [];

  if (isDerby(event, context.rivalries?.[event.sport] ?? [])) flags.push('derby');
  if (isDecider(event, context.deciders?.[event.sport] ?? [])) flags.push('title-decider');
  if (involvesFavourite(event, interests.favourites)) flags.push('favourite');

  return flags;
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
  const text = [event.competition, event.title, event.stage ?? ''].map(normalise).join(' | ');

  if (GENERIC_DECIDERS.some((phrase) => containsWords(text, phrase))) return true;

  return deciders.some(
    (phrases) =>
      phrases.length > 0 && phrases.every((phrase) => containsWords(text, normalise(phrase))),
  );
}

/** Rivalries listed for a sport, for callers that want to inspect the list. */
export function rivalriesFor(context: ContextConfig, sport: SportKey): string[][] {
  return context.rivalries?.[sport] ?? [];
}
