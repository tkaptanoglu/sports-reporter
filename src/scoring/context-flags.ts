import type { ContextFlag } from '../config/types.js';
import type { SportEvent } from '../model/event.js';

/**
 * Works out which context flags an event genuinely earns.
 *
 * The contract matters more than the implementation: this returns a flag only
 * when it can prove it from the data. It must never guess. A wrongly applied
 * title-decider flag pushes a meaningless fixture to the top of your Saturday,
 * and you would have no way of knowing why.
 *
 * Right now it can prove nothing, so it returns nothing, and every event is
 * scored on base and stage alone. That is the correct behaviour for a stub, not
 * a gap to paper over.
 *
 * Roughly in order of how cheap they are to add:
 *   - exhibition and youth-or-reserve: usually readable from the event title
 *   - derby: needs a rivalry list in config, probably a third YAML file
 *   - dead-rubber: needs series state, so only for best-of-N formats
 *   - relegation-decider and title-decider: need league standings plus the
 *     fixtures left, which means a standings source and real arithmetic
 */
export function detectContextFlags(_event: SportEvent): ContextFlag[] {
  return [];
}
