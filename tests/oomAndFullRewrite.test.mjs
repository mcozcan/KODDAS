import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOllamaFailure, lowerContextHalf, selectVramContext } from '../src/lib/ollamaRecovery.ts';
import { ensureAnimatedText, extractFullHtml, isFullRewriteRequest, requiredVisibleText } from '../src/lib/fullRewrite.ts';
import { diffLines } from '../src/lib/lineChanges.ts';
import { estimateRequiredVram, modelVramProfile } from '../src/lib/modelCatalog.ts';
import { buildFileContext, compactSystemContext, estimatePromptBreakdown, estimateTokens, fitPredictBudget, nextPredictBudget } from '../src/lib/promptBudget.ts';

test('CUDA allocation and KV cache failures classify as OOM, not generic crashes', () => {
  assert.equal(classifyOllamaFailure('HTTP 500 cudaMalloc failed: out of memory while allocating buffer for kv cache').kind, 'oom');
  assert.deepEqual([lowerContextHalf(16384), lowerContextHalf(8192), lowerContextHalf(4096)], [8192, 4096, 2048]);
});

test('32768 context is reduced to fit a 12 GB GPU and VRAM estimate includes overhead', () => {
  const model = { weightsGb: 8, kvGbPer8k: 0.6 };
  const estimateRequiredVram = value => Number((model.weightsGb + 1.5 + model.kvGbPer8k * value / 8192).toFixed(1));
  const context = selectVramContext(32768, estimateRequiredVram, 10.2);
  assert.equal(context, 8192);
  assert.ok(estimateRequiredVram(context) <= 10.2);
  assert.ok(estimateRequiredVram(context) >= model.weightsGb + 1.5);
});

test('Ollama quantized tag resolves to its catalog family and uses the measured model size', () => {
  const measured = modelVramProfile('deepseek-coder-v2:16b-lite-instruct-q4_K_M', 10_364_432_619);
  assert.ok(measured);
  assert.equal(measured.weightsGb, 10.364432619);
  assert.ok(estimateRequiredVram(measured, 4096) > measured.weightsGb + 1.5);
});

test('full rewrite intent and complete HTML extraction work without including prior file content', () => {
  const prompt = 'index.html içindeki tüm kodları sil ve oraya basayım apoya yazan animasyonlu bir tasarım yap';
  assert.equal(isFullRewriteRequest(prompt), true);
  assert.equal(isFullRewriteRequest('yeni index.html tasarımı oluşturur musun'), true);
  assert.equal(requiredVisibleText(prompt), 'basayım apoya');
  assert.equal(extractFullHtml('<!doctype html><html><body>basayım apoya</body></html>'), '<!doctype html><html><body>basayım apoya</body></html>');
  assert.equal(extractFullHtml('```html\n<!doctype html><html></html>\n```'), '<!doctype html><html></html>');
  assert.equal(extractFullHtml('Here is a design'), null);
  const ensured = ensureAnimatedText('<!doctype html><html><head></head><body><main>Design</main></body></html>', 'basayım apoya');
  assert.match(ensured, /koddas-required-animated-text/);
  assert.match(ensured, /basayım apoya/);
  assert.match(ensured, /prefers-reduced-motion/);
});

test('CRLF and BOM remain identical around a single inserted line in the diff', () => {
  const before = '\uFEFF<!doctype html>\r\n<html>\r\n</html>\r\n';
  const after = '\uFEFF<!doctype html>\r\n<!-- added -->\r\n<html>\r\n</html>\r\n';
  assert.deepEqual({ added: diffLines(before, after).added, removed: diffLines(before, after).removed }, { added: 1, removed: 0 });
});

test('minified HTML with few oversized lines is excerpted within the prompt budget', () => {
  const minified = '<html><head>' + 'x'.repeat(70_000) + '</head><body>' + 'y'.repeat(40_000) + '</body></html>';
  const context = buildFileContext(minified, 1, '', 4_000);
  assert.ok(context.length < 4_200, `excerpt was ${context.length} chars`);
  assert.match(context, /uzun satırlar kısaltıldı/);
  assert.match(context, /karakter\]/);
  assert.ok(estimatePromptBreakdown([{ role: 'system', content: `TARGET CONTENT (line numbered):\n${context}` }, { role: 'user', content: 'add a comment' }]).fileContent < 1_300);
});

test('compact fallback clips a long single-line file instead of preserving it whole', () => {
  const hugeLine = 'z'.repeat(90_000);
  const system = `You are KODDAŞ.\nTARGET FILE: index.html\nTARGET CONTENT (line numbered):\n1: ${hugeLine}\nRULES: edit the target`;
  const compact = compactSystemContext(system, 2_000, true);
  assert.ok(compact.length <= 2_000, `compacted system was ${compact.length} chars`);
  assert.ok(compact.length < system.length / 10);
  assert.match(compact, /kısaltıldı/);
});

test('context budget uses a conservative estimate and recovers unused output room', () => {
  assert.equal(estimateTokens('x'.repeat(260)), 100);
  assert.equal(fitPredictBudget(990, 2048, 2048, 128), 930);
  assert.equal(nextPredictBudget(512, 990, 512, 2048), 962);
  assert.equal(nextPredictBudget(962, 990, 962, 2048), undefined);
});
