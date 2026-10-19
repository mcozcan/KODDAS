import test from 'node:test';
import assert from 'node:assert/strict';
import { isLaravelBootstrapRequest, hasLaravelProject, isLaravelHomeRequest, isExplicitlyExcludedPath, inferLaravelTaskTargets } from '../src/lib/projectBootstrap.ts';

test('recognizes a Turkish Laravel create-project request in Agent mode', () => {
  assert.equal(isLaravelBootstrapRequest('Agent', 'Burada yeni bir laravel projesi oluşturmanı istiyorum'), true);
  assert.equal(isLaravelBootstrapRequest('Ask', 'Laravel projesi oluştur'), false);
  assert.equal(isLaravelBootstrapRequest('Agent', 'Laravel routing nasıl çalışır?'), false);
});

test('detects a Laravel root from artisan and composer.json', () => {
  assert.equal(hasLaravelProject([{ name: 'artisan' }, { name: 'composer.json' }]), true);
  assert.equal(hasLaravelProject([{ name: 'composer.json' }]), false);
});

test('recognizes Turkish follow-up requests for the home page without repeating Laravel', () => {
  assert.equal(isLaravelHomeRequest('Projenin anasayfasında hoş geldin yazısı animasyonlu olsun'), true);
  assert.equal(isLaravelHomeRequest('Change the Laravel homepage'), true);
  assert.equal(isLaravelHomeRequest('Add a migration for users'), false);
});

test('does not select composer.json when the prompt explicitly excludes it', () => {
  assert.equal(isExplicitlyExcludedPath('composer.json dosyasını değiştirme; görev ekle', 'composer.json'), true);
  assert.equal(isExplicitlyExcludedPath('Fix the welcome page', 'composer.json'), false);
});

test('infers Laravel task CRUD targets instead of a manifest file', () => {
  const targets = inferLaravelTaskTargets(['composer.json', 'routes/web.php', 'database/migrations/create_users_table.php'], 'Görev takip özelliği ekle: görevleri oluştur, listele ve sil; model, controller, migration, Blade görünümü oluştur ve testleri çalıştır.');
  assert.ok(targets.includes('routes/web.php'));
  assert.ok(targets.some(path => /^database\/migrations\/\d{4}_\d{2}_\d{2}_\d{6}_create_tasks_table\.php$/.test(path)));
  assert.ok(targets.includes('app/Models/Task.php'));
  assert.ok(targets.includes('app/Http/Controllers/TaskController.php'));
  assert.ok(targets.includes('resources/views/tasks/index.blade.php'));
  assert.ok(targets.includes('tests/Feature/TaskCrudTest.php'));
  assert.ok(!targets.includes('composer.json'));
});
