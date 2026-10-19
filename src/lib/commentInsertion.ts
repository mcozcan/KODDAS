export type InsertIntent = {
  action: 'insert';
  file: string | null;
  position: 'top' | 'bottom' | 'after_open_tag';
  kind: 'comment' | 'code';
  text: string;
};

export const INTENT_EXAMPLES: InsertIntent[] = [
  { action: 'insert', file: 'web.php', kind: 'comment', position: 'after_open_tag', text: 'basayım apoya' },
  { action: 'insert', file: 'index.php', kind: 'comment', position: 'top', text: 'deneme 1' },
  { action: 'insert', file: null, kind: 'comment', position: 'bottom', text: 'bitti' },
  { action: 'insert', file: 'web.php', kind: 'comment', position: 'after_open_tag', text: 'hello world' },
];
export const INTENT_FEW_SHOTS = [
  { prompt: 'web.php içinde yorum satırında basayım apoya yaz', intent: INTENT_EXAMPLES[0] },
  { prompt: 'index.php en üstüne test yorumu ekle: deneme 1', intent: INTENT_EXAMPLES[1] },
  { prompt: 'en alta bitti yaz', intent: INTENT_EXAMPLES[2] },
  { prompt: 'web.php içine git be yorum olarak hello world yaz', intent: INTENT_EXAMPLES[3] },
];

export function isSimpleCommentRequest(prompt: string): boolean {
  const hasInsertVerb = /\b(?:yaz\w*|ekle\w*|bas\w*|oluştur\w*|add|write|append|insert)\b/i.test(prompt);
  const hasInsertLocation = /\b(?:en\s+üst|en\s+başı|başa|başına|başlangıca|en\s+alt|en\s+alta|sona|sonuna|içine|satırına|after|top|bottom)\b/i.test(prompt);
  const hasComment = /yorum|comment|\/\/|<!--|#\s*\S/i.test(prompt);
  return hasInsertVerb && (hasComment || hasInsertLocation);
}

export function parseInsertIntent(value: unknown): InsertIntent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<InsertIntent>;
  if (item.action !== 'insert' || !['top', 'bottom', 'after_open_tag'].includes(item.position ?? '')
    || !['comment', 'code'].includes(item.kind ?? '') || typeof item.text !== 'string'
    || (item.file !== null && typeof item.file !== 'string')) return null;
  const text = item.text.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 500 || /\b(?:yazdır|ekle|içine|yorum\s+satırında)\b/i.test(text)) return null;
  return { action: 'insert', file: item.file ?? null, position: item.position!, kind: item.kind!, text };
}

export function parseIntentJson(response: string): InsertIntent | null {
  const cleaned = response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return parseInsertIntent(JSON.parse(cleaned)); } catch { return null; }
}

function removeCommandTail(text: string): string {
  return text.replace(/\s+(?:lütfen\s+)?(?:yazdır|yaz|ekle|oluştur|bas|kaydet|print|append)(?:\s+olarak)?\s*[.!?]*\s*$/i, '')
    .replace(/^[\s:;,"'“”]+|[\s:;,"'“”]+$/g, '').trim();
}

export function extractRequestedComment(prompt: string): string | null {
  const fileless = prompt.replace(/\b[\w./-]+\.(?:php|html?|css|scss|less|js|jsx|ts|tsx|vue|svelte|py|rs|go|java|cs|md|json)\b/gi, ' ');
  const colon = /:\s*([^\r\n]+)$/.exec(fileless);
  if (colon) return removeCommandTail(colon[1]) || null;

  const marker = /yorum\s+satırında\b|yorum\s+satırına\b|yorum\s+satırı\s+olarak\b|yorum\s+olarak\b|comment\s+as\b/i.exec(fileless);
  if (marker) return removeCommandTail(fileless.slice(marker.index + marker[0].length)) || null;

  const explicit = /(?:\/\/|#|<!--)\s*([^\r\n]+?)(?:\s+(?:yazdır|yaz|ekle|bas|oluştur)\s*)?$/i.exec(fileless);
  if (explicit) return removeCommandTail(explicit[1]) || null;

  const position = /(?:en\s+alta|en\s+üste|en\s+üstüne|en\s+başa|sona|başına)\s+(.+)$/i.exec(fileless);
  if (position) return removeCommandTail(position[1].replace(/^(?:yorum(?:\s+olarak)?\s+)?/i, '')) || null;
  return null;
}

export function formatSourceComment(path: string, text: string): string {
  const value = text.trim().replace(/\s+/g, ' ');
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'html' || extension === 'htm') return `<!-- ${value} -->`;
  if (['py', 'rb', 'sh', 'yml', 'yaml', 'toml', 'pl'].includes(extension ?? '')) return `# ${value}`;
  if (extension === 'sql') return `-- ${value}`;
  return `// ${value}`;
}

export function insertionLine(before: string, path: string, position: InsertIntent['position'], cursorLine = 1): number {
  const rawLines = before.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const phpOpenLine = /\.php$/i.test(path) ? rawLines.findIndex((line, index) => index < 5 && /^\s*<\?php\b/i.test(line)) : -1;
  if (position === 'top') return phpOpenLine >= 0 ? phpOpenLine + 2 : 1;
  if (position === 'after_open_tag') return phpOpenLine >= 0 ? phpOpenLine + 2 : 1;
  if (position === 'bottom') return Math.max(1, rawLines.length - (rawLines[rawLines.length-1] === '' ? 1 : 0) + 1);
  return Math.max(1, Math.min(rawLines.length + 1, cursorLine));
}

export function preserveFileFormat(working: string, disk: string): string {
  const hasBom = disk.startsWith('\uFEFF');
  const withoutBom = working.replace(/^\uFEFF/, '');
  const newline = disk.includes('\r\n') ? '\r\n' : '\n';
  const normalized = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const formatted = newline === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
  return hasBom ? `\uFEFF${formatted}` : formatted;
}

export function insertIntent(before: string, path: string, intent: InsertIntent, cursorLine = 1): string {
  const formattedBefore = preserveFileFormat(before, before);
  const newline = formattedBefore.includes('\r\n') ? '\r\n' : '\n';
  const hadBom = formattedBefore.startsWith('\uFEFF');
  const body = hadBom ? formattedBefore.slice(1) : formattedBefore;
  const hadTrailingNewline = /\r?\n$/.test(body);
  const lines = body.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') lines.length = 0;
  const comment = intent.kind === 'comment' ? formatSourceComment(path, intent.text) : intent.text;
  const pos = intent.position === 'after_open_tag' && !/\.php$/i.test(path) ? 'top' : intent.position;
  const line = insertionLine(formattedBefore, path, pos, cursorLine);
  const index = Math.max(0, Math.min(lines.length, line - 1));
  lines.splice(index, 0, comment);
  const output = lines.join(newline);
  const finalBody = hadTrailingNewline || !body ? `${output}${newline}` : output;
  return hadBom ? `\uFEFF${finalBody}` : finalBody;
}

export function insertRequestedComment(before: string, path: string, prompt: string, cursorLine = 1): string | null {
  const text = extractRequestedComment(prompt);
  if (!text) return null;
  const isTop = /\b(?:en\s+üst|en\s+başı|başa|başına|başlangıca|top)\b/i.test(prompt);
  const isBottom = /\b(?:en\s+alt|en\s+alta|sona|sonuna|bottom|end)\b/i.test(prompt);
  const position = isBottom ? 'bottom' : isTop ? 'top' : /\.php$/i.test(path) ? 'after_open_tag' : 'bottom';
  return insertIntent(before, path, { action: 'insert', file: path, position, kind: 'comment', text }, cursorLine);
}
