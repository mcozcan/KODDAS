import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, revertLineHunk } from '../src/lib/lineChanges.ts';

test('counts true added and removed lines and separates distant hunks', () => {
  const diff = diffLines('one\nold\nthree\nfour\n', 'one\nnew\nthree\nfour\nextra\n');
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.equal(diff.hunks.length, 2);
});

test('reverts only the selected hunk', () => {
  const before = 'one\nold\nthree\n';
  const after = 'one\nnew\nthree\n';
  const [hunk] = diffLines(before, after).hunks;
  assert.equal(revertLineHunk(before, after, hunk), before);
});
