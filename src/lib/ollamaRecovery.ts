export type OllamaFailureKind = 'oom'|'crash'|'memory'|'offline'|'context'|'other';
export type OllamaFailure = { kind:OllamaFailureKind; message:string; technical:string; code:string };

export class OllamaRecoveryError extends Error{
  readonly kind:OllamaFailureKind;readonly technical:string;readonly code:string;
  constructor(message:string,failure:OllamaFailure){super(message);this.name='OllamaRecoveryError';this.kind=failure.kind;this.technical=failure.technical;this.code=failure.code;}
}

export function classifyOllamaFailure(value:unknown):OllamaFailure{
  const technical=value instanceof Error?value.message:String(value);
  const normalized=technical.toLowerCase();
  const code=technical.match(/0x[0-9a-f]+|HTTP\s*\d{3}/i)?.[0]??'—';
  if(/out of memory|cudaMalloc failed|failed to allocate.*(?:buffer|cuda)|kv cache|cuda error.*memory/i.test(normalized))return{kind:'oom',message:'Ekran kartı belleği bu bağlam için yetersiz kaldı. Bağlam küçültülerek otomatik tekrar denenecek.',technical,code};
  if(/llama-server process has terminated|cuda error|0xc0000409|shared object initialization failed/i.test(technical))return{kind:'crash',message:'Model sunucusu çöktü (muhtemelen ekran kartı belleği yetmedi veya CUDA hatası).',technical,code};
  if(/model requires more system memory|not enough memory|insufficient memory|system memory/i.test(normalized))return{kind:'memory',message:'Model için yeterli sistem belleği yok. Daha küçük bir model deneyin veya çalışan uygulamaları kapatın.',technical,code};
  if(/connection refused|failed to connect|bağlantısı kurulamadı|econnrefused|actively refused/i.test(normalized))return{kind:'offline',message:'Ollama çalışmıyor veya bağlantı kabul etmiyor. Ollama’yı başlatıp yeniden deneyin.',technical,code};
  if(/context length|prompt is longer|num_ctx|context window/i.test(normalized))return{kind:'context',message:'İstek modelin bağlam sınırını aştı. Daha küçük bağlamla yeniden denenecek.',technical,code};
  return{kind:'other',message:technical.replace(/^Error:\s*/,'')||'Ollama isteği başarısız oldu.',technical,code};
}

export function lowerContext(current:number):number|undefined{
  if(current>16384)return 16384;
  if(current>8192)return 8192;
  if(current>4096)return 4096;
  if(current>2048)return 2048;
  return undefined;
}

export function lowerContextHalf(current:number):number|undefined{
  if(current<=2048)return undefined;
  return Math.max(2048,Math.floor(current/2));
}

export function selectVramContext(configured:number,requiredGb:(context:number)=>number,freeGb:number|null|undefined):number{
  let context=Math.min(32768,Math.max(2048,configured));
  if(freeGb==null||!Number.isFinite(freeGb))return context;
  while(requiredGb(context)>freeGb){const lower=lowerContext(context);if(!lower)return 2048;context=lower;}
  return context;
}

export function contextCandidates(current:number):number[]{
  const values=[current];let next=lowerContext(current);while(next){values.push(next);next=lowerContext(next);}return values;
}
