use serde::Serialize;
use serde_json::Value;
use futures_util::StreamExt;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use std::{collections::HashMap, fs, io::{BufRead, Read, Write}, net::TcpStream, path::{Path, PathBuf}, process::{Command, Stdio}, sync::{atomic::{AtomicBool,Ordering}, Arc, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::ipc::Channel;

// Keep the same call sites on every target while suppressing console windows only on Windows.
#[cfg(not(windows))]
trait CreationFlagsExt { fn creation_flags(&mut self, _flags: u32) -> &mut Self; }
#[cfg(not(windows))]
impl CreationFlagsExt for Command { fn creation_flags(&mut self, _flags: u32) -> &mut Self { self } }

#[derive(Default)]
struct Workspace(Mutex<Option<PathBuf>>);

#[derive(Default, Clone)]
struct TerminalSession(Arc<Mutex<HashMap<String, PtySession>>>);

#[derive(Default, Clone)]
struct ChatCancellation(Arc<Mutex<HashMap<String,Arc<AtomicBool>>>>);

struct PtySession { master: Box<dyn MasterPty + Send>, input: Box<dyn Write + Send>, child: Box<dyn PtyChild + Send + Sync> }
impl Drop for PtySession { fn drop(&mut self){let _=self.child.kill();} }

#[derive(Serialize, Clone)]
#[serde(rename_all="camelCase")]
struct TerminalEvent { output: Option<String>, exited: bool, error: Option<String> }

#[derive(Serialize)]
struct Entry { name: String, path: String, is_dir: bool, size: Option<u64> }

#[derive(Serialize)]
struct GitChange { path: String, status: String, before: String, after: String }

#[derive(Serialize, Clone)]
struct PullProgress { status: String, completed: Option<u64>, total: Option<u64> }

#[derive(serde::Deserialize, Serialize)]
struct ChatMessage { role: String, content: String }

#[derive(Serialize, Clone)]
#[serde(rename_all="camelCase")]
struct ChatEvent { token: Option<String>, done: bool, done_reason: Option<String>, prompt_eval_count: Option<u64>, eval_count: Option<u64>, load_duration: Option<u64>, prompt_eval_duration: Option<u64>, eval_duration: Option<u64> }

const OLLAMA_API: &str = "http://127.0.0.1:11434";

fn ollama_error(response: reqwest::Response) -> impl std::future::Future<Output=String> {
    async move { let status=response.status();let body=response.text().await.unwrap_or_default();format!("Ollama HTTP {status}: {}",if body.is_empty(){"Yanıt alınamadı"}else{&body}) }
}

#[tauri::command]
async fn ollama_models()->Result<Vec<Value>,String>{
    let client=reqwest::Client::builder().timeout(Duration::from_secs(2)).build().map_err(|e|e.to_string())?;
    let response=client.get(format!("{OLLAMA_API}/api/tags")).send().await.map_err(|e|format!("Ollama bağlantısı kurulamadı: {e}"))?;
    if !response.status().is_success(){return Err(ollama_error(response).await);}
    let data:Value=response.json().await.map_err(|e|format!("Ollama yanıtı okunamadı: {e}"))?;
    Ok(data.get("models").and_then(Value::as_array).cloned().unwrap_or_default())
}

#[tauri::command]
async fn ollama_running_models()->Result<Vec<Value>,String>{
    let client=reqwest::Client::builder().timeout(Duration::from_secs(2)).build().map_err(|e|e.to_string())?;
    let response=client.get(format!("{OLLAMA_API}/api/ps")).send().await.map_err(|e|format!("Ollama çalışan modelleri okunamadı: {e}"))?;
    if !response.status().is_success(){return Err(ollama_error(response).await);}
    let data:Value=response.json().await.map_err(|e|e.to_string())?;
    Ok(data.get("models").and_then(Value::as_array).cloned().unwrap_or_default())
}

#[tauri::command]
async fn ollama_delete(name:String)->Result<(),String>{let client=reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e|e.to_string())?;let response=client.delete(format!("{OLLAMA_API}/api/delete")).json(&serde_json::json!({"name":name})).send().await.map_err(|e|format!("Ollama bağlantısı kurulamadı: {e}"))?;if !response.status().is_success(){return Err(ollama_error(response).await);}Ok(())}

#[tauri::command]
async fn ollama_chat(model:String,messages:Vec<ChatMessage>,num_ctx:Option<u32>,num_predict:Option<u32>,temperature:Option<f32>,format:Option<String>,think:Option<bool>,num_gpu:Option<u32>,flash_attn:Option<bool>,request_id:String,on_token:Channel<ChatEvent>,cancellations:State<'_,ChatCancellation>)->Result<(),String>{
    let cancelled=Arc::new(AtomicBool::new(false));
    cancellations.0.lock().map_err(|e|e.to_string())?.insert(request_id.clone(),cancelled.clone());
    let client=reqwest::Client::new();
    let num_ctx=num_ctx.unwrap_or(16384).clamp(2048,32768);
    let num_predict=num_predict.unwrap_or(2048).clamp(1,4096);
    let temperature=temperature.unwrap_or(0.15).clamp(0.0,0.2);
    let mut options=serde_json::json!({"num_ctx":num_ctx,"num_predict":num_predict,"temperature":temperature});if let Some(layers)=num_gpu{options["num_gpu"]=Value::from(layers);}if let Some(enabled)=flash_attn{options["flash_attn"]=Value::from(enabled);}
    let mut request=serde_json::json!({"model":model,"messages":messages,"stream":true,"options":options});if let Some(response_format)=format{request["format"]=Value::String(response_format);}if let Some(think)=think{request["think"]=Value::Bool(think);}
    let response=client.post(format!("{OLLAMA_API}/api/chat")).json(&request).send().await.map_err(|e|format!("Ollama bağlantısı kurulamadı: {e}"))?;
    if !response.status().is_success(){return Err(ollama_error(response).await);}
    let mut stream=response.bytes_stream();let mut buffer=Vec::new();let mut done_reason="stop".to_string();let mut prompt_eval_count=None;let mut eval_count=None;let mut load_duration=None;let mut prompt_eval_duration=None;let mut eval_duration=None;
    loop{
        let chunk=tokio::select!{chunk=stream.next()=>chunk,_=tokio::time::sleep(Duration::from_millis(100))=>{if cancelled.load(Ordering::Relaxed){break;}continue;}};
        let Some(chunk)=chunk else{break};
        let chunk=chunk.map_err(|e|format!("Ollama yanıt akışı kesildi: {e}"))?;buffer.extend_from_slice(&chunk);
        while let Some(index)=buffer.iter().position(|b|*b==b'\n'){
            let line=buffer.drain(..=index).collect::<Vec<_>>();if let Ok(value)=serde_json::from_slice::<Value>(&line){
                if let Some(error)=value.get("error").and_then(Value::as_str){return Err(error.to_string());}
                if let Some(content)=value.pointer("/message/content").and_then(Value::as_str){let _=on_token.send(ChatEvent{token:Some(content.to_string()),done:false,done_reason:None,prompt_eval_count:None,eval_count:None,load_duration:None,prompt_eval_duration:None,eval_duration:None});}
                if value.get("done").and_then(Value::as_bool)==Some(true){done_reason=value.get("done_reason").and_then(Value::as_str).unwrap_or("stop").to_string();prompt_eval_count=value.get("prompt_eval_count").and_then(Value::as_u64);eval_count=value.get("eval_count").and_then(Value::as_u64);load_duration=value.get("load_duration").and_then(Value::as_u64);prompt_eval_duration=value.get("prompt_eval_duration").and_then(Value::as_u64);eval_duration=value.get("eval_duration").and_then(Value::as_u64);}
            }
        }
    }
    if !buffer.is_empty(){if let Ok(value)=serde_json::from_slice::<Value>(&buffer){if let Some(content)=value.pointer("/message/content").and_then(Value::as_str){let _=on_token.send(ChatEvent{token:Some(content.to_string()),done:false,done_reason:None,prompt_eval_count:None,eval_count:None,load_duration:None,prompt_eval_duration:None,eval_duration:None});}if value.get("done").and_then(Value::as_bool)==Some(true){done_reason=value.get("done_reason").and_then(Value::as_str).unwrap_or("stop").to_string();prompt_eval_count=value.get("prompt_eval_count").and_then(Value::as_u64);eval_count=value.get("eval_count").and_then(Value::as_u64);load_duration=value.get("load_duration").and_then(Value::as_u64);prompt_eval_duration=value.get("prompt_eval_duration").and_then(Value::as_u64);eval_duration=value.get("eval_duration").and_then(Value::as_u64);}}}
    let was_cancelled=cancelled.load(Ordering::Relaxed);
    if let Ok(mut active)=cancellations.0.lock(){active.remove(&request_id);}
    let _=on_token.send(ChatEvent{token:None,done:true,done_reason:Some(if was_cancelled{"cancelled".into()}else{done_reason}),prompt_eval_count,eval_count,load_duration,prompt_eval_duration,eval_duration});
    Ok(())
}

#[tauri::command]
async fn ollama_cancel_chat(request_id:String,cancellations:State<'_,ChatCancellation>)->Result<(),String>{if let Some(flag)=cancellations.0.lock().map_err(|e|e.to_string())?.remove(&request_id){flag.store(true,Ordering::Relaxed);}Ok(())}

#[tauri::command]
async fn ollama_wait_ready(attempts:Option<u8>)->bool{let client=match reqwest::Client::builder().timeout(Duration::from_secs(2)).build(){Ok(client)=>client,Err(_)=>return false};for attempt in 0..attempts.unwrap_or(3).clamp(1,3){if client.get(format!("{OLLAMA_API}/api/tags")).send().await.map(|response|response.status().is_success()).unwrap_or(false){return true;}if attempt+1<attempts.unwrap_or(3).clamp(1,3){tokio::time::sleep(Duration::from_millis(1300)).await;}}false}

#[tauri::command]
async fn ollama_model_loaded(name:String)->bool{let Ok(client)=reqwest::Client::builder().timeout(Duration::from_secs(2)).build() else{return false};let Ok(response)=client.get(format!("{OLLAMA_API}/api/ps")).send().await else{return false};let Ok(value)=response.json::<Value>().await else{return false};value.get("models").and_then(Value::as_array).map(|models|models.iter().any(|item|item.get("name").and_then(Value::as_str).map(|loaded|loaded.eq_ignore_ascii_case(&name)).unwrap_or(false))).unwrap_or(false)}

#[tauri::command]
async fn ollama_unload_model(name:String)->Result<(),String>{let client=reqwest::Client::builder().timeout(Duration::from_secs(15)).build().map_err(|e|e.to_string())?;let response=client.post(format!("{OLLAMA_API}/api/generate")).json(&serde_json::json!({"model":name,"prompt":"","stream":false,"keep_alive":0})).send().await.map_err(|e|format!("Model bellekten çıkarılamadı: {e}"))?;if !response.status().is_success(){return Err(ollama_error(response).await);}Ok(())}

#[tauri::command]
async fn restart_ollama()->Result<String,String>{
    #[cfg(windows)]{
        let kill=Command::new("taskkill.exe").args(["/F","/IM","ollama.exe","/T"]).creation_flags(0x08000000).output().map_err(|e|format!("Ollama süreci sonlandırılamadı: {e}"))?;
        let listed=Command::new("tasklist.exe").args(["/FI","IMAGENAME eq ollama.exe","/NH"]).creation_flags(0x08000000).output().map_err(|e|format!("Ollama süreci doğrulanamadı: {e}"))?;
        let process_list=String::from_utf8_lossy(&listed.stdout).to_lowercase();
        if process_list.contains("ollama.exe"){return Err(format!("Ollama süreci hâlâ çalışıyor; yeniden başlatma durduruldu. taskkill: {}",String::from_utf8_lossy(&kill.stderr).trim()));}
    }
    #[cfg(not(windows))]{let _=Command::new("pkill").arg("ollama").output();}
    tokio::time::sleep(Duration::from_millis(700)).await;
    let executable=find_ollama().ok_or_else(||"Ollama çalıştırılabilir dosyası bulunamadı. Ollama'nın kurulu olduğunu kontrol edin.".to_string())?;
    Command::new(executable).arg("serve").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000).spawn().map_err(|e|format!("Ollama yeniden başlatılamadı: {e}"))?;
    if ollama_wait_ready(Some(3)).await{Ok("Ollama yeniden başlatıldı ve hazır.".into())}else{Err("Ollama başlatma isteği gönderildi ancak /api/tags hazır olmadı. Ollama'yı elle başlatıp teknik logları kontrol edin.".into())}
}

fn collect_ollama_diagnostics()->String{
    let mut report=String::new();
    let nvidia=Command::new("nvidia-smi").args(["--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu,driver_version","--format=csv,noheader,nounits"]).creation_flags(0x08000000).output();
    match nvidia{Ok(output) if output.status.success()=>report.push_str(&format!("nvidia-smi:\n{}\n",String::from_utf8_lossy(&output.stdout).trim())),Ok(output)=>report.push_str(&format!("nvidia-smi hata kodu {:?}: {}\n",output.status.code(),String::from_utf8_lossy(&output.stderr).trim())),Err(error)=>report.push_str(&format!("nvidia-smi bulunamadı: {error}\n"))}
    match find_ollama(){Some(exe)=>match Command::new(exe).arg("--version").creation_flags(0x08000000).output(){Ok(output)=>report.push_str(&format!("\nOllama sürümü:\n{}{}\n",String::from_utf8_lossy(&output.stdout).trim(),String::from_utf8_lossy(&output.stderr).trim())),Err(error)=>report.push_str(&format!("\nOllama sürümü okunamadı: {error}\n"))},None=>report.push_str("\nOllama executable bulunamadı.\n")}
    let gpus=query_gpu_metrics();if !gpus.is_empty(){report.push_str("\nGPU boş VRAM / sürücü:\n");for gpu in gpus{report.push_str(&format!("{} · boş {} MB / toplam {} MB · driver {} · kaynak {}\n",gpu.name,gpu.free_mb.map(|v|v.to_string()).unwrap_or_else(||"bilinmiyor".into()),gpu.total_mb.map(|v|v.to_string()).unwrap_or_else(||"bilinmiyor".into()),gpu.driver.unwrap_or_else(||"bilinmiyor".into()),gpu.detection));}}
    report.push_str("\nOllama server.log son 50 satır:\n");let home=std::env::var_os("HOME").map(PathBuf::from);let mut candidates=Vec::new();if let Some(path)=std::env::var_os("LOCALAPPDATA").map(PathBuf::from){candidates.push(path.join("Ollama").join("server.log"));}if let Some(home)=home{candidates.push(home.join(".ollama").join("logs").join("server.log"));candidates.push(home.join("Library").join("Logs").join("Ollama").join("server.log"));}let log=candidates.into_iter().find_map(|path|fs::read_to_string(path).ok());match log{Some(log)=>{let lines:Vec<_>=log.lines().collect();for line in lines.iter().rev().take(50).rev(){report.push_str(line);report.push('\n');}},None=>report.push_str("Log dosyası bulunamadı veya okunamadı.\n")}
    report
}

#[tauri::command]
async fn ollama_diagnostics()->Result<String,String>{tauri::async_runtime::spawn_blocking(collect_ollama_diagnostics).await.map_err(|error|format!("Tanılama çalıştırılamadı: {error}"))}

#[tauri::command]
async fn log_agent_raw(app:AppHandle,model:String,prompt:String,response:String)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let app_data=app.path().app_data_dir().map_err(|error|format!("Uygulama veri dizini bulunamadı: {error}"))?;
        let directory=app_data.join("koddas").join("logs");fs::create_dir_all(&directory).map_err(|error|format!("Agent log klasörü oluşturulamadı: {error}"))?;
        let path=directory.join("agent-raw.log");let mut file=fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|error|format!("Agent ham yanıt logu açılamadı: {error}"))?;
        let timestamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        writeln!(file,"\n===== timestamp={timestamp} model={model} =====\nTASK: {prompt}\nRAW RESPONSE:\n{response}\n===== end =====").map_err(|error|format!("Agent ham yanıtı yazılamadı: {error}"))?;
        Ok::<String,String>(path.to_string_lossy().to_string())
    }).await.map_err(|error|format!("Agent log işlemi başarısız: {error}"))?
}

#[tauri::command]
async fn ollama_pull(name:String,on_progress:Channel<PullProgress>)->Result<(),String>{
    let client=reqwest::Client::new();
    let response=client.post(format!("{OLLAMA_API}/api/pull")).json(&serde_json::json!({"name":name,"stream":true})).send().await.map_err(|e|format!("Ollama bağlantısı kurulamadı: {e}"))?;
    if !response.status().is_success(){return Err(ollama_error(response).await);}
    let mut stream=response.bytes_stream();let mut buffer=Vec::new();
    while let Some(chunk)=stream.next().await{
        let chunk=chunk.map_err(|e|format!("Model indirme bağlantısı kesildi: {e}"))?;buffer.extend_from_slice(&chunk);
        while let Some(index)=buffer.iter().position(|b|*b==b'\n'){
            let line=buffer.drain(..=index).collect::<Vec<_>>();if let Ok(value)=serde_json::from_slice::<Value>(&line){
                if let Some(error)=value.get("error").and_then(Value::as_str){return Err(error.to_string());}
                let progress=PullProgress{status:value.get("status").and_then(Value::as_str).unwrap_or("İndiriliyor").to_string(),completed:value.get("completed").and_then(Value::as_u64),total:value.get("total").and_then(Value::as_u64)};let _=on_progress.send(progress);
            }
        }
    }
    if !buffer.is_empty(){if let Ok(value)=serde_json::from_slice::<Value>(&buffer){if let Some(error)=value.get("error").and_then(Value::as_str){return Err(error.to_string());}let _=on_progress.send(PullProgress{status:value.get("status").and_then(Value::as_str).unwrap_or("Tamamlandı").to_string(),completed:value.get("completed").and_then(Value::as_u64),total:value.get("total").and_then(Value::as_u64)});}}
    Ok(())
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all="camelCase")]
struct GpuMetric { id: String, name: String, total_mb: Option<u64>, used_mb: Option<u64>, free_mb: Option<u64>, utilization_percent: Option<f64>, temperature_c: Option<u32>, driver: Option<String>, detection: String, ollama_vram_mb: Option<u64> }

#[derive(Default)]
struct GpuSampler { latest: Arc<Mutex<Vec<GpuMetric>>>, child: Mutex<Option<std::process::Child>>, interval: Mutex<u64> }
impl GpuSampler {
    fn start(&self,seconds:u64){let seconds=seconds.clamp(1,10);if let Ok(mut value)=self.interval.lock(){*value=seconds;}let Ok(mut child)=Command::new("nvidia-smi").args(["--query-gpu=uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu,driver_version","--format=csv,noheader,nounits","-l",&seconds.to_string()]).stdout(Stdio::piped()).stderr(Stdio::null()).creation_flags(0x08000000).spawn() else{return;};let Some(stdout)=child.stdout.take() else{return;};if let Ok(mut slot)=self.child.lock(){*slot=Some(child);}let latest=self.latest.clone();std::thread::spawn(move||{let mut frame=Vec::new();for line in std::io::BufReader::new(stdout).lines().flatten(){if line.trim().is_empty(){if !frame.is_empty(){let values=parse_nvidia_gpus(&frame.join("\n"));if let Ok(mut current)=latest.lock(){*current=values;}frame.clear();}}else{frame.push(line);}}});}
    fn set_interval(&self,seconds:u64)->Result<(),String>{let seconds=seconds.clamp(1,10);if self.interval.lock().map_err(|e|e.to_string())?.eq(&seconds){return Ok(());}self.shutdown();self.start(seconds);Ok(())}
    fn snapshot(&self)->Vec<GpuMetric>{self.latest.lock().map(|current|current.clone()).unwrap_or_default()}
    fn shutdown(&self){if let Ok(mut child)=self.child.lock(){if let Some(mut process)=child.take(){let _=process.kill();let _=process.wait();}}}
}

#[derive(Serialize)]
struct Hardware { gpu_name: Option<String>, vram_total_mb: Option<u64>, vram_free_mb: Option<u64>, driver: Option<String>, cuda: bool, cpu: String, ram_total_mb: u64, os: String, gpus: Vec<GpuMetric> }

fn parse_nvidia_gpus(text:&str)->Vec<GpuMetric>{text.lines().filter_map(|line|{let fields:Vec<_>=line.split(',').map(str::trim).collect();if fields.len()<7||fields[0].is_empty(){return None;}let used=fields[2].parse::<u64>().ok();let total=fields[3].parse::<u64>().ok();Some(GpuMetric{id:fields[0].to_string(),name:fields[1].to_string(),total_mb:total,used_mb:used,free_mb:total.zip(used).map(|(t,u)|t.saturating_sub(u)),utilization_percent:fields[4].parse().ok(),temperature_c:fields[5].parse().ok(),driver:Some(fields[6].to_string()),detection:"nvidia-smi".into(),ollama_vram_mb:None})}).collect()}

fn query_gpu_metrics()->Vec<GpuMetric>{
    if let Ok(output)=Command::new("nvidia-smi").args(["--query-gpu=uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu,driver_version","--format=csv,noheader,nounits"]).creation_flags(0x08000000).output(){if output.status.success(){let found=parse_nvidia_gpus(&String::from_utf8_lossy(&output.stdout));if !found.is_empty(){return found;}}}
    #[cfg(windows)]{
    let script=r#"$cards=@(Get-CimInstance Win32_VideoController); $u=0.0; $m=0.0; try{$u=(Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum}catch{}; try{$m=(Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum}catch{}; $cards | ForEach-Object { [pscustomobject]@{name=$_.Name;totalMb=[math]::Round($_.AdapterRAM/1MB);usedMb=if($m){[math]::Round($m/1MB)}else{$null};util=if($u){[math]::Round($u,1)}else{$null}} } | ConvertTo-Json -Compress"#;
    let output=Command::new("powershell.exe").args(["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",script]).creation_flags(0x08000000).output().ok().filter(|o|o.status.success());let Some(output)=output else{return Vec::new();};let Ok(value)=serde_json::from_slice::<Value>(&output.stdout) else{return Vec::new();};let cards=if let Some(rows)=value.as_array(){rows.clone()}else{vec![value]};cards.iter().enumerate().filter_map(|(index,row)|{let name=row.get("name")?.as_str()?.to_string();let total=row.get("totalMb").and_then(Value::as_u64);let used=row.get("usedMb").and_then(Value::as_u64);Some(GpuMetric{id:index.to_string(),name,total_mb:total,used_mb:used,free_mb:total.zip(used).map(|(t,u)|t.saturating_sub(u)),utilization_percent:row.get("util").and_then(Value::as_f64),temperature_c:None,driver:None,detection:"Windows GPU counters / WMI".into(),ollama_vram_mb:None})}).collect()
    }
    #[cfg(not(windows))]{Vec::new()}
}

fn root(state: &Workspace) -> Result<PathBuf, String> { state.0.lock().map_err(|e|e.to_string())?.clone().ok_or_else(|| "Önce bir proje klasörü açın".into()) }
fn within(root: &Path, candidate: &str, must_exist: bool) -> Result<PathBuf, String> {
    #[cfg(windows)]
    let raw=PathBuf::from(candidate);
    #[cfg(not(windows))]
    let raw=PathBuf::from(candidate.replace('\\',"/"));
    let joined=if raw.is_absolute(){raw}else{root.join(raw)};
    let resolved=if must_exist || joined.exists() { joined.canonicalize().map_err(|e|e.to_string())? } else {
        let parent=joined.parent().ok_or("Geçersiz dosya yolu")?.canonicalize().map_err(|e|e.to_string())?;
        parent.join(joined.file_name().ok_or("Geçersiz dosya adı")?)
    };
    if !resolved.starts_with(root){return Err("Workspace dışına erişim engellendi".into());}
    let name=resolved.file_name().and_then(|x|x.to_str()).unwrap_or("").to_lowercase();
    if name==".env"||name.starts_with(".env.")||name.contains("credential")||name.contains("secret")||name.contains("password")||name.ends_with(".pem")||name.ends_with(".key") { return Err("Hassas dosyalara erişim engellendi".into()); }
    Ok(resolved)
}

#[tauri::command]
fn set_workspace(path: String, state: State<Workspace>) -> Result<(),String> { let p=PathBuf::from(path).canonicalize().map_err(|e|e.to_string())?;if !p.is_dir(){return Err("Proje yolu bir klasör değil".into());}*state.0.lock().map_err(|e|e.to_string())?=Some(p);Ok(()) }

#[tauri::command]
fn clear_workspace(state: State<Workspace>) -> Result<(),String> { *state.0.lock().map_err(|e|e.to_string())?=None; Ok(()) }

#[tauri::command]
fn list_directory(path:String,show_hidden:bool,state:State<Workspace>)->Result<Vec<Entry>,String>{let root=root(&state)?;let dir=within(&root,&path,true)?;if !dir.is_dir(){return Err("Klasör bulunamadı".into());}let mut out=Vec::new();for item in fs::read_dir(dir).map_err(|e|e.to_string())?{let item=item.map_err(|e|e.to_string())?;let name=item.file_name().to_string_lossy().to_string();if !show_hidden&&name.starts_with('.') {continue;}let metadata=item.metadata().map_err(|e|e.to_string())?;out.push(Entry{name,path:item.path().to_string_lossy().to_string(),is_dir:metadata.is_dir(),size:if metadata.is_file(){Some(metadata.len())}else{None}});}out.sort_by_key(|e|(!e.is_dir,e.name.to_lowercase()));Ok(out)}

#[tauri::command]
fn read_file(path:String,state:State<Workspace>)->Result<String,String>{let root=root(&state)?;let file=within(&root,&path,true)?;let meta=fs::metadata(&file).map_err(|e|e.to_string())?;if meta.len()>2_000_000{return Err("Dosya 2 MB sınırını aşıyor".into());}fs::read_to_string(file).map_err(|e|e.to_string())}

#[tauri::command]
fn write_file(path:String,content:String,state:State<Workspace>)->Result<(),String>{let root=root(&state)?;let file=within(&root,&path,false)?;if content.len()>2_000_000{return Err("Dosya 2 MB sınırını aşıyor".into());}fs::write(file,content).map_err(|e|e.to_string())}

#[tauri::command]
fn path_exists(path:String,state:State<Workspace>)->Result<bool,String>{let root=root(&state)?;let file=within(&root,&path,false)?;Ok(file.exists())}

#[tauri::command]
fn backup_file(path:String,state:State<Workspace>)->Result<String,String>{
    let root=root(&state)?;let file=within(&root,&path,true)?;
    let backup_root=std::env::temp_dir().join("Koddas").join("backups");
    fs::create_dir_all(&backup_root).map_err(|e|format!("Yedek klasörü oluşturulamadı: {e}"))?;
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let name=file.file_name().and_then(|value|value.to_str()).unwrap_or("file");
    let backup=backup_root.join(format!("{name}-{stamp}.bak"));
    fs::copy(&file,&backup).map_err(|e|format!("Dosya yedeği alınamadı: {e}"))?;
    Ok(backup.to_string_lossy().to_string())
}

#[tauri::command]
fn restore_backup_file(path:String,backup:String,state:State<Workspace>)->Result<(),String>{
    let root=root(&state)?;let file=within(&root,&path,false)?;
    let backup_root=std::env::temp_dir().join("Koddas").join("backups").canonicalize().map_err(|e|format!("Yedek klasörü bulunamadı: {e}"))?;
    let backup_path=PathBuf::from(backup).canonicalize().map_err(|e|format!("Yedek dosyası bulunamadı: {e}"))?;
    if !backup_path.starts_with(&backup_root)||!backup_path.is_file(){return Err("Yedek yolu güvenli değil".into());}
    fs::copy(&backup_path,&file).map_err(|e|format!("Yedek geri yüklenemedi: {e}"))?;Ok(())
}

#[tauri::command]
fn delete_file(path:String,state:State<Workspace>)->Result<(),String>{let root=root(&state)?;let file=within(&root,&path,true)?;if !file.is_file(){return Err("Yalnızca dosyalar silinebilir".into());}fs::remove_file(file).map_err(|e|e.to_string())}

#[tauri::command]
fn create_folder(path:String,state:State<Workspace>)->Result<(),String>{let root=root(&state)?;let folder=within(&root,&path,false)?;fs::create_dir(folder).map_err(|e|e.to_string())}

#[tauri::command]
async fn laravel_create_project(workspace_path:String,on_progress:Channel<String>,state:State<'_,Workspace>)->Result<String,String>{
    let root=root(&state)?;
    let requested=PathBuf::from(&workspace_path).canonicalize().map_err(|e|format!("Çalışma alanı doğrulanamadı: {e}"))?;
    if requested!=root{return Err("Laravel kurulumu yalnızca açık çalışma alanında başlatılabilir".into());}
    if !root.is_dir(){return Err("Çalışma alanı klasörü bulunamadı".into());}
    if fs::read_dir(&root).map_err(|e|e.to_string())?.next().is_some(){return Err("Laravel kurulumu için çalışma alanının tamamen boş olması gerekiyor".into());}
    let _=on_progress.send("Composer ile Laravel kurulumu başlatılıyor…".into());
    tauri::async_runtime::spawn_blocking(move||{
        #[cfg(windows)]
        let mut command={let mut cmd=Command::new("cmd.exe");cmd.args(["/D","/S","/C","composer create-project laravel/laravel . --no-interaction"]);cmd};
        #[cfg(not(windows))]
        let mut command={let mut cmd=Command::new("composer");cmd.args(["create-project","laravel/laravel",".","--no-interaction"]);cmd};
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child=command.current_dir(&root).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null()).spawn().map_err(|e|format!("Composer başlatılamadı. PHP ve Composer kurulu mu? Ayrıntı: {e}"))?;
        let (tx,rx)=std::sync::mpsc::channel::<String>();let log=Arc::new(Mutex::new(String::new()));let mut readers=Vec::new();
        let streams:Vec<Box<dyn Read+Send>>=vec![Box::new(child.stdout.take().expect("stdout piped")),Box::new(child.stderr.take().expect("stderr piped"))];
        for stream in streams{let tx=tx.clone();let log=log.clone();readers.push(std::thread::spawn(move||{for line in std::io::BufReader::new(stream).lines().flatten(){if let Ok(mut saved)=log.lock(){saved.push_str(&line);saved.push('\n');if saved.len()>24000{let trim=saved.len()-16000;saved.drain(..trim);}}let _=tx.send(line);}}));}
        drop(tx);
        let status=loop{if let Some(status)=child.try_wait().map_err(|e|format!("Composer işlemi beklenemedi: {e}"))?{break status;}if let Ok(line)=rx.recv_timeout(Duration::from_millis(200)){let _=on_progress.send(line);}};
        for reader in readers{let _=reader.join();}
        for line in rx{let _=on_progress.send(line);}
        let output=log.lock().map(|value|value.clone()).unwrap_or_default();
        if !status.success(){return Err(format!("Laravel kurulumu başarısız oldu (kod {:?}). PHP/Composer ve ağ bağlantısını kontrol edin.\n{}",status.code(),output));}
        let _=on_progress.send("Laravel kurulumu tamamlandı.".into());
        Ok(output)
    }).await.map_err(|e|format!("Laravel kurulum görevi çöktü: {e}"))?
}

#[tauri::command]
fn get_git_changes(cwd:String,state:State<Workspace>)->Result<Option<Vec<GitChange>>,String>{
    let workspace=root(&state)?;
    let dir=within(&workspace,&cwd,true)?;
    if !dir.is_dir(){return Err("Çalışma dizini klasör değil".into());}
    let top=Command::new("git").args(["-C"]).arg(&dir).args(["rev-parse","--show-toplevel"]).output().map_err(|e|format!("Git başlatılamadı: {e}"))?;
    if !top.status.success(){return Ok(None);}
    let git_root=PathBuf::from(String::from_utf8_lossy(&top.stdout).trim()).canonicalize().map_err(|e|e.to_string())?;
    let output=Command::new("git").args(["-C"]).arg(&git_root).args(["-c","core.quotepath=false","status","--porcelain=v1","--untracked-files=all"]).output().map_err(|e|format!("Git durumu alınamadı: {e}"))?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());}
    let mut changes=Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines(){
        if line.len()<4{continue;}
        let code=&line[..2];
        let relative=line[3..].trim().trim_matches('"').replace('\\',"/");
        if relative.contains(" -> "){continue;}
        let absolute=git_root.join(&relative);
        let resolved=if absolute.exists(){absolute.canonicalize().unwrap_or(absolute.clone())}else{absolute.clone()};
        if !resolved.starts_with(&workspace){continue;}
        let status=if code=="??"{"Yeni".to_string()}else if code.contains('D'){"Silindi".to_string()}else if code.contains('A'){"Eklendi".to_string()}else if code.contains('R'){"Taşındı".to_string()}else{"Değişti".to_string()};
        let before_ref=format!("HEAD:{relative}");
        let before_output=Command::new("git").args(["-C"]).arg(&git_root).arg("show").arg(before_ref).output().ok();
        let before=before_output.filter(|o|o.status.success()).map(|o|String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
        let after=if absolute.is_file(){fs::read_to_string(&absolute).unwrap_or_default()}else{String::new()};
        changes.push(GitChange{path:resolved.to_string_lossy().to_string(),status,before,after});
    }
    changes.sort_by_key(|change|change.path.to_lowercase());
    Ok(Some(changes))
}

fn shell_working_directory(path:&Path)->PathBuf{
    #[cfg(windows)]{
        let value=path.to_string_lossy();
        if let Some(rest)=value.strip_prefix(r"\\?\UNC\"){return PathBuf::from(format!(r"\\{rest}"));}
        if let Some(rest)=value.strip_prefix(r"\\?\"){return PathBuf::from(rest);}
    }
    path.to_path_buf()
}

#[cfg(not(windows))]
fn terminal_shell_command(shell:&str)->Result<(CommandBuilder,String),String>{
    let executable=match shell{"default"=>std::env::var("SHELL").unwrap_or_else(|_|"/bin/sh".into()),"bash"=>"bash".into(),"zsh"=>"zsh".into(),"sh"=>"sh".into(),_=>return Err(format!("Bu terminal seçeneği bu sistemde desteklenmiyor: {shell}"))};
    let mut command=CommandBuilder::new(executable.clone());
    if executable.ends_with("bash")||executable.ends_with("zsh"){command.args(["-l"]);}
    Ok((command,executable))
}

#[tauri::command]
fn terminal_spawn(id:String,cwd:String,shell:String,cols:u16,rows:u16,on_output:Channel<TerminalEvent>,workspace:State<Workspace>,terminals:State<TerminalSession>)->Result<(),String>{
    let root=root(&workspace)?;
    let dir=within(&root,&cwd,true)?;
    if !dir.is_dir(){return Err("Terminal çalışma dizini klasör değil".into());}
    let terminal_dir=shell_working_directory(&dir);
    let system=native_pty_system();
    let pair=system.openpty(PtySize{rows:rows.max(2),cols:cols.max(2),pixel_width:0,pixel_height:0}).map_err(|e|format!("PTY açılamadı: {e}"))?;
    #[cfg(windows)]
    let (mut command,shell_label)=match shell.as_str(){
        "cmd"=>{let mut c=CommandBuilder::new("cmd.exe");c.args(["/Q","/D"]);(c,"cmd".to_string())},
        "git-bash"=> (CommandBuilder::new("bash.exe"),"Git Bash".to_string()),
        "wsl"=>{let mut c=CommandBuilder::new("wsl.exe");let windows_path=terminal_dir.to_string_lossy();let linux_path=if let Some(rest)=windows_path.strip_prefix("\\\\"){format!("/mnt/unc/{}",rest.replace('\\',"/"))}else if let Some((drive,rest))=windows_path.split_once(':'){format!("/mnt/{}/{}",drive.to_lowercase(),rest.trim_start_matches(['\\','/']).replace('\\',"/"))}else{return Err(format!("WSL için proje yolu dönüştürülemedi: {windows_path}"));};c.args(["--cd",&linux_path]);(c,"WSL".to_string())},
        _=>{let mut c=CommandBuilder::new("powershell.exe");c.args(["-NoLogo","-NoProfile"]);(c,"PowerShell".to_string())},
    };
    #[cfg(not(windows))]
    let (mut command,shell_label)=terminal_shell_command(&shell)?;
    command.cwd(&terminal_dir);
    command.env("TERM","xterm-256color");
    let child=pair.slave.spawn_command(command).map_err(|e|format!("{shell_label} başlatılamadı: {e}"))?;
    let reader=pair.master.try_clone_reader().map_err(|e|format!("PTY çıktısı açılamadı: {e}"))?;
    let input=pair.master.take_writer().map_err(|e|format!("PTY girdisi açılamadı: {e}"))?;
    let session=PtySession{master:pair.master,input,child};
    let mut sessions=terminals.0.lock().map_err(|e|e.to_string())?;
    if sessions.contains_key(&id){return Err(format!("Terminal kimliği zaten kullanımda: {id}"));}
    sessions.insert(id.clone(),session);
    drop(sessions);
    std::thread::spawn(move||{
        let mut reader=reader;let mut buffer=[0u8;8192];
        loop{match reader.read(&mut buffer){Ok(0)=>break,Ok(count)=>{let output=String::from_utf8_lossy(&buffer[..count]).into_owned();if on_output.send(TerminalEvent{output:Some(output),exited:false,error:None}).is_err(){break;}},Err(error)=>{let _=on_output.send(TerminalEvent{output:None,exited:false,error:Some(format!("PTY çıktısı okunamadı: {error}"))});break;}}}
        let _=on_output.send(TerminalEvent{output:None,exited:true,error:None});
    });
    Ok(())
}

#[tauri::command]
fn terminal_write(id:String,data:String,terminals:State<TerminalSession>)->Result<(),String>{let mut sessions=terminals.0.lock().map_err(|e|e.to_string())?;let session=sessions.get_mut(&id).ok_or_else(||format!("Terminal oturumu bulunamadı: {id}"))?;session.input.write_all(data.as_bytes()).map_err(|e|format!("Terminal girdisi gönderilemedi: {e}"))?;session.input.flush().map_err(|e|format!("Terminal girdisi boşaltılamadı: {e}"))}

#[tauri::command]
fn terminal_resize(id:String,cols:u16,rows:u16,terminals:State<TerminalSession>)->Result<(),String>{let sessions=terminals.0.lock().map_err(|e|e.to_string())?;let session=sessions.get(&id).ok_or_else(||format!("Terminal oturumu bulunamadı: {id}"))?;session.master.resize(PtySize{rows:rows.max(2),cols:cols.max(2),pixel_width:0,pixel_height:0}).map_err(|e|format!("Terminal boyutu değiştirilemedi: {e}"))}

#[tauri::command]
fn terminal_close(id:String,terminals:State<TerminalSession>)->Result<(),String>{let mut sessions=terminals.0.lock().map_err(|e|e.to_string())?;if let Some(session)=sessions.remove(&id){drop(session);}Ok(())}

fn terminal_cleanup(terminals:&TerminalSession){if let Ok(mut sessions)=terminals.0.lock(){sessions.clear();}}

#[tauri::command]
async fn get_hardware()->Hardware{let mut system=System::new();system.refresh_cpu_all();system.refresh_memory();let cpu=system.cpus().first().map(|c|c.brand().to_string()).unwrap_or_else(||"CPU algılanamadı".into());let ram_total_mb=system.total_memory()/1024/1024;let os=System::long_os_version().unwrap_or_else(||"Windows".into());let gpus=tauri::async_runtime::spawn_blocking(query_gpu_metrics).await.unwrap_or_default();let first=gpus.first();Hardware{gpu_name:first.map(|g|g.name.clone()),vram_total_mb:first.and_then(|g|g.total_mb),vram_free_mb:first.and_then(|g|g.free_mb),driver:first.and_then(|g|g.driver.clone()),cuda:first.is_some_and(|g|g.detection=="nvidia-smi"),cpu,ram_total_mb,os,gpus}}

fn ollama_gpu_uuids()->Vec<String>{let output=Command::new("nvidia-smi").args(["--query-compute-apps=gpu_uuid,process_name","--format=csv,noheader,nounits"]).creation_flags(0x08000000).output().ok().filter(|output|output.status.success());let Some(output)=output else{return Vec::new();};String::from_utf8_lossy(&output.stdout).lines().filter_map(|line|{let mut fields=line.splitn(2,',').map(str::trim);let uuid=fields.next()?;let process=fields.next()?.to_lowercase();(process.contains("ollama")||process.contains("llama_server")).then(||uuid.to_string())}).collect()}

#[tauri::command]
async fn get_gpu_metrics(sampler:State<'_,GpuSampler>)->Result<Vec<GpuMetric>,String>{let mut gpus=sampler.snapshot();if gpus.is_empty(){gpus=tauri::async_runtime::spawn_blocking(query_gpu_metrics).await.unwrap_or_default();}if !gpus.is_empty(){if let Ok(response)=reqwest::Client::builder().timeout(Duration::from_millis(700)).build().unwrap().get(format!("{OLLAMA_API}/api/ps")).send().await{if response.status().is_success(){if let Ok(data)=response.json::<Value>().await{let loaded=data.get("models").and_then(Value::as_array).map(|models|models.iter().filter_map(|model|model.get("size_vram").and_then(Value::as_u64)).sum::<u64>()/1024/1024);if let Some(value)=loaded{let used=tauri::async_runtime::spawn_blocking(ollama_gpu_uuids).await.unwrap_or_default();let target_ids:Vec<_>=gpus.iter().filter(|gpu|used.contains(&gpu.id)).map(|gpu|gpu.id.clone()).collect();if target_ids.is_empty(){if let Some(gpu)=gpus.first_mut(){gpu.ollama_vram_mb=Some(value);}}else{let each=value/target_ids.len() as u64;for gpu in &mut gpus{if target_ids.contains(&gpu.id){gpu.ollama_vram_mb=Some(each);}}}}}}}}Ok(gpus)}

#[tauri::command]
fn set_gpu_sampler_interval(seconds:u64,sampler:State<'_,GpuSampler>)->Result<(),String>{sampler.set_interval(seconds)}

fn ollama_api_ready()->bool{TcpStream::connect_timeout(&"127.0.0.1:11434".parse().unwrap(),Duration::from_millis(300)).is_ok()}
#[cfg(windows)]
fn find_ollama()->Option<PathBuf>{
    if let Ok(output)=Command::new("where.exe").arg("ollama.exe").output(){if output.status.success(){for line in String::from_utf8_lossy(&output.stdout).lines(){let path=PathBuf::from(line.trim());if path.is_file(){return Some(path);}}}}
    for root in [std::env::var_os("LOCALAPPDATA").map(PathBuf::from),std::env::var_os("PROGRAMFILES").map(PathBuf::from)].into_iter().flatten(){let path=root.join("Programs").join("Ollama").join("ollama.exe");if path.is_file(){return Some(path);}let path=root.join("Ollama").join("ollama.exe");if path.is_file(){return Some(path);}}
    None
}
#[cfg(not(windows))]
fn find_ollama()->Option<PathBuf>{
    if let Ok(output)=Command::new("which").arg("ollama").output(){if output.status.success(){let path=PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());if path.is_file(){return Some(path);}}}
    let home=std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates=vec![PathBuf::from("/usr/local/bin/ollama"),PathBuf::from("/opt/homebrew/bin/ollama"),PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama")];
    if let Some(home)=home{candidates.push(home.join(".ollama").join("ollama"));}
    candidates.into_iter().find(|path|path.is_file())
}

#[tauri::command]
async fn ensure_ollama()->Result<String,String>{
    if ollama_api_ready(){return Ok("running".into());}
    let Some(executable)=find_ollama() else{return Ok("missing".into());};
    Command::new(executable).arg("serve").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x08000000).spawn().map_err(|e|format!("Ollama başlatılamadı: {e}"))?;
    for _ in 0..20{if ollama_api_ready(){return Ok("started".into());}tauri::async_runtime::spawn_blocking(||std::thread::sleep(Duration::from_millis(250))).await.map_err(|e|e.to_string())?;}
    Ok("starting".into())
}

#[derive(Serialize, Clone)]
struct InstallProgress { downloaded: u64, total: Option<u64> }

#[tauri::command]
async fn install_ollama(app:AppHandle)->Result<String,String>{
    #[cfg(not(windows))]
    {let _=app;return Err("Ollama'yı Linux veya macOS için ollama.com/download adresinden kurun; ardından KODDAŞ'ı yeniden açın.".into());}
    #[cfg(windows)]
    {
    let response=reqwest::get("https://ollama.com/download/OllamaSetup.exe").await.map_err(|e|format!("Ollama indirilemedi: {e}"))?;
    if !response.status().is_success(){return Err(format!("Ollama indirmesi başarısız: HTTP {}",response.status()));}
    let total=response.content_length();
    let path=std::env::temp_dir().join("Koddas-OllamaSetup.exe");
    let mut file=fs::File::create(&path).map_err(|e|format!("Kurulum dosyası oluşturulamadı: {e}"))?;
    let mut downloaded=0;
    let _=app.emit("ollama-install-progress",InstallProgress{downloaded,total});
    let mut response=response;
    while let Some(chunk)=response.chunk().await.map_err(|e|format!("Ollama indirmesi kesildi: {e}"))?{
        file.write_all(&chunk).map_err(|e|format!("Kurulum dosyası yazılamadı: {e}"))?;
        downloaded+=chunk.len() as u64;
        let _=app.emit("ollama-install-progress",InstallProgress{downloaded,total});
    }
    drop(file);
    Command::new(&path).spawn().map_err(|e|format!("Ollama kurulum penceresi açılamadı: {e}"))?;
    Ok("installer".into())
    }
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn run(){tauri::Builder::default().manage(Workspace::default()).manage(TerminalSession::default()).manage(ChatCancellation::default()).manage(GpuSampler::default()).plugin(tauri_plugin_dialog::init()).setup(|app|{app.state::<GpuSampler>().start(2);Ok(())}).invoke_handler(tauri::generate_handler![set_workspace,clear_workspace,list_directory,read_file,write_file,path_exists,backup_file,restore_backup_file,delete_file,create_folder,laravel_create_project,get_git_changes,ollama_models,ollama_running_models,ollama_delete,ollama_chat,ollama_cancel_chat,ollama_wait_ready,ollama_model_loaded,ollama_unload_model,restart_ollama,ollama_diagnostics,log_agent_raw,ollama_pull,terminal_spawn,terminal_write,terminal_resize,terminal_close,get_hardware,get_gpu_metrics,set_gpu_sampler_interval,ensure_ollama,install_ollama]).on_window_event(|window,event|{if matches!(event,tauri::WindowEvent::CloseRequested{..}){terminal_cleanup(&window.state::<TerminalSession>());window.state::<GpuSampler>().shutdown();}}).run(tauri::generate_context!()).expect("KODDAŞ başlatılamadı");}
