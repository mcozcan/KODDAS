import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/promptBudget.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const budget = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('keeps a small file complete and line-numbered', () => {
  const file = '<?php\n// hello\n';
  assert.equal(budget.buildFileContext(file, 2, '', 12000), '1: <?php\n2: // hello\n3: ');
});

test('clips a 2500-line file to its head and cursor window', () => {
  const file = Array.from({ length: 2500 }, (_, index) => `line_${index + 1}`).join('\n');
  const excerpt = budget.buildFileContext(file, 1500, '', 12000);
  assert.match(excerpt, /1: line_1/);
  assert.match(excerpt, /1420: line_1420/);
  assert.match(excerpt, /1580: line_1580/);
  assert.doesNotMatch(excerpt, /2500: line_2500/);
  assert.ok(excerpt.length < file.length / 2);
});

test('estimates prompt categories and selects a context window', () => {
  const breakdown = budget.estimatePromptBreakdown([{ role: 'system', content: 'short rules' }, { role: 'user', content: 'hello' }]);
  assert.ok(breakdown.total > 0);
  assert.equal(budget.chooseNumCtx(3000, 2048, 16384), 8192);
  assert.equal(budget.chooseNumCtx(9000, 2048, 32768, 6000), 8192);
});
