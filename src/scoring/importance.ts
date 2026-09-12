import { scoreSignificance } from './significance.js';
import type { LoadedConfig } from '../config/types.js';
import type { ScoredEvent, SportEvent } from '../model/event.js';

/**
 * Attaches both ratings to an event.
 *
 *     importance = your interest in the sport * the event's significance in it
 *
 * Multiplication, not addition, on purpose. It means a sport you rated 1 can
 * never crowd out a sport you rated 9, no matter how big its final is, which is
 * the behaviour you asked for.
 */
export function scoreEvent(event: SportEvent, config: LoadedConfig): ScoredEvent {
  const preference = config.interests.sports[event.sport];

  if (preference === undefined) {
    throw new Error(
      `Event ${event.id} is in "${event.sport}", which is not in interests.yaml. ` +
        `Out-of-scope sports should have been filtered out before scoring.`,
    );
  }

  const { significance, breakdown } = scoreSignificance(event, config.rules);

  return {
    ...event,
    significance,
    interest: preference.interest,
    importance: preference.interest * significance,
    breakdown,
  };
}
