// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForState} from './browser-wait.mjs';

test('smoke wait accepts slingway entry during the final allowed pause', async () => {
  let elapsed = 0, reads = 0, checks = 0;
  const result = await waitForState('slingway', async () => {
    reads++; return {lane: elapsed >= 40000};
  }, async state => { checks++; return state.lane; }, 40, async ms => { elapsed += ms; });
  assert.deepEqual(result, {lane: true});
  assert.equal(elapsed, 40000);
  assert.equal(reads, 201); assert.equal(checks, reads, 'every observation is checked');
});

test('a genuine timeout fails with the checked sample and no additional diagnostic read', async () => {
  let elapsed = 0, reads = 0, checks = 0;
  await assert.rejects(waitForState('slingway', async () => {
    // Success would appear on an out-of-budget diagnostic read, just like the old failure log.
    return {lane: ++reads > 201};
  }, state => { checks++; return state.lane; }, 40, async ms => { elapsed += ms; }), {
    name: 'AssertionError', message: 'timed out waiting for: slingway ({"lane":false})',
  });
  assert.equal(elapsed, 40000); assert.equal(reads, 201); assert.equal(checks, reads);
});

test('an already satisfied condition returns immediately, even with no wait budget', async () => {
  const state = {mode: 'docked'};
  const result = await waitForState('docking', async () => state, async s => s.mode === 'docked', 0,
    async () => assert.fail('must not wait after success'));
  assert.equal(result, state);
});

test('failed observations and predicates propagate instead of being retried as timing failures', async () => {
  const readError = new Error('page closed'), predicateError = new Error('invalid state');
  await assert.rejects(waitForState('flight', async () => { throw readError; }, () => true), error => error === readError);
  await assert.rejects(waitForState('flight', async () => ({}), async () => { throw predicateError; }), error => error === predicateError);
});
