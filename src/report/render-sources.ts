import { dayKeyFor } from '../util/days.js';
import type { SportEvent } from '../model/event.js';

/**
 * What the sources found, before any scoring.
 *
 * Stands in for the real report while the scorer is still a stub, and stays
 * useful afterwards: the competition names listed here are exactly the strings
 * the rules table has to match, so this is the fastest way to see which rules
 * are missing.
 */
export function renderSourceSummary(events: SportEvent[], timezone: string): string {
  const out: string[] = [];

  out.push('');
  out.push(`  WHAT THE SOURCES FOUND     ${events.length} events, times in ${timezone}`);
  out.push('');

  if (events.length === 0) {
    out.push('  Nothing at all. Either everything is out of season or every source failed.');
    out.push('');
    return out.join('\n');
  }

  const bySport = new Map<string, SportEvent[]>();
  for (const event of events) {
    const list = bySport.get(event.sport);
    if (list === undefined) bySport.set(event.sport, [event]);
    else list.push(event);
  }

  const sorted = [...bySport].sort((a, b) => b[1].length - a[1].length);

  for (const [sport, inSport] of sorted) {
    out.push(`  ${sport}  (${inSport.length})`);

    const byCompetition = new Map<string, SportEvent[]>();
    for (const event of inSport) {
      const list = byCompetition.get(event.competition);
      if (list === undefined) byCompetition.set(event.competition, [event]);
      else list.push(event);
    }

    for (const [competition, inCompetition] of [...byCompetition].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      out.push(`    ${String(inCompetition.length).padStart(3)}  ${competition}`);

      const soonest = [...inCompetition].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      )[0];
      if (soonest) {
        out.push(`         e.g. ${dayKeyFor(soonest.startsAt, timezone)}  ${soonest.title}`);
      }
    }
    out.push('');
  }

  return out.join('\n');
}
