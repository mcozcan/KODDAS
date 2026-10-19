import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerPrompt, isResearchOnlyTask, parseAgentPlan, shouldOrchestrate, splitAgentTask } from '../src/lib/orchestrator.ts';
import { applyAgentPatch, parseAgentPatch } from '../src/lib/agentPatch.ts';

test('delegates complex Turkish multi-step coding requests but skips simple tasks', () => {
  assert.equal(shouldOrchestrate('Laravel 13 kurmanı istiyorum, ana sayfada animasyonlu karşılama yazısı, kullanıcı kayıt ve giriş sistemi, görev oluşturma ve silme özellikleri olsun, responsive tasarla', 1), true);
  assert.equal(shouldOrchestrate('welcome.blade.php dosyasına bir başlık ekle', 1), false);
  assert.equal(shouldOrchestrate('İki dosyada aynı tasarımı güncelle', 2), true);
});

test('bounds and validates delegated tasks returned by the planner', () => {
  const plan = parseAgentPlan('Plan: {"summary":"Projeyi incele","tasks":[{"role":"Mimar","task":"Mevcut yapıyı incele"},{"role":"Geliştirici","task":"Gerekli entegrasyonları belirle"},{"role":"Fazla","task":"Bu görev kesilmeli"},{"role":"Fazla","task":"Kesilmeli"}]}');
  assert.equal(plan.tasks.length, 3);
  assert.equal(plan.tasks[0].role, 'Mimar');
  assert.throws(() => parseAgentPlan('{"tasks":[{"role":"Tek","task":"Tek görev"}]}'), /en az iki/);
});

test('planner prompt contains a short project file scope', () => {
  const prompt = buildPlannerPrompt('Bir panel yap', Array.from({ length: 50 }, (_, index) => `file-${index}.ts`));
  assert.match(prompt, /Bir panel yap/);
  assert.match(prompt, /file-19\.ts/);
  assert.doesNotMatch(prompt, /file-20\.ts/);
  assert.match(prompt, /dependency order/);
  assert.match(prompt, /implementation steps/);
});

test('sequential task patches build on the previous task draft', () => {
  const path = 'routes/web.php';
  const first = '<?php\n\nRoute::get("/", fn () => view("welcome"));';
  const firstBlocks = parseAgentPatch(`FILE: ${path}\n<<<<<<< SEARCH\nRoute::get("/", fn () => view("welcome"));\n=======\nRoute::get("/", fn () => view("welcome"));\nRoute::middleware("auth")->get("/dashboard", fn () => view("dashboard"));\n>>>>>>> REPLACE`, path, [path]);
  const afterFirst = applyAgentPatch(first, firstBlocks, path);
  const secondBlocks = parseAgentPatch(`FILE: ${path}\n<<<<<<< SEARCH\nRoute::middleware("auth")->get("/dashboard", fn () => view("dashboard"));\n=======\nRoute::middleware("auth")->get("/dashboard", fn () => view("dashboard"));\nRoute::middleware("auth")->get("/tasks", fn () => view("tasks.index"));\n>>>>>>> REPLACE`, path, [path]);
  const afterSecond = applyAgentPatch(afterFirst, secondBlocks, path);
  assert.match(afterSecond, /\/dashboard/);
  assert.match(afterSecond, /\/tasks/);
});

test('invalid or truncated splitter output has a deterministic smaller-task fallback', () => {
  const tasks = splitAgentTask('Add task listing, and add task creation, and add responsive styling');
  assert.equal(tasks.length, 3);
  assert.match(tasks[0].task, /only this part/);
  assert.match(tasks[2].task, /responsive styling/);
  const fileTasks = splitAgentTask('Implement the requested feature', ['routes/web.php', 'app/Models/Task.php']);
  assert.equal(fileTasks.length, 2);
  assert.match(fileTasks[0].task, /routes\/web.php/);
});

test('research-only planner steps are rejected from implementation plans', () => {
  assert.equal(isResearchOnlyTask('Proje ve dosyaları incele'), true);
  assert.equal(isResearchOnlyTask('Review the route and add the missing dashboard endpoint'), false);
});
