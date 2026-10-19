export type AgentPatchBlock =
  | { path: string; kind: 'replace'; search: string; replace: string }
  | { path: string; kind: 'full'; content: string }
  | { path: string; kind: 'append'; content: string };

export class PatchMatchError extends Error {
  public readonly path: string;
  public readonly search: string;
  constructor(path: string, search: string) {
    super(`Şu SEARCH bloğu dosyada bulunamadı: ${path}\n${search.slice(0, 500)}`);
    this.name = 'PatchMatchError';
    this.path = path;
    this.search = search;
  }
}

export class PatchValidationError extends Error {
  public readonly path: string;
  constructor(path: string, detail: string) {
    super(`Dosya türü doğrulaması başarısız (${path}): ${detail}`);
    this.name = 'PatchValidationError';
    this.path = path;
  }
}

export function parseAgentPatch(response: string, defaultPath = '', allowedPaths?: string[]): AgentPatchBlock[] {
  const raw = response.replace(/^\uFEFF/, '').trim();
  const fencedCode = [...raw.matchAll(/```(?:[\w+-]+)?\s*\r?\n([\s\S]*?)```/g)].map(match => match[1].trim()).filter(Boolean);
  const text = raw.replace(/```(?:[\w+-]+)?\s*\r?\n?/g, '').replace(/```/g, '').trim();
  const files = [...text.matchAll(/^FILE:\s*(.+?)\s*$/gim)];
  const blocks: AgentPatchBlock[] = [];
  const sections = files.length
    ? files.map((header, index) => ({ path: header[1].trim().replaceAll('\\', '/'), body: text.slice(header.index! + header[0].length, files[index + 1]?.index ?? text.length) }))
    : [{ path: defaultPath, body: text }];
  for (const section of sections) {
    const proposedPath = section.path;
    const validProposedPath = proposedPath && !proposedPath.startsWith('/') && !/^[a-z]:\//i.test(proposedPath) && !proposedPath.split('/').some(part => part === '..' || part === '');
    const allowedPath = allowedPaths?.find(candidate => candidate.replaceAll('\\', '/').toLocaleLowerCase('tr') === proposedPath.toLocaleLowerCase('tr'));
    const path = allowedPaths ? (allowedPath ?? (files.length ? proposedPath : defaultPath)) : (defaultPath || (validProposedPath ? proposedPath : ''));
    if (!path) continue;
    const body = section.body;
    const full = body.match(/<<<<<<< FULL FILE\r?\n([\s\S]*?)\r?\n>>>>>>> FULL FILE/);
    if (full) {
      blocks.push({ path, kind: 'full', content: full[1] });
      continue;
    }
    const searches = [...body.matchAll(/<<<<<<< SEARCH\r?\n([\s\S]*?)(?:\r?\n)?=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g)];
    for (const match of searches) blocks.push({ path, kind: 'replace', search: match[1], replace: match[2] });
  }
  if (!blocks.length && defaultPath) {
    const code = fencedCode[0] ?? (/(?:^\s*\/\/|^\s*#|^\s*<!--|^\s*<\?php|^\s*(?:import|export|function|const|let|var|return|Route::|class)\b)/m.test(text) ? text : '');
    if (code.trim()) blocks.push({ path: defaultPath, kind: 'append', content: code.trim() });
  }
  return blocks;
}

const normalize = (line: string) => line.trim().replace(/\s+/g, ' ');
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = normalize(a), right = normalize(b);
  if (!left || !right) return left === right ? 1 : 0;
  if (left.length * right.length > 250_000) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function findLines(lines: string[], search: string): { start: number; count: number } | null {
  const wanted = search.replace(/\r\n/g, '\n').split('\n');
  if (wanted.length === 1 && wanted[0] === '') return lines.length === 1 && lines[0] === '' ? { start: 0, count: 1 } : null;
  for (let start = 0; start <= lines.length - wanted.length; start++) {
    if (lines.slice(start, start + wanted.length).join('\n') === wanted.join('\n')) return { start, count: wanted.length };
  }
  const normalizedWanted = wanted.map(normalize);
  for (let start = 0; start <= lines.length - wanted.length; start++) {
    if (lines.slice(start, start + wanted.length).map(normalize).every((line, i) => line === normalizedWanted[i])) return { start, count: wanted.length };
  }
  // Fuzzy fallback: compare corresponding lines, and only accept a strong match.
  const windows = [...new Set([wanted.length, wanted.length - 1, wanted.length + 1])].filter(n => n > 0 && n <= lines.length);
  let best: { start: number; count: number; score: number } | null = null;
  for (const count of windows) for (let start = 0; start <= lines.length - count; start++) {
    const actual = lines.slice(start, start + count);
    const overlap = Math.min(wanted.length, actual.length);
    const rowScore = Array.from({ length: overlap }, (_, i) => similarity(wanted[i], actual[i])).reduce((sum, score) => sum + score, 0) / overlap;
    const lengthPenalty = Math.abs(wanted.length - actual.length) / Math.max(wanted.length, actual.length);
    const score = rowScore - lengthPenalty;
    if (score > (best?.score ?? 0)) best = { start, count, score };
  }
  return best && best.score > 0.85 ? { start: best.start, count: best.count } : null;
}

export function applyAgentPatch(original: string, blocks: AgentPatchBlock[], targetPath: string): string {
  let value = original;
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  for (const block of blocks) {
    if (block.path.toLowerCase() !== targetPath.replaceAll('\\', '/').toLowerCase()) throw new Error(`Agent yalnızca verilen dosya yolunu kullanmalı: ${targetPath}`);
    if (block.kind === 'full') { value = block.content; continue; }
    if (block.kind === 'append') { value = `${value.replace(/[\r\n]*$/, '')}${value ? newline : ''}${block.content.replace(/\r\n/g, '\n').replace(/\n/g, newline)}`; continue; }
    const lines = value.replace(/\r\n/g, '\n').split('\n');
    if (!block.search) {
      if (value) throw new PatchMatchError(block.path, block.search);
      value = block.replace;
      continue;
    }
    const found = findLines(lines, block.search);
    if (!found) throw new PatchMatchError(block.path, block.search);
    lines.splice(found.start, found.count, ...block.replace.replace(/\r\n/g, '\n').split('\n'));
    value = lines.join('\n');
  }
  value = value.replace(/\n/g, newline);
  if (/\.json$/i.test(targetPath)) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (/composer\.json$/i.test(targetPath) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('Composer manifest kökü bir nesne olmalı.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PatchValidationError(targetPath, `dosya geçerli JSON olmalı; composer.json kökü nesne olmalı. HTML, PHP veya açıklama metni JSON dosyasına yazılamaz. ${detail}`);
    }
  }
  if (/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i.test(targetPath) && (/<\?php|\bclass\s+\w+\s+extends\s+(?:migration|model)\b/i.test(value) || value.includes('use Illuminate\\Database\\'))) {
    throw new PatchValidationError(targetPath, 'JavaScript/TypeScript dosyasına PHP/Laravel sınıfı veya migration kodu yazılamaz.');
  }
  return value;
}
