import { useEffect, useState } from 'react';

export function ThinkingMark(){return <span className="thinking-mark" aria-hidden="true"><svg viewBox="0 0 32 32" focusable="false"><path className="thinking-k" d="M8 6v20M8 16 23 6M8 16l15 10"/><path className="thinking-spark" d="M24 3.5c.7 3.1 1.5 3.9 4.5 4.5-3 .7-3.8 1.5-4.5 4.5-.7-3-1.5-3.8-4.5-4.5 3-.6 3.8-1.4 4.5-4.5Z"/></svg></span>}

export function ThinkingLabel({stage}:{stage:string}){const choices=stage==='Değişiklik hazırlıyor...'?['Değişiklik hazırlıyor...','Düşünüyor...']:stage==='Düşünüyor...'?['Düşünüyor...','Model yanıtı hazırlanıyor...']:[stage];const [index,setIndex]=useState(0);useEffect(()=>{setIndex(0);if(choices.length<2)return;const timer=window.setInterval(()=>setIndex(value=>(value+1)%choices.length),3200);return()=>window.clearInterval(timer);},[stage]);return <span key={`${stage}-${index}`}>{choices[index]??stage}</span>}
