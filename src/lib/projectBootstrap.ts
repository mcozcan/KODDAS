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

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLocaleLowerCase('tr');

/** Ignore a path when the user explicitly says to leave it untouched. */
export function isExplicitlyExcludedPath(prompt: string, path: string): boolean {
  const text = normalize(prompt.replaceAll('\\', '/'));
  const name = normalize(path.replaceAll('\\', '/'));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exclusions = /(?:do\s+not|don't|dont|never|avoid|exclude|leave\s+(?:it|this|the\s+file)\s+(?:alone|unchanged)|degistirme|dokunma|elleme|degisiklik\s+yapma|duzenleme\s+yapma|ayni\s+birak)/;
  for (const match of text.matchAll(new RegExp(escaped, 'g'))) {
    const start = match.index ?? 0;
    const context = text.slice(Math.max(0, start - 100), Math.min(text.length, start + name.length + 100));
    if (exclusions.test(context)) return true;
  }
  return false;
}

/** Conventional Laravel targets for a task CRUD feature, keeping manifests out of the edit set. */
export function inferLaravelTaskTargets(paths: string[], prompt: string): string[] {
  const text = normalize(prompt);
  const taskDomain = /\b(?:gorev|task)\w*\b/.test(text);
  const implementation = /\b(?:crud|ekle|olustur|listele|guncelle|sil|tamamla|veritabani|migration|model|controller|kaydet|complete)\w*\b/.test(text);
  if (!taskDomain || !implementation) return [];

  const normalizedPaths = paths.map(path => path.replaceAll('\\', '/'));
  const choose = (pattern: RegExp, fallback: string) => normalizedPaths.find(path => pattern.test(path)) ?? fallback;
  const targets = [
    choose(/^routes\/web\.php$/i, 'routes/web.php'),
    choose(/^app\/models\/task\.php$/i, 'app/Models/Task.php'),
    choose(/^app\/http\/controllers\/taskcontroller\.php$/i, 'app/Http/Controllers/TaskController.php'),
    choose(/^resources\/views\/tasks\/index\.blade\.php$/i, 'resources/views/tasks/index.blade.php'),
    choose(/^database\/migrations\/[^/]*create_tasks_table[^/]*\.php$/i, ''),
  ];
  const migrationIndex = targets.length - 1;
  if (!targets[migrationIndex]) {
    const day = new Date().toISOString().slice(0, 10).replaceAll('-', '_');
    let suffix = 0;
    let migration = '';
    do { migration = `database/migrations/${day}_${String(suffix++).padStart(6, '0')}_create_tasks_table.php`; }
    while (normalizedPaths.some(path => path.toLocaleLowerCase('tr') === migration.toLocaleLowerCase('tr')));
    targets[migrationIndex] = migration;
  }
  if (/\btest\w*\b/.test(text)) targets.push(choose(/^tests\/feature\/taskcrudtest\.php$/i, 'tests/Feature/TaskCrudTest.php'));
  return [...new Set(targets)];
}
