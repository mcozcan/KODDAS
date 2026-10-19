import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/agentPatch.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const agentPatch = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('parses SEARCH/REPLACE blocks with explicit relative file paths', () => {
  const blocks = agentPatch.parseAgentPatch('FILE: routes/web.php\n<<<<<<< SEARCH\nold line\n=======\nnew line\n>>>>>>> REPLACE');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].path, 'routes/web.php');
  assert.equal(agentPatch.applyAgentPatch('old line\n', blocks, 'routes/web.php'), 'new line\n');
});

test('matches whitespace-normalized SEARCH text', () => {
  const blocks = [{ path: 'app.php', kind: 'replace', search: '  $x   = 1; ', replace: '$x = 2;' }];
  assert.equal(agentPatch.applyAgentPatch('$x = 1;\n', blocks, 'app.php'), '$x = 2;\n');
});

test('accepts fuzzy SEARCH only above the similarity threshold', () => {
  const accepted = [{ path: 'a.php', kind: 'replace', search: 'const $value = 2;', replace: 'const $value = 3;' }];
  assert.equal(agentPatch.applyAgentPatch('const $value = 1;\n', accepted, 'a.php'), 'const $value = 3;\n');
  const rejected = [{ path: 'a.php', kind: 'replace', search: 'completely unrelated text', replace: 'replacement' }];
  assert.throws(() => agentPatch.applyAgentPatch('const $value = 1;\n', rejected, 'a.php'), agentPatch.PatchMatchError);
});

test('rejects invented or unsafe paths', () => {
  assert.throws(() => agentPatch.parseAgentPatch('FILE: ../outside.php\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE'), /Güvenli olmayan FILE yolu/);
  const block = [{ path: 'other.php', kind: 'replace', search: 'x', replace: 'y' }];
  assert.throws(() => agentPatch.applyAgentPatch('x', block, 'web.php'), /yalnızca verilen dosya/);
});
