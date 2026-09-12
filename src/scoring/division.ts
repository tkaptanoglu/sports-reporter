import { containsWords, normalise } from './text.js';
import type { Division, SportInterest } from '../config/types.js';
import type { SportEvent } from '../model/event.js';

/**
 * Deciding whether an event is on the side of a sport you actually follow.
 *
 * Most sports run two parallel calendars and most people do not follow both
 * equally. This keeps that preference out of the scoring entirely: an event you
 * do not want is removed before anything rates it, rather than rated and then
 * buried.
 */

/**
 * Words that mark a competition as one division or the other, after
 * normalisation. Several languages, because feeds are not all English.
 *
 * Women's markers are checked first. It should not matter, since matching is on
 * whole words and "womens" is not the word "men", but the cost of being wrong
 * here is inverting someone's entire preference, so the order is explicit.
 */
const MARKERS: Array<{ division: Division; words: string[] }> = [
  {
    division: 'women',
    words: [
      'women', 'womens', 'ladies', 'female', 'girls',
      'wta', 'damen', 'dames', 'femminile', 'femenina', 'feminina', 'feminine',
      'kadinlar', 'kadin',
    ],
  },
  {
    division: 'men',
    words: [
      'men', 'mens', 'male', 'boys',
      'atp', 'herren', 'heren', 'maschile', 'masculina', 'masculin',
      'erkekler', 'erkek',
    ],
  },
];

// Deliberately absent: bare initials, and the singulars "man" and "woman".
// Normalisation turns "Man City" into the word "man", which would file every
// Manchester derby as a men's fixture by accident. The possessive forms are
// already covered, since "Women's" normalises to the word "women".

/**
 * Which division an event belongs to, or null when nothing says.
 *
 * A source that knows for certain is always believed over the text. Only when
 * it has nothing to offer do we read the competition name and title, and a name
 * that gives no clue yields null rather than a guess.
 */
export function divisionOf(event: SportEvent): Division | null {
  if (event.division !== null) return event.division;

  const haystack = `${normalise(event.competition)} ${normalise(event.title)}`;

  for (const { division, words } of MARKERS) {
    if (words.some((word) => containsWords(haystack, word))) return division;
  }

  return null;
}

/**
 * Whether an event survives the preference set for its sport.
 *
 * With no `only` set, everything survives. With one set, an event must either
 * be marked as that division or be named in `also`. An unmarked competition is
 * dropped, because a competition that does not say it is women's usually is
 * not, and quietly including it would defeat the point of asking.
 */
export function wanted(event: SportEvent, preference: SportInterest): boolean {
  if (preference.only === undefined) return true;

  const division = divisionOf(event);
  if (division !== null) return division === preference.only;

  return (preference.also ?? []).some((name) =>
    containsWords(normalise(event.competition), normalise(name)),
  );
}

/** Why an event was dropped, so the run can say so instead of losing it silently. */
export type DropReason = 'wrong-division' | 'no-division-stated';

export interface Sifted {
  kept: SportEvent[];
  dropped: Array<{ event: SportEvent; reason: DropReason }>;
}

/** Splits events into the ones you asked for and the ones you did not. */
export function siftByDivision(
  events: SportEvent[],
  preferences: Record<string, SportInterest>,
): Sifted {
  const kept: SportEvent[] = [];
  const dropped: Sifted['dropped'] = [];

  for (const event of events) {
    const preference = preferences[event.sport];
    if (preference === undefined || wanted(event, preference)) {
      kept.push(event);
      continue;
    }

    dropped.push({
      event,
      reason: divisionOf(event) === null ? 'no-division-stated' : 'wrong-division',
    });
  }

  return { kept, dropped };
}
