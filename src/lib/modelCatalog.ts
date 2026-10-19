import catalog from '../data/modelCatalog.json' with { type: 'json' };

export type ModelCatalogEntry={name:string;parameters:string;downloadGb:number;weightsGb:number;description:string;uses:string[];kvGbPer8k:number};
export type GpuCapacity={totalMb?:number|null;freeMb?:number|null};
export type Compatibility={requiredGb:number;totalGb:number|null;freeGb:number|null;status:'comfortable'|'tight'|'wontFit'|'unknown';reason:string};
export const MODEL_CATALOG=catalog as ModelCatalogEntry[];

export function modelVramProfile(name:string,actualBytes?:number):ModelCatalogEntry|undefined{
  const normalized=name.toLowerCase();
  const known=MODEL_CATALOG.find(entry=>normalized===entry.name.toLowerCase())??MODEL_CATALOG.filter(entry=>normalized.startsWith(entry.name.toLowerCase()+':')||normalized.startsWith(entry.name.toLowerCase()+'-')).sort((a,b)=>b.name.length-a.name.length)[0];
  if(known)return actualBytes&&actualBytes>0?{...known,weightsGb:actualBytes/1e9}:known;
  if(!actualBytes||actualBytes<=0)return undefined;
  const weightsGb=actualBytes/1e9;
  return{name,parameters:'Bilinmiyor',downloadGb:weightsGb,weightsGb,description:'Ollama etiketinden ölçülen model boyutu.',uses:['Agent','Sohbet'],kvGbPer8k:Math.max(0.25,weightsGb*0.065)};
}

export function estimateRequiredVram(model:ModelCatalogEntry,numCtx:number,actualBytes?:number){
  const weights=(actualBytes&&actualBytes>0?actualBytes/1e9:model.weightsGb);
  return Number((weights+1.5+model.kvGbPer8k*(numCtx/8192)).toFixed(1));
}

export function checkCompatibility(model:ModelCatalogEntry,gpu:GpuCapacity|undefined,numCtx:number,actualBytes?:number):Compatibility{
  const requiredGb=estimateRequiredVram(model,numCtx,actualBytes);const totalGb=gpu?.totalMb==null?null:Number((gpu.totalMb/1024).toFixed(1));const freeGb=gpu?.freeMb==null?totalGb:Number((gpu.freeMb/1024).toFixed(1));
  if(totalGb==null)return{requiredGb,totalGb,freeGb,status:'unknown',reason:'Ekran kartı algılanamadı'};
  if(freeGb!=null&&requiredGb<freeGb*0.85)return{requiredGb,totalGb,freeGb,status:'comfortable',reason:'Rahat çalışır'};
  if(requiredGb<=totalGb)return{requiredGb,totalGb,freeGb,status:'tight',reason:'Sınırda'};
  return{requiredGb,totalGb,freeGb,status:'wontFit',reason:'Sığmaz'};
}

export function suggestedModel(entries:ModelCatalogEntry[],compatibility:(entry:ModelCatalogEntry)=>Compatibility):ModelCatalogEntry|undefined{
  const agents=entries.filter(entry=>entry.uses.includes('Agent')).sort((a,b)=>b.weightsGb-a.weightsGb);
  return agents.find(entry=>compatibility(entry).status==='comfortable')??agents.find(entry=>compatibility(entry).status==='tight');
}
