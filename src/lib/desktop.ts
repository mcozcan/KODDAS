import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

export const desktop = isTauri();
async function localFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}
export type Entry = { name: string; path: string; is_dir: boolean; size: number | null };
export type GpuMetric = { id:string;name:string;totalMb:number|null;usedMb:number|null;freeMb:number|null;utilizationPercent:number|null;temperatureC:number|null;driver:string|null;detection:string;ollamaVramMb:number|null };
export type Hardware = { gpu_name: string | null; vram_total_mb: number | null; vram_free_mb: number | null; driver: string | null; cuda: boolean; cpu: string; ram_total_mb: number; os: string; gpus:GpuMetric[] };

export async function chooseProject(): Promise<string | null> {
  if (!desktop) return window.prompt('Proje klasörünün tam yolunu girin (Tauri masaüstü sürümünde klasör seçici açılır):');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title: 'Proje klasörünü aç' });
  if (typeof result === 'string') await invoke('set_workspace', { path: result });
  return typeof result === 'string' ? result : null;
}

export const listDirectory = (path: string, hidden = false) => invoke<Entry[]>('list_directory', { path, showHidden: hidden });
export const setWorkspace = (path: string) => invoke<void>('set_workspace', { path });
export const clearWorkspace = () => desktop ? invoke<void>('clear_workspace') : Promise.resolve();
export const readFile = (path: string) => invoke<string>('read_file', { path });
export const writeFile = (path: string, content: string) => invoke<void>('write_file', { path, content });
export const pathExists = (path: string) => invoke<boolean>('path_exists', { path });
export const backupFile = (path: string) => invoke<string>('backup_file', { path });
export const restoreBackupFile = (path: string, backup: string) => invoke<void>('restore_backup_file', { path, backup });
export const deleteFile = (path: string) => invoke<void>('delete_file', { path });
export const createFolder = (path: string) => invoke<void>('create_folder', { path });
export const getHardware = () => invoke<Hardware>('get_hardware');
export const getGpuMetrics = () => invoke<GpuMetric[]>('get_gpu_metrics');
export const setGpuSamplerInterval = (seconds:number) => invoke<void>('set_gpu_sampler_interval',{seconds});
export async function deleteModel(baseUrl:string,name:string){if(desktop)return invoke<void>('ollama_delete',{name});const response=await fetch(`${baseUrl.replace(/\/$/,'')}/api/delete`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});if(!response.ok)throw new Error(`Model silinemedi: HTTP ${response.status}`);}
export const ensureOllama = () => invoke<'running'|'started'|'starting'|'missing'>('ensure_ollama');
export const waitOllamaReady = async(baseUrl:string,attempts=3)=>{if(desktop)return invoke<boolean>('ollama_wait_ready',{attempts});for(let attempt=0;attempt<attempts;attempt++){try{const response=await fetch(`${baseUrl.replace(/\/$/,'')}/api/tags`,{signal:AbortSignal.timeout(2000)});if(response.ok)return true;}catch{}if(attempt+1<attempts)await new Promise(resolve=>window.setTimeout(resolve,1300));}return false;};
export const unloadOllamaModel = async(baseUrl:string,name:string)=>{if(desktop)return invoke<void>('ollama_unload_model',{name});const response=await fetch(`${baseUrl.replace(/\/$/,'')}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:name,prompt:'',stream:false,keep_alive:0}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Model bellekten çıkarılamadı: HTTP ${response.status}`);};
export const restartOllama = ()=>desktop?invoke<string>('restart_ollama'):Promise.reject(new Error('Ollama otomatik yeniden başlatma yalnızca masaüstü uygulamasında kullanılabilir.'));
export const getOllamaDiagnostics=()=>desktop?invoke<string>('ollama_diagnostics'):Promise.reject(new Error('Tanılama masaüstü sürümünde kullanılabilir.'));
export const logAgentRaw=(model:string,prompt:string,response:string)=>desktop?invoke<string>('log_agent_raw',{model,prompt,response}):Promise.resolve('console');
export const cancelOllamaChat=(requestId:string)=>desktop?invoke<void>('ollama_cancel_chat',{requestId}):Promise.resolve();
export const isOllamaModelLoaded=(name:string)=>desktop?invoke<boolean>('ollama_model_loaded',{name}):fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(2000)}).then(response=>response.json()).then((data:{models?:{name:string}[]})=>!!data.models?.some(item=>item.name.toLowerCase()===name.toLowerCase())).catch(()=>false);
export const installOllama = () => invoke<'installer'>('install_ollama');
export type TerminalShell = 'default'|'powershell'|'cmd'|'git-bash'|'wsl'|'bash'|'zsh'|'sh';
export const terminalShellOptions: {value:TerminalShell;label:string}[] = /win/i.test(`${navigator.platform} ${navigator.userAgent}`)
  ? [{value:'powershell',label:'PowerShell'},{value:'cmd',label:'cmd'},{value:'git-bash',label:'Git Bash'},{value:'wsl',label:'WSL'}]
  : [{value:'default',label:'Sistem varsayılanı'},{value:'bash',label:'Bash'},{value:'zsh',label:'Zsh'},{value:'sh',label:'sh'}];
export function savedTerminalShell():TerminalShell{
  const saved=localStorage.getItem('koddas.terminalShell') as TerminalShell|null;
  return terminalShellOptions.some(option=>option.value===saved)?saved!:terminalShellOptions[0].value;
}
export type TerminalEvent = { output?: string | null; exited: boolean; error?: string | null };
export const spawnTerminal = (id: string, cwd: string, shell: TerminalShell, cols: number, rows: number, onOutput: Channel<TerminalEvent>) => invoke<void>('terminal_spawn', { id, cwd, shell, cols, rows, onOutput });
export async function createLaravelProject(workspacePath:string,onProgress:(line:string)=>void){const channel=new Channel<string>();channel.onmessage=onProgress;return invoke<string>('laravel_create_project',{workspacePath,onProgress:channel});}
export type GitChange = { path: string; status: string; before: string; after: string };
export const getGitChanges = (cwd: string) => invoke<GitChange[] | null>('get_git_changes', { cwd });

export type OllamaModel = { name: string; size: number; modified_at: string; details?: { parameter_size?: string; quantization_level?: string; family?: string } };
export async function getModels(baseUrl: string): Promise<OllamaModel[]> {
  if (desktop) return invoke<OllamaModel[]>('ollama_models');
  const response = await localFetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3500) });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  return ((await response.json()) as { models?: OllamaModel[] }).models ?? [];
}
export type OllamaRunningModel = { name:string; size:number; size_vram:number };
export async function getOllamaRunningModels(baseUrl:string):Promise<OllamaRunningModel[]>{
  if(desktop)return invoke<OllamaRunningModel[]>('ollama_running_models');
  const response=await localFetch(`${baseUrl.replace(/\/$/,'')}/api/ps`,{signal:AbortSignal.timeout(1500)});
  if(!response.ok)throw new Error(`Ollama /api/ps HTTP ${response.status}`);
  return ((await response.json()) as {models?:OllamaRunningModel[]}).models??[];
}

export type OllamaRunStats = { doneReason: string; promptEvalCount?: number; evalCount?: number; loadDuration?:number; promptEvalDuration?:number; evalDuration?:number };
export async function streamOllama(baseUrl: string, model: string, messages: { role: string; content: string }[], onToken: (token: string) => void, signal?: AbortSignal, options: { numCtx?: number; numPredict?: number; temperature?: number; requestId?: string; numGpu?:number; flashAttn?:boolean; format?:'json'; think?:boolean } = {}): Promise<OllamaRunStats> {
  if (desktop) {
    const channel=new Channel<{token?:string;done?:boolean;doneReason?:string;promptEvalCount?:number;evalCount?:number;loadDuration?:number;promptEvalDuration?:number;evalDuration?:number}>();let stats:OllamaRunStats={doneReason:'stop'};
    channel.onmessage=event=>{if(event.token)onToken(event.token);if(event.doneReason)stats={doneReason:event.doneReason,promptEvalCount:event.promptEvalCount,evalCount:event.evalCount,loadDuration:event.loadDuration,promptEvalDuration:event.promptEvalDuration,evalDuration:event.evalDuration};};
    await invoke<void>('ollama_chat',{model,messages,numCtx:Math.max(2048,options.numCtx??16384),numPredict:Math.max(1,options.numPredict??2048),temperature:Math.max(0,Math.min(0.2,options.temperature??0.15)),format:options.format,think:options.think,requestId:options.requestId??crypto.randomUUID(),numGpu:options.numGpu,flashAttn:options.flashAttn,onToken:channel});return stats;
  }
  const response = await localFetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true, ...(options.format?{format:options.format}:{}), ...(options.think==null?{}:{think:options.think}), options: { num_ctx: Math.max(2048,options.numCtx??16384), num_predict: Math.max(1,options.numPredict??2048), temperature: Math.max(0,Math.min(0.2,options.temperature??0.15)), ...(options.numGpu==null?{}:{num_gpu:options.numGpu}), ...(options.flashAttn==null?{}:{flash_attn:options.flashAttn}) } }), signal });
  if (!response.ok || !response.body) { const body=await response.text().catch(()=>"");throw new Error(`Ollama HTTP ${response.status}${body?`: ${body}`:''}`); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';let stats:OllamaRunStats={doneReason:'stop'};
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) { const part = JSON.parse(line) as { message?: { content?: string }; error?: string; done_reason?:string;prompt_eval_count?:number;eval_count?:number;load_duration?:number;prompt_eval_duration?:number;eval_duration?:number }; if (part.error) throw new Error(part.error); if (part.message?.content) onToken(part.message.content); if(part.done_reason)stats={doneReason:part.done_reason,promptEvalCount:part.prompt_eval_count,evalCount:part.eval_count,loadDuration:part.load_duration,promptEvalDuration:part.prompt_eval_duration,evalDuration:part.eval_duration}; }
  }
  if(buffer.trim()){const part=JSON.parse(buffer) as {message?:{content?:string};done_reason?:string;prompt_eval_count?:number;eval_count?:number;load_duration?:number;prompt_eval_duration?:number;eval_duration?:number};if(part.message?.content)onToken(part.message.content);if(part.done_reason)stats={doneReason:part.done_reason,promptEvalCount:part.prompt_eval_count,evalCount:part.eval_count,loadDuration:part.load_duration,promptEvalDuration:part.prompt_eval_duration,evalDuration:part.eval_duration};}
  return stats;
}

export type PullProgress = { status: string; completed?: number; total?: number };
export async function pullModel(baseUrl: string, name: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal) {
  if (desktop) {
    const channel=new Channel<PullProgress>();channel.onmessage=onProgress;
    await invoke<void>('ollama_pull',{name,onProgress:channel});return;
  }
  const response = await localFetch(`${baseUrl.replace(/\/$/, '')}/api/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: true }), signal,
  });
  if (!response.ok || !response.body) throw new Error(`Model indirme isteği başarısız: HTTP ${response.status}`);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) {
      const progress = JSON.parse(line) as PullProgress & { error?: string };
      if (progress.error) throw new Error(progress.error);
      onProgress(progress);
    }
    if (done) break;
  }
  if (buffer.trim()) { const final = JSON.parse(buffer) as PullProgress & { error?: string }; if (final.error) throw new Error(final.error); onProgress(final); }
}
