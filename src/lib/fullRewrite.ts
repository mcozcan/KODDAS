export function isFullRewriteRequest(prompt:string):boolean{
  return /(?:t[uü]m\s+(?:kodlar[ıi]|i[cç]eri[gğ]i|dosyay[ıi])\s+(?:sil|silip)|ba[sş]tan\s+yaz|tamamen\s+(?:yeniden\s+)?yaz|komple\s+(?:yeniden\s+)?yaz|\b(?:yeni|s[ıi]f[ıi]rdan)\s+(?:[\w.-]+\.(?:html?|php)\s+)?tasar[ıi]m[ıi]?\s+(?:olu[sş]tur|yap|haz[ıi]rla)\w*|rewrite\s+(?:the\s+)?entire|from\s+scratch)/i.test(prompt);
}

export function extractFullHtml(response:string):string|null{
  const value=response.replace(/^\uFEFF/,'').trim();
  const fenced=value.match(/^```(?:html)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  const html=(fenced?.[1]??value).trim();
  return /<!doctype\s+html|<html\b/i.test(html)&&/<\/html\s*>/i.test(html)?html:null;
}

export function requiredVisibleText(prompt:string):string|null{
  const quoted=prompt.match(/["“']([^"”']{1,80})["”']\s+yazan\b/i);
  const located=prompt.match(/(?:oraya|ekrana|sayfaya)\s+(.{1,80}?)\s+yazan\b/i);
  const text=(quoted?.[1]??located?.[1]??'').trim().replace(/[.,!?;:]+$/,'').replace(/\s+/g,' ');
  return text||null;
}

export function ensureAnimatedText(html:string,text:string|null):string{
  if(!text)return html;
  const plain=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&');
  if(plain.toLocaleLowerCase('tr').includes(text.toLocaleLowerCase('tr')))return html;
  const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const style='<style>.koddas-required-animated-text{position:fixed;z-index:2147483000;left:50%;bottom:8vh;transform:translateX(-50%);padding:.65em 1.2em;border:1px solid #f0a34a88;border-radius:999px;background:#171923ee;color:#ffd18b;font:700 clamp(18px,4vw,34px)/1.2 system-ui,sans-serif;letter-spacing:.04em;text-shadow:0 0 16px #ff9a3c;box-shadow:0 0 28px #ff9a3c55;animation:koddas-required-pulse 1.8s ease-in-out infinite}@keyframes koddas-required-pulse{0%,100%{scale:.96;opacity:.82}50%{scale:1.04;opacity:1}}@media(prefers-reduced-motion:reduce){.koddas-required-animated-text{animation:none}}</style>';
  const element=`<div class="koddas-required-animated-text" aria-label="${escape(text)}">${escape(text)}</div>`;
  const withStyle=/<\/head\s*>/i.test(html)?html.replace(/<\/head\s*>/i,`${style}</head>`):`${style}${html}`;
  return /<body\b[^>]*>/i.test(withStyle)?withStyle.replace(/<body\b[^>]*>/i,match=>`${match}${element}`):withStyle.replace(/<\/html\s*>/i,`${element}</html>`);
}
