import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentPatch, applyAgentPatch, PatchMatchError, PatchValidationError } from '../src/lib/agentPatch.ts';

test('parses and applies SEARCH/REPLACE, with normalized whitespace fallback', () => {
  const patch = parseAgentPatch('FILE: routes/web.php\n<<<<<<< SEARCH\nRoute::get(  "/old"  );\n=======\nRoute::get("/new");\n>>>>>>> REPLACE');
  assert.equal(applyAgentPatch('Route::get( "/old" );\n', patch, 'routes/web.php'), 'Route::get("/new");\n');
});

test('supports blank SEARCH for a new file and full-file responses', () => {
  const create = parseAgentPatch('FILE: new.php\n<<<<<<< SEARCH\n=======\n<?php\n>>>>>>> REPLACE');
  assert.equal(applyAgentPatch('', create, 'new.php'), '<?php');
  const full = parseAgentPatch('FILE: new.php\n<<<<<<< FULL FILE\n<?php\n// ready\n>>>>>>> FULL FILE');
  assert.equal(applyAgentPatch('', full, 'new.php'), '<?php\n// ready');
});

test('uses the greater-than-85-percent fuzzy fallback for a near-identical line', () => {
  const patch = parseAgentPatch('FILE: routes/web.php\n<<<<<<< SEARCH\nRoute::get("/profil");\n=======\nRoute::get("/home");\n>>>>>>> REPLACE');
  assert.equal(applyAgentPatch('Route::get("/profile");', patch, 'routes/web.php'), 'Route::get("/home");');
});

test('rejects an invented path and reports an unmatched search block', () => {
  const wrongPath = parseAgentPatch('FILE: other.php\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE');
  assert.throws(() => applyAgentPatch('a', wrongPath, 'routes/web.php'), /yalnızca verilen dosya/);
  const missing = parseAgentPatch('FILE: routes/web.php\n<<<<<<< SEARCH\nmissing\n=======\nnew\n>>>>>>> REPLACE');
  assert.throws(() => applyAgentPatch('current', missing, 'routes/web.php'), PatchMatchError);
});

test('SEARCH/REPLACE without a FILE header uses the application target', () => {
  const patch = parseAgentPatch('<<<<<<< SEARCH\nold line\n=======\nnew line\n>>>>>>> REPLACE', 'routes/web.php');
  assert.equal(patch[0].path, 'routes/web.php');
  assert.equal(applyAgentPatch('old line\n', patch, 'routes/web.php'), 'new line\n');
});

test('a code-only response becomes an append block and an empty response stays empty', () => {
  const code = parseAgentPatch('```php\n// generated\n```', 'web.php');
  assert.equal(applyAgentPatch('<?php\n', code, 'web.php'), '<?php\n// generated');
  assert.deepEqual(parseAgentPatch('', 'web.php'), []);
});

test('routes multi-file patches to their explicitly allowed files', () => {
  const allowed = ['routes/web.php', 'resources/views/welcome.blade.php'];
  const response = [
    'FILE: routes/web.php',
    '<<<<<<< SEARCH\nRoute::get("/", fn () => view("welcome"));\n=======\nRoute::get("/", fn () => view("welcome"))->name("home");\n>>>>>>> REPLACE',
    'FILE: resources/views/welcome.blade.php',
    '<<<<<<< SEARCH\n<h1>Old</h1>\n=======\n<h1>New</h1>\n>>>>>>> REPLACE',
  ].join('\n');
  const blocks = parseAgentPatch(response, allowed[0], allowed);
  assert.deepEqual(blocks.map(block => block.path), allowed);
});

test('does not remap an unapproved multi-file target to the first file', () => {
  const blocks = parseAgentPatch('FILE: ../../outside.php\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE', 'routes/web.php', ['routes/web.php']);
  assert.equal(blocks[0].path, '../../outside.php');
});

test('an unrelated FILE header falls back to the selected target', () => {
  const patch = parseAgentPatch('FILE: invented.php\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE', 'web.php');
  assert.equal(patch[0].path, 'web.php');
});

test('rejects HTML, PHP, and prose accidentally written into JSON targets', () => {
  const blocks = parseAgentPatch('FILE: composer.json\n<<<<<<< FULL FILE\n{"require": {}}\n<!DOCTYPE html>\nclass Task extends Model {}\n>>>>>>> FULL FILE', 'composer.json', ['composer.json']);
  assert.throws(() => applyAgentPatch('{"require": {}}', blocks, 'composer.json'), PatchValidationError);
  const migration = parseAgentPatch('FILE: composer.js\n<<<<<<< FULL FILE\n<?php\nuse Illuminate\\Database\\Migrations\\Migration;\nclass CreateTasksTable extends Migration {}\n>>>>>>> FULL FILE', 'composer.js', ['composer.js']);
  assert.throws(() => applyAgentPatch('', migration, 'composer.js'), PatchValidationError);
});
