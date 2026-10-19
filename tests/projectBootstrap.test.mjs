import test from 'node:test';
import assert from 'node:assert/strict';
import { isLaravelBootstrapRequest, hasLaravelProject, isLaravelHomeRequest } from '../src/lib/projectBootstrap.ts';

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
