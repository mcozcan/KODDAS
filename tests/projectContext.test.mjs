import test from 'node:test';
import assert from 'node:assert/strict';
import { findBestTargetFile, rankRelevantProjectFiles, selectProjectGuides } from '../src/lib/projectContext.ts';

test('selects root guidance and only nested guidance that applies to a target', () => {
  const paths = ['AGENTS.md', 'README.md', 'src/AGENTS.md', 'tests/AGENTS.md', '.github/copilot-instructions.md'];
  assert.deepEqual(selectProjectGuides(paths, ['src/App.tsx']), ['AGENTS.md', '.github/copilot-instructions.md', 'src/AGENTS.md', 'README.md']);
});

test('ranks related files by request words and excludes edit targets', () => {
  const paths = ['routes/web.php', 'resources/views/welcome.blade.php', 'app/Http/Controllers/UserController.php', 'README.md'];
  assert.deepEqual(rankRelevantProjectFiles(paths, 'Laravel kullanıcı profil sayfası controller', ['resources/views/welcome.blade.php'], 2), [
    'app/Http/Controllers/UserController.php', 'README.md',
  ]);
});

test('chooses an edit target only when a source path matches user intent', () => {
  const paths = ['resources/views/welcome.blade.php', 'routes/web.php', 'app/Http/Controllers/AuthController.php'];
  assert.equal(findBestTargetFile(paths, 'anasayfa tasarımını güncelle'), 'resources/views/welcome.blade.php');
  assert.equal(findBestTargetFile(paths, 'projeyi düzelt'), undefined);
});
