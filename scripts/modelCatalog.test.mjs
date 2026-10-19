import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const path = new URL('../src/lib/modelCatalog.ts', import.meta.url);
const source = (await readFile(path, 'utf8')).replace("import catalog from '../data/modelCatalog.json';", 'const catalog = [];');
const compiled = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const models = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('catalog includes all requested Qwen, coding and completion sizes', async () => {
  const catalog = JSON.parse(await readFile(new URL('../src/data/modelCatalog.json', import.meta.url), 'utf8'));
  for (const name of ['qwen2.5-coder:1.5b','qwen2.5-coder:3b','qwen2.5-coder:7b','qwen2.5-coder:14b','qwen2.5-coder:32b','qwen3-coder:30b','qwen3:8b','qwen3:14b','deepseek-coder-v2:16b','codestral:22b','devstral:24b','gemma3:12b','llama3.1:8b','starcoder2:3b','starcoder2:7b']) assert.ok(catalog.some(entry => entry.name === name), name);
});

test('VRAM compatibility accounts for model weights, context and available memory', () => {
  const entry = { name:'qwen2.5-coder:7b', parameters:'7B', downloadGb:4.7, weightsGb:4.7, description:'', uses:['Agent'], kvGbPer8k:0.35 };
  assert.equal(models.checkCompatibility(entry,{totalMb:12288,freeMb:10240},8192).status,'comfortable');
  assert.equal(models.checkCompatibility(entry,{totalMb:8192,freeMb:5120},8192).status,'tight');
  assert.equal(models.checkCompatibility(entry,{totalMb:4096,freeMb:4096},8192).status,'wontFit');
  assert.equal(models.checkCompatibility(entry,undefined,8192).status,'unknown');
  assert.ok(models.estimateRequiredVram(entry,16384)>models.estimateRequiredVram(entry,8192));
  assert.ok(models.estimateRequiredVram(entry,8192,9_000_000_000)>9);
});

test('recommendation picks the largest comfortable Agent model', () => {
  const entries = [1,7,14].map(size=>({name:`model:${size}`,parameters:`${size}B`,downloadGb:size,weightsGb:size,description:'',uses:['Agent'],kvGbPer8k:0.1}));
  const result = models.suggestedModel(entries,entry=>({status:entry.weightsGb<=7?'comfortable':'wontFit'}));
  assert.equal(result.name,'model:7');
});
