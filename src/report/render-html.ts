import { notImplemented } from '../util/todo.js';
import type { Report } from './types.js';

/**
 * The report you actually read: a self-contained HTML file you open in a
 * browser.
 *
 * Self-contained matters. No CDN, no external stylesheet, no fonts fetched at
 * open time, so the file still renders in a year and works offline.
 *
 * To implement:
 *   - one section per day, events in importance order
 *   - show the score breakdown on hover or behind a details element, because
 *     seeing why something scored 63 is what makes rules.yaml tunable
 *   - mark today, and dim days with nothing on
 *   - the unrated list at the foot, formatted so lines paste into rules.yaml
 *   - inline everything, and respect prefers-color-scheme
 */
export function renderHtml(_report: Report): string {
  return notImplemented('HTML report rendering');
}

/**
 * Writes the HTML report and returns the path written.
 *
 * Should write into reports/ with a dated filename so old reports survive, and
 * reports/ is already in .gitignore.
 */
export function writeHtmlReport(_report: Report, _outDir = 'reports'): string {
  return notImplemented('writing the HTML report to disk');
}
