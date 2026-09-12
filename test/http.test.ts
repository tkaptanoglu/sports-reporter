import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithLimit } from '../src/sources/http.js';

describe('mapWithLimit', () => {
  test('keeps every result in the order the items were given', async () => {
    // Jobs finish out of order on purpose. Results must not follow suit.
    const results = await mapWithLimit([30, 5, 20, 1], 4, async (ms) => {
      await new Promise((done) => setTimeout(done, ms));
      return ms;
    });

    assert.deepEqual(
      results.map((r) => (r.status === 'fulfilled' ? r.value : null)),
      [30, 5, 20, 1],
    );
  });

  test('never runs more than the limit at once', async () => {
    // The whole reason this exists: free APIs answer a burst of parallel
    // requests with an HTML error page rather than data.
    let running = 0;
    let peak = 0;

    await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((done) => setTimeout(done, 5));
      running -= 1;
    });

    assert.ok(peak <= 3, `ran ${peak} jobs at once with a limit of 3`);
  });

  test('one failing job does not stop the others', async () => {
    const results = await mapWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('nope');
      return n;
    });

    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'rejected', 'fulfilled'],
    );
  });

  test('handles an empty list without hanging', async () => {
    assert.deepEqual(await mapWithLimit([], 4, async () => 1), []);
  });
});
