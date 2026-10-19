export type AgentTask = { role: string; task: string };
export type AgentPlan = { summary: string; tasks: AgentTask[] };

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLocaleLowerCase('tr');

/** Delegate only requests that clearly require several coordinated steps. */
export function shouldOrchestrate(prompt: string, targetCount: number): boolean {
  const text = normalize(prompt);
  const signals = [
    /\b(auth|authentication|login|register|dashboard|api|database|crud|deploy|migration|test|laravel|react|admin)\b/,
    /\b(kur\w*|olustur\w*|yap\w*|gelistir\w*|build\w*|create\w*|implement\w*)\b/,
    /\b(ve\w*|ayrica\w*|sonra\w*|birlikte\w*|hem\w*|with|and|also)\b/,
  ].filter(pattern => pattern.test(text)).length;
  return targetCount > 1 || (text.split(/\s+/).length >= 18 && signals >= 2);
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
  return `Group the user's coding request into 2 or 3 small implementation steps in dependency order. Each step must change a concrete part of the requested result; do not make research-only or review-only steps. Keep steps non-overlapping, short, and independently patchable. Return JSON only: {"summary":"short Turkish plan","tasks":[{"role":"short specialist label","task":"one concrete implementation step"}]}. Do not write code. User request: ${userTask}\nAuthorized target files: ${files.slice(0, 20).join(', ')}`;
}

/** A local, model-free fallback so an invalid/truncated splitter reply never collapses the job into one oversized request. */
export function splitAgentTask(task: string, files: string[] = []): AgentTask[] {
  const clauses = task.split(/\s*(?:;|\n|,|\b(?:and|ve|ayrıca|sonra)\b)\s*/i).map(part => part.trim()).filter(part => part.length >= 12);
  if (clauses.length >= 2) {
    const groupSize = Math.ceil(clauses.length / 3);
    const chunks = Array.from({ length: Math.min(3, clauses.length) }, (_, index) => clauses.slice(index * groupSize, (index + 1) * groupSize).join('; ')).filter(Boolean);
    return chunks.map((part, index) => ({ role: `Küçük adım ${index + 1}`, task: `Parent task: ${task.slice(0, 420)}\nImplement only this part as a short patch: ${part}. Preserve existing code and leave other requirements for later steps.` }));
  }
  if (files.length > 1) {
    const splitAt = Math.ceil(files.length / 2);
    return [files.slice(0, splitAt), files.slice(splitAt)].filter(group => group.length).map((group, index) => ({ role: `Dosya grubu ${index + 1}`, task: `Implement only the assigned portion of this task in these exact files: ${group.join(', ')}. Parent task: ${task.slice(0, 420)}. Keep the patch small and leave other files for later steps.` }));
  }
  return [
    { role: 'Temel değişiklik', task: `Parent task: ${task.slice(0, 420)}\nMake one minimal, working patch for the core requirement only in the authorized target. Leave secondary requirements for a later step.` },
    { role: 'Kalan gereksinimler', task: `Continue the parent task in the authorized target, preserving earlier draft changes. Add only one remaining explicit requirement that is still missing: ${task.slice(0, 420)}. Keep this patch small.` },
  ];
}

export function isResearchOnlyTask(task: string): boolean {
  const text=normalize(task);
  const hasImplementation=/\b(implement|create|build|add|write|change|update|fix|configure|refactor|install|design|code|olustur|ekle|yaz|degistir|guncelle|duzelt|kur|tasarla|uygula|gelistir)\w*\b/.test(text);
  const isResearch=/\b(inspect|review|analy[sz]e|research|explore|examine|understand|incele|analiz|arastir|gozden gecir)\w*\b/.test(text);
  return isResearch&&!hasImplementation;
}
