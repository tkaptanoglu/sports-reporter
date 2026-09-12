import { loadConfig, unmatchedSportKeys } from './config/load.js';
import { buildReport } from './report/build.js';
import { renderText } from './report/render-text.js';
import { collectEvents } from './sources/registry.js';
import { scoreEvent } from './scoring/importance.js';
import { buildWindow } from './util/days.js';
import { log } from './util/log.js';

/**
 * The whole program, in the order it happens.
 *
 * Every step below is a single call into one module, and that is the point.
 * The pipeline should stay readable at a glance even when each stage grows.
 */
async function main(): Promise<void> {
  // 1. Read what you care about and how events are scored.
  const config = loadConfig();

  // 2. Refuse to silently skip a sport you asked for.
  const unmatched = unmatchedSportKeys(config);
  for (const key of unmatched) {
    log.warn(`"${key}" is in interests.yaml but has no entry in rules.yaml, so it is skipped.`);
  }

  const sports = Object.keys(config.interests.sports).filter((key) => !unmatched.includes(key));
  if (sports.length === 0) {
    throw new Error('No usable sports in interests.yaml. Nothing to report on.');
  }

  // 3. Work out which days we are reporting, in your timezone.
  const reportWindow = buildWindow(config.interests.settings);
  log.info(
    `Scanning ${sports.length} sports across ${reportWindow.days.length} days, ` +
      `times in ${reportWindow.timezone}.`,
  );

  // 4. Ask every source for fixtures in that range.
  const events = await collectEvents({
    sports,
    from: reportWindow.from,
    to: reportWindow.to,
    timezone: reportWindow.timezone,
  });
  log.info(`Collected ${events.length} events after deduplication.`);

  // 5. Rate each one, and rank by what it is worth to you.
  const scored = events.map((event) => scoreEvent(event, config));

  // 6. Arrange into days and print.
  const report = buildReport(scored, reportWindow, sports);
  console.log(renderText(report));

  // TODO: also write the HTML report once render-html.ts is implemented.
}

main().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
