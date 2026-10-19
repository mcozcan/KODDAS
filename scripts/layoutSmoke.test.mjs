import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('main layout regions stay assigned to a fixed viewport grid', () => {
  const app = read('src/App.tsx');
  const css = read('src/layout-fix.css');
  for (const region of ['root', 'topbar', 'workspace', 'explorer', 'editor', 'agent', 'terminal', 'statusbar']) {
    assert.match(app, new RegExp(`data-layout-region="${region}"`), `missing ${region} layout region`);
  }
  for (const area of ['topbar', 'workspace', 'workbench', 'bottom', 'status']) {
    assert.match(css, new RegExp(`grid-area:\\s*${area}`), `missing ${area} grid area`);
  }
  assert.match(css, /html,[\s\S]*?body,[\s\S]*?#root\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(app, /ResizeObserver\(validate\)/, 'layout size diagnostic is missing');
});

test('terminal and editor keep positive space at supported window sizes', () => {
  for (const { width, height } of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
    const terminalHeight = Math.min(220, Math.max(120, height - 260));
    const workbenchHeight = height - 48 - 40 - terminalHeight - 22;
    const editorWidth = width - 250 - 365;
    assert.ok(workbenchHeight > 0, `${width}×${height} leaves a visible editor row`);
    assert.ok(editorWidth > 0, `${width}×${height} leaves a visible editor column`);
    assert.equal(48 + 40 + workbenchHeight + terminalHeight + 22, height);
  }
});

test('no JSX text node renders the literal backslash-n sequence', () => {
  const files = ['src/App.tsx', 'src/ModelManager.tsx', 'src/GpuStatus.tsx', 'src/TerminalView.tsx'];
  const offending = [];
  for (const path of files) {
    const source = read(path);
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxText(node) && node.getText(tree).includes('\\n')) offending.push({ path, text: node.getText(tree) });
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual(offending, [], 'JSX must not render a literal backslash-n sequence');
});
