// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Builder} from '../VAGRANT_STARS/js/sim/models.js';
test('OBJ conversion preserves triangle positions and rejects unsafe or ambiguous geometry before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'offline-obj-')), input = join(dir, 'mesh.obj'), output = join(dir, 'mesh.js');
  const run = () => execFileSync('python3', ['scripts/obj-to-mod.py', input, output], {stdio: 'pipe'});
  try {
    const vertices = 'v 0 0 0\nv 1 0 0\nv 0 1 0\n';
    writeFileSync(input, vertices + 'f -3/1/1 -2/2/1 -1/3/1\n'); run();
    const good = readFileSync(output, 'utf8'), triangles = JSON.parse(good.split('export const triangles = ')[1].slice(0, -2));
    const b = new Builder(); for (const [a, c, d] of triangles) b.tri(a, c, d, [0.2,0.4,0.6]);
    assert.equal(b.build().count, 1); assert.deepEqual([...b.build().normals], [0,0,1]);
    for (const bad of [vertices + 'f 1 2 3 1', vertices + 'f 1 2 9', vertices + 'f 1 1 1', 'v nan 0 0\nf 1 1 1']) {
      writeFileSync(input, bad); assert.throws(run); assert.equal(readFileSync(output, 'utf8'), good);
    }
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
