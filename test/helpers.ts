import type { ScoreBreakdown, ScoredEvent, SportEvent } from '../src/model/event.js';
import type { EventSource, FetchRequest } from '../src/sources/types.js';

/** A plain event, with any field overridable. */
export function makeEvent(over: Partial<SportEvent> = {}): SportEvent {
  return {
    id: 'test:1',
    sport: 'football',
    competition: 'Premier League',
    competitionFallback: null,
    title: 'Home vs Away',
    startsAt: new Date('2026-09-12T18:00:00Z'),
    stage: null,
    division: null,
    participants: ['Home', 'Away'],
    source: 'test',
    url: null,
    ...over,
  };
}

/** A scored event. Defaults to a believable mid-table league match. */
export function makeScored(over: Partial<ScoredEvent> = {}): ScoredEvent {
  const breakdown: ScoreBreakdown = {
    matchedCompetition: 'Premier League',
    base: 6,
    stageKey: null,
    stageAdjustment: 0,
    flags: [],
    clamped: false,
  };

  return {
    ...makeEvent(over),
    significance: 6,
    interest: 8,
    interestDivision: null,
    importance: 48,
    breakdown,
    ...over,
  };
}

/** A source that returns whatever you hand it. */
export function fakeSource(
  name: string,
  events: SportEvent[],
  sports: EventSource['sports'] = 'all',
): EventSource {
  return {
    name,
    sports,
    fetchEvents: (_request: FetchRequest): Promise<SportEvent[]> => Promise.resolve(events),
  };
}

/** A source that always falls over, for testing that one bad feed is survivable. */
export function brokenSource(name: string, message = 'feed is down'): EventSource {
  return {
    name,
    sports: 'all',
    fetchEvents: (): Promise<SportEvent[]> => Promise.reject(new Error(message)),
  };
}

/** Silences the logger for a block, so test output stays readable. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const { log: realLog, warn, error } = console;
  console.log = (): void => {};
  console.warn = (): void => {};
  console.error = (): void => {};
  try {
    return await fn();
  } finally {
    console.log = realLog;
    console.warn = warn;
    console.error = error;
  }
}
