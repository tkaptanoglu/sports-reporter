import { log } from '../util/log.js';

/**
 * The small amount of HTTP manners every source needs.
 *
 * Not a library wrapper. Just a timeout, a couple of retries, an honest user
 * agent, and a way to stop firing fifty requests at a free API at once.
 */

const USER_AGENT =
  'sports-reporter/0.1 (personal weekly fixture digest; https://github.com/tkaptanoglu/sports-reporter)';

export interface FetchOptions {
  /** Abandon a single attempt after this long. */
  timeoutMs?: number;
  /** Extra attempts after the first. Only retries timeouts and 5xx. */
  retries?: number;
}

/** Thrown when a request fails in a way the caller may want to distinguish. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * GETs JSON, retrying only the failures that are worth retrying.
 *
 * A 404 means the league does not exist and will still not exist in two
 * seconds, so it fails immediately. A timeout or a 503 gets another go.
 */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(400 * attempt);

    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        const error = new HttpError(`HTTP ${response.status} from ${url}`, response.status, url);
        if (!retryable) throw error;
        lastError = error;
        continue;
      }

      // A rate-limited free API may answer 200 with an HTML error page, which
      // would otherwise surface as a baffling JSON parse error.
      const text = await response.text();
      if (text.trimStart().startsWith('<')) {
        throw new HttpError(`${url} returned HTML, not JSON. Usually rate limiting.`, 200, url);
      }

      return JSON.parse(text) as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status !== null && error.status < 500) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new HttpError(`Failed to fetch ${url}`, null, url);
}

/**
 * GETs a page as text, with the same retry manners as fetchJson.
 *
 * For the sources that have no API behind them. A federation calendar rendered
 * as HTML is still a published schedule; it just costs a parser.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(500 * attempt);

    try {
      const response = await fetch(url, {
        // A plain browser user agent. These pages are served to people, and a
        // few of them refuse anything that does not look like one.
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });

      if (!response.ok) {
        const error = new HttpError(`HTTP ${response.status} from ${url}`, response.status, url);
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
        continue;
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status !== null && error.status < 500) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError(`Failed to fetch ${url}`, null, url);
}

/**
 * Runs an async job over every item, never more than `limit` at a time.
 *
 * Free APIs are the whole reason this exists. Firing one request per league per
 * day in parallel is a good way to be rate limited into uselessness.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;

      try {
        results[index] = { status: 'fulfilled', value: await job(item) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Logs how many of a batch failed without drowning the terminal in stack traces. */
export function reportFailures(label: string, results: Array<PromiseSettledResult<unknown>>): void {
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === 0) return;

  const first = failures[0];
  const detail =
    first?.status === 'rejected' && first.reason instanceof Error ? first.reason.message : '';
  log.warn(`${label}: ${failures.length} of ${results.length} requests failed. ${detail}`);
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
