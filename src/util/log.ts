/**
 * Deliberately tiny. This program runs once by hand and writes to a terminal,
 * so a logging framework would be more machinery than the job needs.
 */

const stamp = (): string => new Date().toISOString().slice(11, 19);

export const log = {
  info: (msg: string): void => console.log(`[${stamp()}]       ${msg}`),
  warn: (msg: string): void => console.warn(`[${stamp()}] WARN  ${msg}`),
  error: (msg: string): void => console.error(`[${stamp()}] ERROR ${msg}`),
  /** Marks a code path that is still a stub, so an empty run explains itself. */
  todo: (msg: string): void => console.warn(`[${stamp()}] TODO  ${msg}`),
};
