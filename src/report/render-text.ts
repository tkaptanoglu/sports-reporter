import { localTimeFor } from '../util/days.js';
import type { Report } from './types.js';

/**
 * Plain-text report for the terminal.
 *
 * Kept simple deliberately. This is the renderer that has to keep working, so
 * the run is never wasted even when the prettier one breaks.
 */
export function renderText(report: Report): string {
  const out: string[] = [];

  out.push('');
  out.push('  WHAT TO WATCH');
  out.push(`  Next ${report.days.length} days, times in ${report.timezone}`);
  out.push('');

  for (const day of report.days) {
    out.push(`  ${day.label}`);
    out.push(`  ${'-'.repeat(day.label.length)}`);

    if (day.events.length === 0) {
      out.push('    nothing');
    } else {
      for (const event of day.events) {
        const time = localTimeFor(event.startsAt, report.timezone);
        const score = String(event.importance).padStart(3);
        out.push(`    ${score}  ${time}  ${event.title}`);
        out.push(`         ${event.competition}`);
      }
    }
    out.push('');
  }

  if (report.emptySports.length > 0) {
    // Naming a single cause here would be a guess. Out of season is the usual
    // one, but a throttled or failed source looks identical from down here, and
    // three sports have no source at all. The log above says which happened.
    out.push('  Nothing found for these sports. Out of season, no source for them,');
    out.push('  or a source failed. The log above will say which:');
    out.push(`    ${report.emptySports.join(', ')}`);
    out.push('');
  }

  if (report.unrated.length > 0) {
    out.push('  These competitions are not in rules.yaml and scored the default.');
    out.push('  Add a line for any that matter to you:');
    for (const item of report.unrated) {
      out.push(`    ${item.sport}: ${item.competition}  (${item.count} events)`);
    }
    out.push('');
  }

  return out.join('\n');
}
