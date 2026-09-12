import { DateTime } from 'luxon';
import type { Settings } from '../config/types.js';

/**
 * Turning "the next 7 days" into concrete boundaries is fiddly enough to
 * deserve its own file. A 22:45 kickoff belongs to a different calendar day
 * depending on where you are standing, and the whole report hangs on that.
 */

export interface ReportDay {
  /** yyyy-MM-dd in the reader's zone. Use this as the grouping key. */
  key: string;
  /** Human label, e.g. "Saturday 13 September". */
  label: string;
  /** Local midnight at the start of this day, as an absolute instant. */
  start: Date;
  /** Local midnight at the start of the next day. Exclusive. */
  end: Date;
}

export interface ReportWindow {
  timezone: string;
  /** Inclusive. Local midnight at the start of today. */
  from: Date;
  /** Exclusive. Local midnight after the final reported day. */
  to: Date;
  days: ReportDay[];
}

/**
 * Builds the day boundaries the whole report is grouped by.
 *
 * `now` is injectable so this can be tested without waiting for tomorrow.
 */
export function buildWindow(settings: Settings, now: DateTime = DateTime.now()): ReportWindow {
  if (settings.days_ahead < 1) {
    throw new Error(`days_ahead must be at least 1, got ${settings.days_ahead}.`);
  }

  const zoned = now.setZone(settings.timezone);
  if (!zoned.isValid) {
    throw new Error(
      `Unknown timezone "${settings.timezone}" in interests.yaml. ` +
        `Use an IANA name such as Europe/Istanbul or America/New_York.`,
    );
  }

  const firstDay = zoned.startOf('day');
  const days: ReportDay[] = [];

  for (let i = 0; i < settings.days_ahead; i += 1) {
    const start = firstDay.plus({ days: i });
    const end = start.plus({ days: 1 });
    days.push({
      key: start.toFormat('yyyy-MM-dd'),
      label: start.toFormat('cccc d LLLL'),
      start: start.toJSDate(),
      end: end.toJSDate(),
    });
  }

  const lastDay = days[days.length - 1];
  if (lastDay === undefined) {
    throw new Error('Produced an empty window, which should be impossible.');
  }

  return {
    timezone: settings.timezone,
    from: firstDay.toJSDate(),
    to: lastDay.end,
    days,
  };
}

/** Which local calendar day an absolute instant falls on. */
export function dayKeyFor(when: Date, timezone: string): string {
  return DateTime.fromJSDate(when).setZone(timezone).toFormat('yyyy-MM-dd');
}

/** Local clock time for an event, e.g. "20:45". */
export function localTimeFor(when: Date, timezone: string): string {
  return DateTime.fromJSDate(when).setZone(timezone).toFormat('HH:mm');
}
