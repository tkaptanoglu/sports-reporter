import { log } from '../util/log.js';
import type { SportEvent } from '../model/event.js';
import type { EventSource, FetchRequest } from './types.js';

/**
 * ESPN's public scoreboard JSON endpoints.
 *
 * Undocumented but stable and widely used, and noticeably richer than
 * TheSportsDB on stage and round information, which is exactly what the stage
 * layer of the rules table needs.
 *
 * Undocumented means unsupported: treat a shape change here as expected rather
 * than exceptional, and fail this source without failing the run.
 *
 * To implement:
 *   - map our sport keys onto their sport and league path segments
 *   - request one scoreboard per league per day in the window
 *   - read competitions[0].status and the season type into SportEvent.stage
 *   - build ids as "espn:<their event id>"
 */
export const espnScoreboard: EventSource = {
  name: 'espn',
  sports: 'all',

  async fetchEvents(_request: FetchRequest): Promise<SportEvent[]> {
    log.todo('espn: not implemented, returning no events.');
    return [];
  },
};
