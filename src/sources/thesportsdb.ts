import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * TheSportsDB, a free JSON schedule API with broad sport coverage.
 *
 * Intended as the backbone: it is an official API with a documented shape, so
 * it will not break the way a scraped page does. Expected to cover football,
 * basketball, ice hockey, American football and motorsport well, and the winter
 * sports poorly.
 *
 * To implement:
 *   - map our sport keys onto their league ids, in a lookup table in this file
 *   - page through eventsnextleague for each league in scope
 *   - convert their local date and time fields into an absolute instant
 *   - read their round or stage field into SportEvent.stage untouched
 */
export const theSportsDb: EventSource = {
  name: 'thesportsdb',
  sports: 'all',

  async fetchEvents(_request: FetchRequest): Promise<SportEvent[]> {
    log.todo('thesportsdb: not implemented, returning no events.');
    return [];
  },
};
