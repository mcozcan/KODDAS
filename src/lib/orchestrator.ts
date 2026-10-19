export type AgentTask = { role: string; task: string };
export type AgentPlan = { summary: string; tasks: AgentTask[] };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLocaleLowerCase('tr');

/** True for prompts that ask the coding agent to change or create project files. */
export function isCodingEditRequest(prompt: string): boolean {
  const text = normalize(prompt);
  return /\b(?:add|write|change|fix|delete|create|update|build|implement|install|setup|configure|refactor|develop|design|make|ekle|yaz|degistir|duzelt|sil|olustur|guncelle|kur|yukle|uygula|gelistir|tasarla|yap)\w*\b/.test(text)
    || /yorum\s+satir|comment\s+in/i.test(text);
}

/** Delegate coding requests that contain several requirements or a broad scope. */
export function shouldOrchestrate(prompt: string, targetCount: number): boolean {
  const text = normalize(prompt);
  const signals = [
    /\b(auth|authentication|login|register|dashboard|api|database|crud|deploy|migration|test|laravel|react|admin|responsive|animation|animasyon|homepage|ana\s+sayfa)\b/,
    /\b(kur\w*|olustur\w*|yaz\w*|ekle\w*|uygula\w*|tasarla\w*|gelistir\w*|yap\w*|build\w*|create\w*|implement\w*|design\w*|install\w*)\b/,
    /\b(ve\w*|ayrica\w*|sonra\w*|birlikte\w*|hem\w*|with|and|also|then)\b/,
  ].filter(pattern => pattern.test(text)).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const requirementSeparators = (text.match(/[;\n]|,\s|\b(?:ve|ayrica|sonra|also|then)\b/g) ?? []).length;
  return targetCount > 1 || requirementSeparators >= 2 || (words >= 12 && signals >= 2) || (words >= 30 && signals >= 1) || text.length >= 420;
}

/** Safely parse a bounded, ordered implementation plan. */
export function parseAgentPlan(raw: string): AgentPlan {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Ana ajan geçerli bir görev planı döndürmedi.');
  const parsed = JSON.parse(match[0]) as { summary?: unknown; tasks?: unknown };
  if (!Array.isArray(parsed.tasks)) throw new Error('Ana ajan planında tasks listesi eksik.');
  const tasks = parsed.tasks.slice(0, 3).map((item): AgentTask => {
    if (!item || typeof item !== 'object') throw new Error('Ajan görevi geçersiz.');
    const row = item as { role?: unknown; task?: unknown };
    if (typeof row.role !== 'string' || typeof row.task !== 'string' || !row.task.trim()) throw new Error('Ajan görevi eksik veya geçersiz.');
    return { role: row.role.slice(0, 40), task: row.task.trim().slice(0, 500) };
  });
  if (tasks.length < 2) throw new Error('Alt ajanlara ayrılabilecek en az iki bağımsız görev bulunamadı.');
  return { summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : 'İş çok adımlı olarak planlandı.', tasks };
}

export function buildPlannerPrompt(userTask: string, files: string[]): string {
  return `Group the user's coding request into 2 or 3 small implementation steps in dependency order. Every step must produce a concrete patch. Split by independent requirements such as setup, backend, UI, and validation. Never combine the full parent request into every step. Do not create research-only or review-only steps. Return JSON only: {"summary":"short Turkish plan","tasks":[{"role":"short specialist label","task":"one concrete implementation step"}]}. Do not write code. User request: ${userTask}\nAuthorized target files: ${files.slice(0, 20).join(', ')}`;
}

/** True when a planner or worker request could not fit its model context window. */
export function isContextBudgetError(error: unknown): boolean {
  return /PROMPT_WINDOW_EXHAUSTED|context.{0,30}(?:length|window|limit|budget)|(?:length|window|limit|budget).{0,30}context|num_ctx|bağlam.{0,30}(?:sınır|bütçe|sığ)|İstek gönderilmedi/i.test(String(error));
}

/** A local fallback: separate explicit requirements, then split by authorized files. */
export function splitAgentTask(task: string, files: string[] = []): AgentTask[] {
  const normalized = normalize(task);
  const semanticTasks: AgentTask[] = [];
  if (/\b(?:laravel|django|rails|symfony|next\.js|nextjs|react|vue)\b/.test(normalized)
      && /\b(?:kur|yukle|olustur|install|setup|create|build)\w*\b/.test(normalized)) {
    semanticTasks.push({ role: 'Proje kurulumu', task: 'İstenen framework ile proje iskeletini hedef proje kökünde kur; bağımlılık ve başlangıç yapılandırmasını hazırla.' });
  }
  const hasHome = /\b(?:ana\s*sayfa\w*|homepage|home\s+page|landing\s+page)\b/.test(normalized);
  if (hasHome && /\b(?:hosgeldin|welcome|mesaj|yaz|goster|content|text)\w*\b/.test(normalized)) {
    const welcome = task.match(/(?:(?:KODDAŞ|KODDAS)\s+[^,;\n.!?]{0,60}?(?:welcome|hoşgeldin|hosgeldin)|welcome\s+[^,;\n.!?]{0,60}|hoşgeldin\s+[^,;\n.!?]{0,60})/i)?.[0]?.trim();
    semanticTasks.push({ role: 'Ana sayfa', task: `Ana sayfa içeriğini oluştur${welcome ? `; istenen metni kullan: “${welcome}”` : ''}.` });
  }
  if (hasHome && /\b(?:animasyon|animated|animation)\w*\b/.test(normalized)) {
    semanticTasks.push({ role: 'Arayüz animasyonu', task: 'Ana sayfaya istekte belirtilen ölçülü ve akıcı animasyonları ekle.' });
  }
  if (hasHome && /\b(?:responsive|duyarli|mobil|mobile)\w*\b/.test(normalized)) {
    semanticTasks.push({ role: 'Responsive arayüz', task: 'Ana sayfayı mobil, tablet ve masaüstü ekranlara uyumlu hale getir.' });
  }
  if (semanticTasks.length >= 2) return semanticTasks.slice(0, 4);

  const explicitClauses = task.split(/\s*(?:;|\n|,|\b(?:and|ve|ayrıca|sonra|also|then)\b)\s*/i).map(part => part.trim()).filter(part => part.length >= 12);
  const actionClauses = task.split(/(?=\b(?:add|write|change|fix|create|update|build|implement|install|configure|design|ekle|yaz|degistir|duzelt|olustur|guncelle|kur|uygula|gelistir|tasarla)\w*\b)/i).map(part => part.trim()).filter(part => part.length >= 12);
  const clauses = explicitClauses.length >= 2 ? explicitClauses : actionClauses.length >= 2 ? actionClauses : explicitClauses;
  if (clauses.length >= 2) {
    const groupSize = Math.ceil(clauses.length / 3);
    const chunks = Array.from({ length: Math.min(3, clauses.length) }, (_, index) => clauses.slice(index * groupSize, (index + 1) * groupSize).join('; ')).filter(Boolean);
    return chunks.map((part, index) => ({ role: `Küçük adım ${index + 1}`, task: part }));
  }
  if (files.length > 1) {
    const splitAt = Math.ceil(files.length / 2);
    return [files.slice(0, splitAt), files.slice(splitAt)].filter(group => group.length).map((group, index) => ({ role: `Dosya grubu ${index + 1}`, task: `Bu görevin yalnızca şu yetkili dosyalarla ilgili kısmını uygula: ${group.join(', ')}. Değişikliği küçük tut.` }));
  }
  return [
    { role: 'Temel değişiklik', task: `İsteğin temel gereksinimini yalnızca yetkili hedefte çalışan en küçük değişiklikle uygula: ${task.slice(0, 220)}` },
    { role: 'Tamamlama', task: `Önceki taslak değişikliklerini koru ve henüz karşılanmayan gereksinimi tamamla: ${task.slice(0, 220)}` },
  ];
}

export function isResearchOnlyTask(task: string): boolean {
  const text=normalize(task);
  const hasImplementation=/\b(implement|create|build|add|write|change|update|fix|configure|refactor|install|design|code|olustur|ekle|yaz|degistir|guncelle|duzelt|kur|tasarla|uygula|gelistir)\w*\b/.test(text);
  const isResearch=/\b(inspect|review|analy[sz]e|research|explore|examine|understand|incele|analiz|arastir|gozden gecir)\w*\b/.test(text);
  return isResearch&&!hasImplementation;
}
