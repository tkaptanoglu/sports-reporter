import type { SportKey } from '../config/types.js';
import type { SportEvent } from '../model/event.js';

/** What the collector asks every source for. */
export interface FetchRequest {
  /** Only these sports are wanted. Anything else should not be returned. */
  sports: SportKey[];
  /** Inclusive lower bound, as an absolute instant. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** The reader's zone, for sources that only accept local dates. */
  timezone: string;
}

/**
 * A place events come from.
 *
 * Keep the interface this narrow on purpose. A source is allowed to be a JSON
 * API, an RSS feed or a scraped page, and the rest of the program must not be
 * able to tell which. When a scraped site changes its markup, only one file
 * should need touching.
 */
export interface EventSource {
  /** Short identifier, used in event ids and log lines. */
  readonly name: string;
  /** Which sports this source can speak to, or 'all'. */
  readonly sports: SportKey[] | 'all';
  /**
   * Should resolve rather than reject where it reasonably can. The collector
   * tolerates a source failing, but one flaky feed should not cost you the
   * whole report.
   */
  fetchEvents(request: FetchRequest): Promise<SportEvent[]>;
}

/** Whether a source is worth asking about a given set of sports. */
export function sourceCovers(source: EventSource, sports: SportKey[]): boolean {
  if (source.sports === 'all') return true;
  const covered = new Set(source.sports);
  return sports.some((sport) => covered.has(sport));
}
