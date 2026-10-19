import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequestedComment, isSimpleCommentRequest, insertRequestedComment, insertIntent, INTENT_EXAMPLES, parseIntentJson } from '../src/lib/commentInsertion.ts';
import { diffLines } from '../src/lib/lineChanges.ts';

test('task phrase turns into a PHP comment without calling a model', () => {
  const task = 'web.php içine git yorum satırında basayım apoya yazdır';
  assert.equal(isSimpleCommentRequest(task), true);
  assert.equal(extractRequestedComment(task), 'basayım apoya');
  assert.equal(insertRequestedComment('<?php\n\nuse App\\Route;\n', 'web.php', task), '<?php\n// basayım apoya\n\nuse App\\Route;\n');
});

test('explicit top and implicit active-file bottom insertions work', () => {
  assert.equal(insertRequestedComment('<?php\nreturn true;\n', 'index.php', "index.php'nin en üstüne // test yaz"), '<?php\n// test\nreturn true;\n');
  assert.equal(insertRequestedComment('<?php\nreturn true;\n', 'web.php', 'en alta // bitti yaz'), '<?php\nreturn true;\n// bitti\n');
});

test('comment syntax follows the target file extension', () => {
  assert.equal(insertRequestedComment('<main></main>', 'page.html', 'yorum satırında hazır yaz'), '<main></main>\n<!-- hazır -->');
});

test('all four reference sentences produce only the requested text in under two seconds', () => {
  const examples = [
    ['web.php içinde yorum satırında basayım apoya yaz', 'basayım apoya'],
    ['index.php en üstüne test yorumu ekle: deneme 1', 'deneme 1'],
    ['en alta bitti yaz', 'bitti'],
    ['web.php içine git be yorum olarak hello world yaz', 'hello world'],
  ];
  const started = performance.now();
  for (const [prompt, expected] of examples) {
    assert.equal(extractRequestedComment(prompt), expected);
    const target = /index\.php/i.test(prompt) ? 'index.php' : 'web.php';
    const result = insertRequestedComment('<?php\nreturn true;\n', target, prompt);
    assert.ok(result?.includes(`// ${expected}`));
    const delta = diffLines('<?php\nreturn true;\n', result ?? '');
    assert.deepEqual({ added: delta.added, removed: delta.removed }, { added: 1, removed: 0 });
  }
  assert.ok(performance.now() - started < 2000);
});

test('insert intent preserves UTF-8 BOM and CRLF and diff reports only one added line', () => {
  const before = '\uFEFF<?php\r\nreturn true;\r\n';
  const after = insertIntent(before, 'web.php', INTENT_EXAMPLES[0]);
  assert.ok(after.startsWith('\uFEFF'));
  assert.ok(after.includes('\r\n'));
  assert.equal(after.replace(/\r\n/g, '').includes('\n'), false);
  assert.deepEqual({ added: diffLines(before, after).added, removed: diffLines(before, after).removed }, { added: 1, removed: 0 });
});

test('a response without usable JSON does not invent a file target', () => {
  assert.equal(parseIntentJson(''), null);
  assert.equal(parseIntentJson('I will add a comment'), null);
});

test('four observed Ollama JSON intents each produce a one-line diff', () => {
  const rows = [
    ['web.php içinde yorum satırında basayım apoya yaz', '{"action":"insert","file":"web.php","position":"after_open_tag","kind":"comment","text":"basayım apoya"}', 'web.php', '// basayım apoya'],
    ['index.php en üstüne test yorumu ekle: deneme 1', '{"action":"insert","file":"index.php","position":"top","kind":"comment","text":"deneme 1"}', 'index.php', '// deneme 1'],
    ['en alta bitti yaz', '{"action":"insert","file":null,"position":"bottom","kind":"comment","text":"bitti"}', 'web.php', '// bitti'],
    ['web.php içine git be yorum olarak hello world yaz', '{"action":"insert","file":"web.php","position":"after_open_tag","kind":"comment","text":"hello world"}', 'web.php', '// hello world'],
  ];
  for (const [_prompt, response, path, line] of rows) {
    const intent = parseIntentJson(response);
    if (!intent) throw new Error(`intent JSON parse failed: ${response}`);
    const before = '\uFEFF<?php\r\nreturn true;\r\n';
    const after = insertIntent(before, path, intent);
    assert.ok(after.includes(line));
    const delta = diffLines(before, after);
    assert.deepEqual({ added: delta.added, removed: delta.removed }, { added: 1, removed: 0 });
  }
});
