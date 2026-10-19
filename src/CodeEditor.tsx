import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { lineChanges, type LineHunk } from './lib/lineChanges';

monaco.editor.defineTheme('koddas-dark', { base: 'vs-dark', inherit: true, rules: [], colors: {
  'diffEditor.insertedLineBackground': '#2aa04b3d',
  'diffEditor.removedLineBackground': '#cd404033',
  'diffEditor.insertedTextBackground': '#2aa04b66',
  'diffEditor.removedTextBackground': '#cd404066',
  'diffEditorGutter.insertedLineBackground': '#1b7533',
  'diffEditorGutter.removedLineBackground': '#8c2828',
  'editorLineNumber.foreground': '#858894',
  'editorLineNumber.activeForeground': '#e7e9ee',
} });
monaco.editor.defineTheme('koddas-light', { base: 'vs', inherit: true, rules: [], colors: {
  'diffEditor.insertedLineBackground': '#2aa04b29',
  'diffEditor.removedLineBackground': '#cd404024',
  'diffEditor.insertedTextBackground': '#2aa04b4d',
  'diffEditor.removedTextBackground': '#cd40404d',
  'diffEditorGutter.insertedLineBackground': '#a8e2b5',
  'diffEditorGutter.removedLineBackground': '#f0aaaa',
  'editorLineNumber.foreground': '#737680',
  'editorLineNumber.activeForeground': '#25262b',
} });

type EditorOptions = monaco.editor.IStandaloneEditorConstructionOptions;
type EditorProps = {
  height?: string | number;
  language?: string;
  value?: string;
  baseline?: string;
  onChange?: (value: string | undefined) => void;
  theme?: string;
  options?: EditorOptions;
  onSelectionChange?: (selection: string) => void;
  onCursorLineChange?: (line: number) => void;
};

export function CodeEditor({ height = '100%', language = 'plaintext', value = '', baseline = value, onChange, onSelectionChange, onCursorLineChange, theme = 'koddas-dark', options }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const onCursorLineRef = useRef(onCursorLineChange);
  const decorations = useRef<string[]>([]);
  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;
  onCursorLineRef.current = onCursorLineChange;

  useEffect(() => {
    if (!host.current) return;
    const instance = monaco.editor.create(host.current, {
      value,
      language,
      theme,
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: false },
      ...options,
    });
    editor.current = instance;
    const subscription = instance.onDidChangeModelContent(() => onChangeRef.current?.(instance.getValue()));
    const selectionSubscription = instance.onDidChangeCursorSelection(event => {
      const model = instance.getModel();
      const selected = model && !event.selection.isEmpty() ? model.getValueInRange(event.selection) : '';
      onSelectionRef.current?.(selected);
      onCursorLineRef.current?.(event.selection.positionLineNumber);
    });
    return () => {
      subscription.dispose();
      selectionSubscription.dispose();
      instance.dispose();
      editor.current = null;
    };
    // Create once per mounted editor; subsequent props are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (instance && instance.getValue() !== value) instance.setValue(value);
  }, [value]);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const changes = lineChanges(baseline, value).hunks.flatMap(hunk => Array.from(
      { length: hunk.modifiedCount || (hunk.modifiedStart > 1 ? 1 : 0) },
      (_, index) => hunk.modifiedCount ? hunk.modifiedStart + index : hunk.modifiedStart - 1,
    )).filter(line => line > 0);
    decorations.current = instance.deltaDecorations(decorations.current, changes.map(line => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { isWholeLine: true, className: 'koddas-changed-line', linesDecorationsClassName: 'koddas-changed-gutter', glyphMarginClassName: 'koddas-changed-glyph' },
    })));
  }, [baseline, value]);

  useEffect(() => {
    const instance = editor.current;
    if (instance) {
      const model = instance.getModel();
      if (model) monaco.editor.setModelLanguage(model, language);
    }
  }, [language]);

  useEffect(() => {
    if (editor.current) editor.current.updateOptions(options ?? {});
  }, [options]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={host} style={{ height, width: '100%', overflow: 'hidden' }} />;
}

type DiffProps = {
  height?: string | number;
  original: string;
  modified: string;
  language?: string;
  theme?: string;
  options?: monaco.editor.IStandaloneDiffEditorConstructionOptions;
  selectedHunk?: number;
  hunks?: LineHunk[];
};

export function CodeDiffEditor({ height = '100%', original, modified, language = 'plaintext', theme = 'koddas-dark', options, selectedHunk = 0, hunks = [] }: DiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const decorations = useRef<{ original: string[]; modified: string[] }>({ original: [], modified: [] });

  useEffect(() => {
    if (!host.current) return;
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    const instance = monaco.editor.createDiffEditor(host.current, { theme, automaticLayout: true, glyphMargin: true, ...options });
    instance.setModel({ original: originalModel, modified: modifiedModel });
    editor.current = instance;
    models.current = { original: originalModel, modified: modifiedModel };
    
    return () => {
      instance.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editor.current = null;
      models.current = null;
    };
    // Models are updated in effects; initialize only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = models.current;
    if (current) {
      if (current.original.getValue() !== original) current.original.setValue(original);
      if (current.modified.getValue() !== modified) current.modified.setValue(modified);
    }
  }, [original, modified]);

  useEffect(() => {
    const current = models.current;
    if (current) {
      monaco.editor.setModelLanguage(current.original, language);
      monaco.editor.setModelLanguage(current.modified, language);
    }
  }, [language]);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const createLineDecorations = (side: 'original' | 'modified') => {
      const editorSide = side === 'original' ? instance.getOriginalEditor() : instance.getModifiedEditor();
      const model = editorSide.getModel();
      if (!model) return [];
      const entries = hunks.flatMap(hunk => {
        const count = side === 'original' ? hunk.originalCount : hunk.modifiedCount;
        const start = side === 'original' ? hunk.originalStart : hunk.modifiedStart;
        const className = side === 'original' ? 'koddas-diff-removed-line' : 'koddas-diff-added-line';
        const gutterClassName = side === 'original' ? 'koddas-diff-removed-gutter' : 'koddas-diff-added-gutter';
        const markerLine = count ? start : Math.min(Math.max(1, start - 1), model.getLineCount());
        const lines = count ? Array.from({ length: count }, (_, index) => start + index) : [markerLine];
        return lines.filter(line => line >= 1 && line <= model.getLineCount()).map(line => ({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className, linesDecorationsClassName: gutterClassName, overviewRuler: { color: side === 'original' ? '#d15a5a' : '#43a765', position: monaco.editor.OverviewRulerLane.Left } },
        }));
      });
      const previous = decorations.current[side];
      const next = editorSide.deltaDecorations(previous, entries);
      decorations.current[side] = next;
      return next;
    };
    createLineDecorations('original');
    createLineDecorations('modified');
  }, [original, modified, hunks]);

  useEffect(() => {
    if (editor.current) { editor.current.updateOptions({ glyphMargin: true, ...options }); editor.current.getOriginalEditor().updateOptions({ glyphMargin: true }); editor.current.getModifiedEditor().updateOptions({ glyphMargin: true }); }
  }, [options]);

  useEffect(() => {
    const hunk = hunks[selectedHunk];
    if (hunk && editor.current) editor.current.getModifiedEditor().revealLineInCenter(Math.max(1, hunk.modifiedStart));
  }, [hunks, selectedHunk]);

  useEffect(() => {
    monaco.editor.setTheme(theme);
  }, [theme]);

  return <div ref={host} style={{ height, width: '100%', overflow: 'hidden' }} />;
}
