import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { GpuMetric } from './lib/desktop';

export type GpuSample={time:number;usedMb:number|null;totalMb:number|null;utilizationPercent:number|null};
type Props={enabled:boolean;gpus:GpuMetric[];selectedId:string;onSelect:(id:string)=>void;history:GpuSample[]};
const gb=(value:number)=>`${(value/1024).toFixed(1)} GB`;
function points(values:number[],width=220,height=54){if(!values.length)return '';const max=Math.max(100,...values),min=Math.min(0,...values);return values.map((value,index)=>`${values.length===1?0:index/(values.length-1)*width},${height-((value-min)/(max-min||1))*height}`).join(' ');}

export function GpuStatus({enabled,gpus,selectedId,onSelect,history}:Props){
  const [open,setOpen]=useState(false);const gpu=gpus.find(item=>item.id===selectedId)??gpus[0];
  const usage=gpu?.totalMb&&gpu.usedMb!=null?Math.round(gpu.usedMb/gpu.totalMb*100):null;const color=usage==null?'unknown':usage>=90?'bad':usage>=70?'warn':'normal';
  const memoryValues=useMemo(()=>history.map(item=>item.totalMb&&item.usedMb!=null?item.usedMb/item.totalMb*100:0),[history]);const coreValues=useMemo(()=>history.map(item=>item.utilizationPercent??0),[history]);
  if(!enabled)return null;
  if(!gpu)return <span className="gpu-status unavailable" title="Ekran kartı algılanamadı; Ayarlar’dan VRAM’i elle girebilirsiniz.">GPU yok</span>;
  const tooltip=`${gpu.name}${gpu.temperatureC==null?'':` · ${gpu.temperatureC}°C`} · Ollama modeli: ${gpu.ollamaVramMb==null?'bilinmiyor':gb(gpu.ollamaVramMb)} · ${gpu.driver?`Sürücü ${gpu.driver}`:''} · Algılama: ${gpu.detection}`;
  return <div className="gpu-status-wrap"><button className={`gpu-status ${color}`} title={tooltip} onClick={()=>setOpen(value=>!value)}><Activity size={12}/><span>GPU {gpu.usedMb==null?'?':gb(gpu.usedMb)}/{gpu.totalMb==null?'?':gb(gpu.totalMb)} {usage==null?'':`(%${usage})`} · Kullanım %{Math.round(gpu.utilizationPercent??0)}</span></button>{open&&<div className="gpu-popover"><header><strong>{gpu.name}</strong><button onClick={()=>setOpen(false)}>×</button></header><p>{tooltip}</p>{gpus.length>1&&<select value={gpu.id} onChange={event=>onSelect(event.target.value)}>{gpus.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}<label>VRAM doluluk</label><svg viewBox="0 0 220 54" role="img" aria-label="Son 60 saniye VRAM grafiği"><polyline points={points(memoryValues)} fill="none" stroke="#64bd91" strokeWidth="2"/></svg><label>GPU çekirdek kullanımı</label><svg viewBox="0 0 220 54" role="img" aria-label="Son 60 saniye GPU kullanım grafiği"><polyline points={points(coreValues)} fill="none" stroke="#d0ad72" strokeWidth="2"/></svg><small>Son 60 saniye · 2 saniyede bir ölçüm</small></div>}</div>;
}
