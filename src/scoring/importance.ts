import { divisionOf } from './division.js';
import { scoreSignificance } from './significance.js';
import type { Division, LoadedConfig, SportInterest } from '../config/types.js';
import type { ScoredEvent, SportEvent } from '../model/event.js';
import type { Tables } from '../standings/types.js';

/**
 * Attaches both ratings to an event.
 *
 *     importance = your interest in the sport * the event's significance in it
 *
 * Multiplication, not addition, on purpose. It means a sport you rated 1 can
 * never crowd out a sport you rated 9, no matter how big its final is, which is
 * the behaviour you asked for.
 */
export function scoreEvent(
  event: SportEvent,
  config: LoadedConfig,
  tables: Tables = new Map(),
): ScoredEvent {
  const preference = config.interests.sports[event.sport];

  if (preference === undefined) {
    throw new Error(
      `Event ${event.id} is in "${event.sport}", which is not in interests.yaml. ` +
        `Out-of-scope sports should have been filtered out before scoring.`,
    );
  }

  const { significance, breakdown } = scoreSignificance(event, config, tables);
  const { interest, interestDivision } = interestFor(event, preference);

  return {
    ...event,
    significance,
    interest,
    interestDivision,
    importance: interest * significance,
    breakdown,
  };
}

/**
 * Your interest in this particular event.
 *
 * Usually just the sport's rating. Where interests.yaml gives one side of the
 * sport its own rating and the event is known to be on that side, that rating
 * is used instead. An event whose division cannot be told keeps the ordinary
 * rating rather than being guessed into either.
 */
export function interestFor(
  event: SportEvent,
  preference: SportInterest,
): { interest: number; interestDivision: Division | null } {
  const division = divisionOf(event);
  const override = division === null ? undefined : preference.interest_by_division?.[division];

  return override === undefined
    ? { interest: preference.interest, interestDivision: null }
    : { interest: override, interestDivision: division };
}
