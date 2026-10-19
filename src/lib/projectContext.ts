const GUIDE_NAMES = new Set([
  'agents.md', 'claude.md', 'gemini.md', 'koddas.md', 'contributing.md', 'readme.md',
]);

const normalizePath = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '').toLocaleLowerCase('tr');
const normalizeWords = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLocaleLowerCase('tr');

/** Pick repository guidance plus instructions that apply to one of the target files. */
export function selectProjectGuides(paths: string[], targetPaths: string[] = [], limit = 12): string[] {
  const targets = targetPaths.map(normalizePath);
  const candidates = paths.map(path => ({ path, normalized: normalizePath(path), name: normalizePath(path).split('/').pop() ?? '' }))
    .filter(item => GUIDE_NAMES.has(item.name) || item.normalized === '.github/copilot-instructions.md' || item.name === '.cursorrules');
  return candidates.filter(item => {
    const directory = item.normalized.includes('/') ? item.normalized.slice(0, item.normalized.lastIndexOf('/')) : '';
    if (!directory) return true;
    if (item.normalized === '.github/copilot-instructions.md') return true;
    return targets.some(target => target === item.normalized || target.startsWith(`${directory}/`));
  }).sort((a, b) => {
    const rank = (item: typeof candidates[number]) => item.normalized === 'agents.md' ? 0 : item.normalized === 'readme.md' ? 2 : 1;
    return rank(a) - rank(b) || a.normalized.split('/').length - b.normalized.split('/').length || a.normalized.localeCompare(b.normalized);
  }).slice(0, limit).map(item => item.path);
}

const FILE_TYPES = /\.(?:php|blade\.php|html?|css|scss|less|js|jsx|ts|tsx|vue|svelte|py|rs|go|java|cs|md|json|ya?ml|toml)$/i;
const COMMON_WORDS = new Set('the and for with that this from into when then make create change update fix add new page app code file project please olan için bunu şunu yapar misin istiyorum'.split(' '));

/** Rank source files by request/path overlap and conventional entry-point relevance. */
export function rankRelevantProjectFiles(paths: string[], prompt: string, excludedPaths: string[] = [], limit = 4): string[] {
  const excluded = new Set(excludedPaths.map(normalizePath));
  const words = normalizeWords(prompt).match(/[a-z0-9_]+/g)?.filter(word => word.length > 2 && !COMMON_WORDS.has(word)) ?? [];
  const uniqueWords = [...new Set(words)];
  const ranked = paths.filter(path => FILE_TYPES.test(path) && !excluded.has(normalizePath(path))).map(path => {
    const normalized = normalizeWords(path.replaceAll('\\', '/'));
    const basename = normalized.split('/').pop() ?? normalized;
    let score = 0;
    for (const word of uniqueWords) {
      if (basename.includes(word)) score += 8;
      else if (normalized.includes(word)) score += 4;
    }
    if (/readme|composer\.json|package\.json|routes\/web\.php/.test(normalized)) score += 2;
    if (/resources\/views|templates|pages|views/.test(normalized)) score += 2;
    if (/index|home|welcome|landing|layout|app|main|page|header|footer|style|global/.test(basename)) score += 1;
    return { path, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.slice(0, limit).map(item => item.path);
}

/** Select an edit target only when the user's words actually match its path. */
export function findBestTargetFile(paths: string[], prompt: string, excludedPaths: string[] = []): string | undefined {
  const excluded = new Set(excludedPaths.map(normalizePath));
  const normalizedPrompt = normalizeWords(prompt);
  const words = normalizedPrompt.match(/[a-z0-9_]+/g)?.filter(word => word.length > 2 && !COMMON_WORDS.has(word)) ?? [];
  if (/ana\s*sayfa|anasayfa|homepage|landing/.test(normalizedPrompt)) words.push('home', 'welcome', 'index', 'landing');
  if (/giriş|login|oturum|signin/.test(normalizedPrompt)) words.push('login', 'auth', 'signin');
  if (/tasarım|görünüm|stil|style/.test(normalizedPrompt)) words.push('view', 'style', 'css', 'layout');
  const uniqueWords = [...new Set(words)];
  if (!uniqueWords.length) return undefined;
  const ranked = paths.filter(path => FILE_TYPES.test(path) && !excluded.has(normalizePath(path))).map(path => {
    const normalized = normalizeWords(path.replaceAll('\\', '/'));
    const basename = normalized.split('/').pop() ?? normalized;
    return { path, score: uniqueWords.reduce((score, word) => score + (basename.includes(word) ? 8 : normalized.includes(word) ? 4 : 0), 0) };
  }).filter(item => item.score >= 4).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked[0]?.path;
}
