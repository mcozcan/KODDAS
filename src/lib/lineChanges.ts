export type LineHunk = { originalStart: number; originalCount: number; modifiedStart: number; modifiedCount: number };

export function diffLines(before: string, after: string): { added: number; removed: number; hunks: LineHunk[] } {
  if (before === after) return { added: 0, removed: 0, hunks: [] };
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const n = a.length, m = b.length;
  if ((n + 1) * (m + 1) > 2_000_000) {
    let start = 0;
    while (start < n && start < m && a[start] === b[start]) start++;
    let ae = n, be = m;
    while (ae > start && be > start && a[ae - 1] === b[be - 1]) { ae--; be--; }
    return { added: be - start, removed: ae - start, hunks: [{ originalStart: start + 1, originalCount: ae - start, modifiedStart: start + 1, modifiedCount: be - start }] };
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  }
  const hunks: LineHunk[] = [];
  let i = 0, j = 0, startA = -1, startB = -1;
  const flush = () => { if (startA >= 0) { hunks.push({ originalStart: startA + 1, originalCount: i - startA, modifiedStart: startB + 1, modifiedCount: j - startB }); startA = startB = -1; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (startA < 0) { startA = i; startB = j; }
    if (j >= m || (i < n && table[(i + 1) * width + j] >= table[i * width + j + 1])) i++;
    else j++;
  }
  flush();
  return { added: hunks.reduce((sum, hunk) => sum + hunk.modifiedCount, 0), removed: hunks.reduce((sum, hunk) => sum + hunk.originalCount, 0), hunks };
}

export function lineChanges(before: string, after: string) {
  const diff = diffLines(before, after);
  const firstLine = diff.hunks[0]?.modifiedStart ?? 1;
  const last = diff.hunks[diff.hunks.length - 1];
  return { ...diff, firstLine, lastLine: last ? last.modifiedStart + last.modifiedCount - (last.modifiedCount === 0 ? 1 : 0) : 0 };
}

export function revertLineHunk(before: string, after: string, hunk: LineHunk): string {
  const newline = after.includes('\r\n') ? '\r\n' : '\n';
  const original = before.replace(/\r\n/g, '\n').split('\n');
  const modified = after.replace(/\r\n/g, '\n').split('\n');
  modified.splice(Math.max(0, hunk.modifiedStart - 1), hunk.modifiedCount, ...original.slice(Math.max(0, hunk.originalStart - 1), Math.max(0, hunk.originalStart - 1) + hunk.originalCount));
  return modified.join('\n').replace(/\n/g, newline);
}
