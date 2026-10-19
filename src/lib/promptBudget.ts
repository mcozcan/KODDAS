export type PromptMessage = { role: string; content: string };
export type PromptBreakdown = { system: number; fewShot: number; projectTree: number; fileContent: number; history: number; task: number; total: number };

export function estimateTokens(text: string): number {
  // Code and Turkish text tokenize much more densely than ordinary English.
  // Use a deliberately conservative ratio so we compact before Ollama rejects
  // the request instead of discovering the real limit after sending it.
  return Math.ceil(text.length / 2.6);
}

export function estimatePromptBreakdown(messages: PromptMessage[]): PromptBreakdown {
  const systemText = messages.find(message => message.role === 'system')?.content ?? '';
  const task = messages[messages.length - 1]?.content ?? '';
  const tree = systemText.match(/PROJECT TREE[^\n]*\n[\s\S]*?(?=\n(?:ACTIVE FILE:|ACTIVE FILE CONTEXT|TARGET FILE:|USER SELECTED CODE:|RULES:)|$)/)?.[0] ?? '';
  const fileBlocks = [...systemText.matchAll(/(?:ACTIVE FILE CONTEXT[^\n]*|ACTIVE FILE EXCERPT|TARGET CONTENT[^\n]*):\n[\s\S]*?(?=\n(?:ACTIVE FILE:|TARGET FILE:|USER SELECTED CODE:|RULES:)|$)/g)].map(match => match[0]);
  const fileContent = fileBlocks.reduce((sum, block) => sum + block.length, 0);
  const fewShot = systemText.match(/Example:[^\n]*/)?.[0] ?? '';
  return {
    system: Math.ceil(Math.max(0, estimateTokens(systemText) - estimateTokens(tree) - estimateTokens(fileContent ? fileBlocks.join('\n') : '') - estimateTokens(fewShot))),
    fewShot: estimateTokens(fewShot),
    projectTree: estimateTokens(tree),
    fileContent: estimateTokens(fileBlocks.join('\n')),
    history: estimateTokens(messages.slice(1, -1).map(message => message.content).join('\n')),
    task: estimateTokens(task),
    total: messages.reduce((sum, message) => sum + estimateTokens(message.content) + 6, 0),
  };
}

/** Keep output space inside the selected model window after estimating the full prompt. */
export function fitPredictBudget(promptTokens: number, requestedPredict: number, numCtx: number, reserve = 96): number {
  return Math.max(1, Math.min(requestedPredict, numCtx - promptTokens - reserve));
}

/** Grow a truncated response only into context space that remains after the prompt. */
export function nextPredictBudget(currentPredict: number, promptTokens: number, evalTokens: number, numCtx: number, maxPredict = 8192): number | undefined {
  const available = numCtx - promptTokens - 96;
  if (available <= currentPredict || available <= evalTokens) return undefined;
  return Math.min(available, maxPredict, Math.max(currentPredict + 128, currentPredict * 2));
}

/** Return a system message with project/file context removed until its text fits the requested budget. */
export function compactSystemContext(systemText: string, maxChars: number, shrinkFiles = false): string {
  let result = systemText.replace(/\nPROJECT TREE[^\n]*\n[\s\S]*?(?=\n(?:ACTIVE FILE:|ACTIVE FILE CONTEXT|TARGET FILE:|USER SELECTED CODE:|RULES:)|$)/, '');
  if (shrinkFiles) {
    result = result.replace(/(ACTIVE FILE CONTEXT[^\n]*|TARGET CONTENT[^\n]*):\n([\s\S]*?)(?=\n(?:ACTIVE FILE:|TARGET FILE:|USER SELECTED CODE:|RULES:)|$)/g, (_block, heading: string, body: string) => {
      // File excerpts must also be safe for minified files: a single source line can
      // contain megabytes, so a line-count based slice is not a context limit.
      const remaining = Math.max(500, maxChars - result.length + body.length);
      const excerpt = buildFileContext(body.split('\n').map(line => line.replace(/^\d+: /, '')).join('\n'), 1, '', Math.min(remaining, 4000), true);
      return `${heading}:\n${excerpt}`;
    });
  }
  if (result.length <= maxChars) return result;
  // Keep the instruction and tail (which contains the task rules), trimming only
  // the middle of an oversized system prompt as a final safety net.
  const clipped = Math.max(0, maxChars - 96);
  const head = Math.floor(clipped * 0.65);
  const tail = clipped - head;
  result = `${result.slice(0, head)}\n[Bağlam karakter bütçesi nedeniyle kısaltıldı.]\n${result.slice(-tail)}`;
  return result;
}

const CONTEXT_OPTIONS = [4096, 8192, 16384, 32768] as const;
export function chooseNumCtx(promptTokens: number, numPredict: number, configuredMax: number, vramMb?: number | null): number {
  const vramCap = vramMb == null ? 32768 : vramMb < 4096 ? 4096 : vramMb < 8192 ? 8192 : vramMb < 12288 ? 16384 : 32768;
  const ceiling = Math.min(configuredMax, vramCap);
  const needed = promptTokens + numPredict + 128;
  return CONTEXT_OPTIONS.find(size => size >= needed && size <= ceiling) ?? ceiling;
}

export function buildFileContext(content: string, cursorLine: number, selectedText: string, maxChars = 12000, forceExcerpt = false): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const numberedLength = lines.reduce((sum, line, index) => sum + line.length + String(index + 1).length + 3, 0);
  if (lines.length < 300 && !forceExcerpt && numberedLength <= maxChars) return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
  maxChars = Math.max(300, maxChars);
  // Cap individual lines before summary/window selection. This handles generated
  // or minified HTML/JS where a small line count hides a very large file.
  const perLineLimit = Math.max(160, Math.min(1200, Math.floor(maxChars / 4)));
  const clippedLines = lines.map((line, index) => line.length > perLineLimit
    ? `${line.slice(0, perLineLimit)} … [satır ${index + 1} devamı kısaltıldı; ${line.length} karakter]`
    : line);
  const keep = new Set<number>();
  const addWindow = (center: number, radius: number) => {
    const first = Math.max(1, center - radius), last = Math.min(lines.length, center + radius);
    for (let line = first; line <= last; line++) keep.add(line);
  };
  for (let line = 1; line <= Math.min(16, lines.length); line++) keep.add(line);
  addWindow(cursorLine, 80);
  if (selectedText.trim()) {
    const selectedLine = lines.findIndex(line => line.includes(selectedText.trim().split('\n')[0]));
    if (selectedLine >= 0) addWindow(selectedLine + 1, 80);
  }
  const signature = /^\s*(?:(?:export\s+)?(?:abstract\s+)?(?:class|interface|trait|enum|function|const|def|fn|func)\b|(?:public|private|protected)\s+(?:static\s+)?function\b|Route::|#\s*(?:TODO|NOTE)\b)/;
  const summary = clippedLines.flatMap((line, index) => signature.test(line) ? [`${index + 1}: ${line}`] : []).slice(0, 30);
  const output = [`[Dosya özeti: ${lines.length} satır, ${content.length} karakter; baş, imleç/seçim çevresi ve yapı satırları gösteriliyor${numberedLength > maxChars ? '; uzun satırlar kısaltıldı' : ''}.]`];
  const summaryBudget = Math.min(Math.floor(maxChars / 4), 1200);
  for (const item of summary) {
    const row = `[Özet] ${item}`;
    if (output.join('\n').length + row.length + 1 > summaryBudget) break;
    output.push(row);
  }
  let size = output.join('\n').length;
  for (const lineNumber of [...keep].sort((a, b) => a - b)) {
    const row = `${lineNumber}: ${clippedLines[lineNumber - 1]}`;
    if (size + row.length + 1 > maxChars) continue;
    output.push(row);
    size += row.length + 1;
  }
  if (numberedLength > maxChars) output.push('[Dosyanın geri kalanı bağlam bütçesi nedeniyle eklenmedi.]');
  return output.join('\n');
}
