import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * Governing-body RSS and calendar feeds, one per sport.
 *
 * This is where the sports the big aggregators neglect come from. FIS publishes
 * an alpine and ski jumping calendar, World Curling publishes a schedule, and
 * the EHF publishes handball fixtures. Each is small and each is different, so
 * expect a per-feed adapter rather than one clever parser.
 *
 * Deliberately kept separate from the JSON API sources. When a federation
 * redesigns its site in the summer, only this file should need attention.
 *
 * To implement:
 *   - a feed table: sport key, url, and which adapter parses it
 *   - fetch and parse, tolerating a dead feed without failing the source
 *   - ICS where a federation publishes a calendar, which is friendlier than RSS
 */
export const rssFixtures: EventSource = {
  name: 'rss',
  sports: 'all',

  async fetchEvents(_request: FetchRequest): Promise<SportEvent[]> {
    log.todo('rss: not implemented, returning no events.');
    return [];
  },
};
