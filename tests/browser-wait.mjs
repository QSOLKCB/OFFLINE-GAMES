// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';

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
