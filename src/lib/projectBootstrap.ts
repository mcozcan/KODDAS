export type ProjectRootEntry = { name: string };

export function isLaravelBootstrapRequest(mode: string, prompt: string): boolean {
  return mode === 'Agent'
    && /\blaravel\b/i.test(prompt)
    && /\b(oluştur\w*|kur\w*|başlat\w*|create\w*|install\w*)\b/i.test(prompt);
}

export function hasLaravelProject(entries: ProjectRootEntry[]): boolean {
  const names = new Set(entries.map(entry => entry.name.toLowerCase()));
  return names.has('artisan') && names.has('composer.json');
}

export function isLaravelHomeRequest(prompt: string): boolean {
  return /ana\s*sayfa|anasayfa|homepage|home\s*page|welcome/i.test(prompt);
}
