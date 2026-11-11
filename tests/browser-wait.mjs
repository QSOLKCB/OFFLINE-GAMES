// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';

/** Install before navigation. runFor fires every animation frame, so the game's
 * fixed clock gets the same ticks even when a CI renderer takes longer to draw.
 * fastForward would skip frames and trigger the game's catch-up limit again.
 */
export async function installGameClock(page) {
  await page.clock.install({time: new Date('2024-01-01T00:00:00Z')});
  await page.clock.pauseAt(new Date('2024-01-01T00:01:00Z'));
}

/** Poll through the entire wait budget, including the state after the last pause.
 * Report the last checked sample on failure; an extra, unchecked read can show
 * success in the error message and still incorrectly fail the smoke test.
 */
export async function waitForState(label, read, check, seconds = 40, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  assert.ok(Number.isFinite(seconds) && seconds >= 0, 'wait budget must be finite and nonnegative');
  const waits = Math.ceil(seconds * 5);
  for (let i = 0; i <= waits; i++) {
    const state = await read();
    if (await check(state)) return state;
    if (i === waits) assert.fail(`timed out waiting for: ${label} (${JSON.stringify(state)})`);
    await pause(200);
  }
}
