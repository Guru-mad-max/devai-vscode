import * as vscode from 'vscode';
import { OllamaClient, DevAIMode, Message, StreamChunk } from '../api/ollama';
import { getEditorContext, buildContextBlock }                         from '../utils/context';

interface ChatMessage {
  id:      string;
  role:    'user' | 'assistant';
  content: string;
  mode?:   DevAIMode;
  ts:      number;
}

export class ChatPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devai.chatView';

  private view?:      vscode.WebviewView;
  private history:    ChatMessage[] = [];
  private apiHistory: Message[]     = [];
  private abort:      AbortController | null = null;

  constructor(
    private readonly ctx:    vscode.ExtensionContext,
    private readonly client: OllamaClient,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx:   vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.ctx.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMsg) => {
      switch (msg.type) {
        case 'ready':        await this.onReady(); break;
        case 'send':         await this.handleSend(msg.text, msg.mode ?? 'chat'); break;
        case 'cancel':       this.cancelStream(); break;
        case 'clear':        this.clearHistory(); break;
        case 'context':      await this.injectContext(msg.mode ?? 'chat'); break;
        case 'copy':         await vscode.env.clipboard.writeText(msg.text); break;
        case 'insert':       await this.insertToEditor(msg.text); break;
        case 'openOllama':   vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download')); break;
        case 'refreshModels': await this.refreshModels(); break;
        case 'setModel':     await this.setModel(msg.text); break;
      }
    });

    vscode.window.onDidChangeActiveColorTheme(() => {
      this.post({ type: 'theme', dark: this.isDark() });
    });
  }

  async sendWithContext(text: string, mode: DevAIMode): Promise<void> {
    await vscode.commands.executeCommand('devai.chatView.focus');
    await this.handleSend(text, mode, true);
  }

  private async onReady(): Promise<void> {
    const running = await this.client.isRunning();
    const models  = running ? await this.client.getModels() : [];
    const current = vscode.workspace.getConfiguration('devai').get<string>('ollamaModel', 'llama3.2');
    this.post({ type: 'status', running, models, current, dark: this.isDark() });
  }

  private async refreshModels(): Promise<void> {
    const running = await this.client.isRunning();
    const models  = running ? await this.client.getModels() : [];
    const current = vscode.workspace.getConfiguration('devai').get<string>('ollamaModel', 'llama3.2');
    this.post({ type: 'models', running, models, current });
  }

  private async setModel(name: string): Promise<void> {
    await vscode.workspace.getConfiguration('devai').update('ollamaModel', name, true);
    this.post({ type: 'modelSet', name });
  }

  private async handleSend(userText: string, mode: DevAIMode, withContext = false): Promise<void> {
    const ec = getEditorContext();
    let fullPrompt = userText;
    if (withContext && ec) {
      fullPrompt = buildContextBlock(ec) + '\n\n' + userText;
    } else if (ec) {
      fullPrompt = `[File: ${ec.relativePath}, Lang: ${ec.language}]\n\n${userText}`;
    }

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: userText, mode, ts: Date.now() };
    this.history.push(userMsg);
    this.post({ type: 'userMsg', msg: userMsg });
    this.apiHistory.push({ role: 'user', content: fullPrompt });

    const aiId = uid();
    this.history.push({ id: aiId, role: 'assistant', content: '', mode, ts: Date.now() });
    this.post({ type: 'aiStart', id: aiId });

    this.abort = new AbortController();
    let fullText = '';

    await this.client.streamResponse(
      this.apiHistory,
      mode,
      (chunk: StreamChunk) => {
        if (chunk.type === 'text') {
          fullText += chunk.value;
          this.post({ type: 'aiDelta', id: aiId, delta: chunk.value });
        } else if (chunk.type === 'done') {
          this.post({ type: 'aiDone', id: aiId });
          this.apiHistory.push({ role: 'assistant', content: fullText });
        } else if (chunk.type === 'error') {
          this.post({ type: 'aiError', id: aiId, error: chunk.value });
          if (chunk.value === 'OLLAMA_NOT_RUNNING') {
            this.post({ type: 'ollamaDown' });
          }
        }
      },
      this.abort.signal,
    );
  }

  private cancelStream(): void { this.abort?.abort(); this.abort = null; }

  private clearHistory(): void {
    this.history = []; this.apiHistory = [];
    this.post({ type: 'cleared' });
  }

  private async injectContext(mode: DevAIMode): Promise<void> {
    const ec = getEditorContext();
    if (!ec) { this.post({ type: 'noContext' }); return; }
    this.post({ type: 'contextInjected', block: buildContextBlock(ec, true), language: ec.language, mode });
  }

  private async insertToEditor(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('DevAI: No active editor.'); return; }
    await editor.edit(b => b.replace(editor.selection, text));
  }

  private isDark(): boolean {
    return vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
  }

  private post(msg: object): void { this.view?.webview.postMessage(msg); }

  // ── HTML ────────────────────────────────────────────────────────────────────
  private getHtml(_webview: vscode.Webview): string {
    const nonce = uid();
    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DevAI</title>
<style nonce="${nonce}">
:root{
  --bg:  var(--vscode-sideBar-background,#1e1e1e);
  --bg2: var(--vscode-editor-background,#252526);
  --bg3: var(--vscode-input-background,#3c3c3c);
  --fg:  var(--vscode-foreground,#ccc);
  --fg2: var(--vscode-descriptionForeground,#858585);
  --acc: #7c6af7;
  --grn: #4ec9b0;
  --red: #f48771;
  --yel: #dcdcaa;
  --brd: var(--vscode-panel-border,#454545);
  --cod: var(--vscode-textCodeBlock-background,#1a1a2e);
  font-size:13px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,system-ui);background:var(--bg);height:100vh;display:flex;flex-direction:column;overflow:hidden;color:var(--fg)}

/* header */
.hdr{display:flex;align-items:center;gap:6px;padding:9px 10px 7px;border-bottom:1px solid var(--brd);flex-shrink:0}
.logo{font-size:13px;font-weight:700;color:var(--acc);display:flex;align-items:center;gap:6px}
.logo-dot{width:18px;height:18px;border-radius:4px;background:var(--acc);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center}
.spacer{flex:1}
.hbtn{font-size:11px;padding:3px 7px;border-radius:3px;border:1px solid var(--brd);background:none;color:var(--fg2);cursor:pointer}
.hbtn:hover{background:var(--bg3);color:var(--fg)}

/* model bar */
.model-bar{display:flex;align-items:center;gap:5px;padding:5px 10px;border-bottom:1px solid var(--brd);flex-shrink:0;font-size:11px;color:var(--fg2)}
.model-dot{width:7px;height:7px;border-radius:50%;background:var(--grn);flex-shrink:0}
.model-dot.off{background:var(--red)}
.model-sel{font-size:11px;background:var(--bg3);border:1px solid var(--brd);color:var(--fg);border-radius:3px;padding:2px 5px;cursor:pointer}
.rbtn{font-size:11px;padding:2px 6px;border-radius:3px;border:1px solid var(--brd);background:none;color:var(--fg2);cursor:pointer}
.rbtn:hover{background:var(--bg3)}

/* modes */
.modes{display:flex;gap:3px;padding:5px 8px;border-bottom:1px solid var(--brd);flex-wrap:wrap;flex-shrink:0}
.mbtn{font-size:11px;padding:3px 8px;border-radius:3px;border:1px solid transparent;background:none;cursor:pointer;color:var(--fg2)}
.mbtn:hover{background:var(--bg3);color:var(--fg)}
.mbtn.active{background:var(--acc);color:#fff}

/* messages */
.msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:9px;scroll-behavior:smooth}
.msgs::-webkit-scrollbar{width:4px}
.msgs::-webkit-scrollbar-thumb{background:var(--brd);border-radius:2px}

/* welcome */
.welcome{text-align:center;padding:18px 10px;color:var(--fg2)}
.welcome h2{font-size:14px;font-weight:600;color:var(--fg);margin-bottom:5px}
.welcome p{font-size:12px;line-height:1.6}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:12px}
.sc{background:var(--bg2);border:1px solid var(--brd);border-radius:4px;padding:7px 8px;font-size:11px;cursor:pointer;color:var(--fg2);text-align:left}
.sc:hover{border-color:var(--acc);color:var(--fg)}
.sc b{color:var(--acc);display:block;font-size:10px;margin-bottom:2px}

/* ollama down banner */
.down-banner{margin:8px;padding:10px 12px;background:rgba(244,135,113,.1);border:1px solid rgba(244,135,113,.3);border-radius:6px;font-size:12px;line-height:1.7}
.down-banner code{font-size:11px;background:var(--bg3);padding:2px 6px;border-radius:3px;display:inline-block;margin:3px 0;color:var(--yel)}
.dbtn{display:inline-block;margin-top:6px;font-size:11px;padding:4px 10px;border-radius:4px;background:var(--acc);color:#fff;border:none;cursor:pointer}

/* messages */
.msg{display:flex;flex-direction:column;gap:4px;animation:fi .18s ease}
@keyframes fi{from{opacity:0;transform:translateY(3px)}to{opacity:1}}
.mmeta{font-size:10px;color:var(--fg2);display:flex;align-items:center;gap:4px}
.bdg{font-size:9px;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.5px}
.bm{background:rgba(124,106,247,.18);color:var(--acc)}
.ubub{background:var(--bg2);border:1px solid var(--brd);border-radius:8px 8px 2px 8px;padding:8px 10px;font-size:13px;line-height:1.55;align-self:flex-end;max-width:90%;white-space:pre-wrap;word-break:break-word}
.aibub{font-size:13px;line-height:1.65;width:100%}
.aibub p{margin-bottom:7px}
.aibub p:last-child{margin-bottom:0}
.aibub ul,.aibub ol{margin:5px 0 5px 18px}
.aibub li{margin-bottom:3px}
.aibub strong{color:var(--fg);font-weight:600}
.aibub code{font-family:var(--vscode-editor-font-family,monospace);font-size:11.5px;background:var(--cod);padding:1px 5px;border-radius:3px;color:var(--yel)}
.aibub h1,.aibub h2,.aibub h3{font-weight:600;margin:8px 0 4px;color:var(--fg)}
.aibub h1{font-size:15px}.aibub h2{font-size:14px}.aibub h3{font-size:13px}

/* code blocks */
.cb{border-radius:5px;border:1px solid var(--brd);overflow:hidden;margin:8px 0}
.cbh{display:flex;align-items:center;padding:5px 10px;background:var(--bg3);border-bottom:1px solid var(--brd);gap:6px}
.cbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--grn);font-family:monospace}
.cba{margin-left:auto;display:flex;gap:4px}
.cbn{font-size:10px;padding:2px 7px;border-radius:3px;border:1px solid var(--brd);background:none;cursor:pointer;color:var(--fg2)}
.cbn:hover{background:var(--bg);color:var(--fg)}
.cbn.ok{color:var(--grn);border-color:var(--grn)}
.cb pre{margin:0;padding:12px;overflow-x:auto;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;line-height:1.65;background:var(--cod);color:var(--fg);white-space:pre;tab-size:2}

/* thinking */
.thk{display:flex;align-items:center;gap:7px;padding:8px 0;font-size:12px;color:var(--fg2)}
.dots{display:flex;gap:3px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--acc);animation:bo .9s infinite}
.dot:nth-child(2){animation-delay:.15s}
.dot:nth-child(3){animation-delay:.3s}
@keyframes bo{0%,100%{transform:translateY(0);opacity:.4}50%{transform:translateY(-4px);opacity:1}}

/* error */
.err{padding:8px 10px;background:rgba(244,135,113,.1);border:1px solid rgba(244,135,113,.3);border-radius:5px;font-size:12px;color:var(--red)}

/* input */
.inp{padding:7px 8px 9px;border-top:1px solid var(--brd);flex-shrink:0}
.ctxbar{min-height:16px;margin-bottom:4px;font-size:11px;color:var(--fg2)}
.ctxbdg{font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(78,201,176,.12);color:var(--grn);border:1px solid rgba(78,201,176,.2)}
.inrow{display:flex;gap:5px;align-items:flex-end}
.pbox{flex:1;min-height:34px;max-height:110px;padding:7px 10px;font-size:13px;font-family:inherit;border-radius:5px;border:1px solid var(--brd);background:var(--bg3);color:var(--fg);resize:none;line-height:1.5;outline:none}
.pbox:focus{border-color:var(--acc)}
.pbox::placeholder{color:var(--fg2)}
.sbtn{width:32px;height:32px;border-radius:5px;border:none;background:var(--acc);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px}
.sbtn:hover:not(:disabled){background:#6a58e6}
.sbtn:disabled{background:var(--bg3);color:var(--fg2);cursor:not-allowed}
.xbtn{width:32px;height:32px;border-radius:5px;border:1px solid var(--brd);background:none;color:var(--red);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;display:none}
.xbtn:hover{background:rgba(244,135,113,.1)}
</style>
</head>
<body>
<div class="hdr">
  <div class="logo"><div class="logo-dot">AI</div>DevAI</div>
  <div class="spacer"></div>
  <button class="hbtn" onclick="injectCtx()">+ ctx</button>
  <button class="hbtn" onclick="clearChat()">clear</button>
</div>

<div class="model-bar">
  <div class="model-dot off" id="mdot"></div>
  <span id="mstatus" style="flex:1">Checking Ollama…</span>
  <select class="model-sel" id="msel" onchange="pickModel(this.value)" style="display:none"></select>
  <button class="rbtn" onclick="refresh()" title="Refresh models">↺</button>
</div>

<div class="modes">
  <button class="mbtn active" data-mode="chat"     onclick="sm(this)">Chat</button>
  <button class="mbtn"        data-mode="generate" onclick="sm(this)">Generate</button>
  <button class="mbtn"        data-mode="debug"    onclick="sm(this)">Debug</button>
  <button class="mbtn"        data-mode="explain"  onclick="sm(this)">Explain</button>
  <button class="mbtn"        data-mode="refactor" onclick="sm(this)">Refactor</button>
  <button class="mbtn"        data-mode="tests"    onclick="sm(this)">Tests</button>
</div>

<div class="msgs" id="msgs">
  <div class="welcome" id="welcome">
    <div class="logo-dot" style="width:34px;height:34px;border-radius:8px;font-size:14px;margin:0 auto 10px">AI</div>
    <h2>DevAI — 100% Local AI</h2>
    <p>Powered by Ollama. Private, free, offline.<br>No API key, no internet, no limits.</p>
    <div class="sg">
      <div class="sc" onclick="tryP('Write a ')"><b>Generate</b>Build from description</div>
      <div class="sc" onclick="smf('debug')"><b>Debug</b>Find & fix bugs</div>
      <div class="sc" onclick="smf('explain')"><b>Explain</b>Understand code</div>
      <div class="sc" onclick="smf('tests')"><b>Tests</b>Auto-generate tests</div>
    </div>
  </div>
</div>

<div class="inp">
  <div class="ctxbar" id="ctxbar"></div>
  <div class="inrow">
    <textarea id="pbox" class="pbox" placeholder="Ask me anything about your code…" rows="1"
      onkeydown="hkey(event)" oninput="rsz(this)"></textarea>
    <button class="sbtn" id="sbtn" onclick="snd()">➤</button>
    <button class="xbtn" id="xbtn" onclick="cancel()">✕</button>
  </div>
</div>

<script nonce="${nonce}">
const vsc = acquireVsCodeApi();
let mode='chat', streaming=false, bufs={};

window.addEventListener('message',({data})=>{
  switch(data.type){
    case 'status':    onStatus(data); break;
    case 'models':    onModels(data); break;
    case 'modelSet':  document.getElementById('mstatus').textContent='Model: '+data.name; break;
    case 'userMsg':   renderUser(data.msg); break;
    case 'aiStart':   aiStart(data.id); break;
    case 'aiDelta':   aiDelta(data.id,data.delta); break;
    case 'aiDone':    aiDone(data.id); break;
    case 'aiError':   aiError(data.id,data.error); break;
    case 'cleared':   clearDOM(); break;
    case 'ollamaDown': showDownBanner(); break;
    case 'contextInjected': onCtx(data); break;
    case 'noContext': ctxbar().textContent='No active editor open.'; break;
    case 'theme':     break;
  }
});

vsc.postMessage({type:'ready'});

function onStatus(d){
  const dot=document.getElementById('mdot');
  const st=document.getElementById('mstatus');
  const sel=document.getElementById('msel');
  if(d.running && d.models && d.models.length>0){
    dot.classList.remove('off');
    sel.style.display='';
    sel.innerHTML=d.models.map(m=>\`<option value="\${m.name}" \${m.name===d.current?'selected':''}>\${m.name}</option>\`).join('');
    st.textContent='';
    document.getElementById('pbox').placeholder='Ask me anything about your code…';
  } else if(d.running){
    dot.classList.remove('off');
    st.textContent='Ollama running — no models installed';
    showNoModelsBanner();
  } else {
    dot.classList.add('off');
    st.textContent='Ollama not running';
    showDownBanner();
  }
}

function onModels(d){ onStatus(d); }

function showDownBanner(){
  const m=document.getElementById('msgs');
  if(document.getElementById('down-banner')) return;
  const b=document.createElement('div');
  b.id='down-banner'; b.className='down-banner';
  b.innerHTML=\`<strong>⚠ Ollama is not running</strong><br>
Start it with:<br>
<code>ollama serve</code><br>
Then pull a coding model:<br>
<code>ollama pull qwen2.5-coder:7b</code><br>
<code>ollama pull codellama</code><br>
<button class="dbtn" onclick="openOllama()">Download Ollama →</button>\`;
  m.insertBefore(b,m.firstChild);
}

function showNoModelsBanner(){
  const m=document.getElementById('msgs');
  if(document.getElementById('down-banner')) return;
  const b=document.createElement('div');
  b.id='down-banner'; b.className='down-banner';
  b.innerHTML=\`<strong>No models installed.</strong> Pull one in Terminal:<br>
<code>ollama pull qwen2.5-coder:7b</code> <em>(best for code, 4.7GB)</em><br>
<code>ollama pull codellama:7b</code> <em>(Meta code model)</em><br>
<code>ollama pull llama3.2:3b</code> <em>(fast, lightweight)</em>\`;
  m.insertBefore(b,m.firstChild);
}

function openOllama(){ vsc.postMessage({type:'openOllama'}); }
function refresh(){ vsc.postMessage({type:'refreshModels'}); }
function pickModel(v){ vsc.postMessage({type:'setModel',text:v}); }

function sm(btn){
  document.querySelectorAll('.mbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active'); mode=btn.dataset.mode;
  const ph={chat:'Ask me anything…',generate:'Describe what to build…',debug:'Paste error or buggy code…',explain:'Paste code to explain…',refactor:'Paste code to refactor…',tests:'Paste code to test…'};
  document.getElementById('pbox').placeholder=ph[mode]||'Ask me anything…';
}
function smf(m){ document.querySelector(\`.mbtn[data-mode="\${m}"]\`)?.click(); document.getElementById('pbox').focus(); }
function tryP(t){ const b=document.getElementById('pbox'); b.value=t; b.focus(); rsz(b); }

function hkey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();snd();} }
function rsz(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }

function snd(){
  if(streaming) return;
  const b=document.getElementById('pbox'), t=b.value.trim();
  if(!t) return;
  b.value=''; b.style.height='auto';
  vsc.postMessage({type:'send',text:t,mode});
}
function cancel(){ vsc.postMessage({type:'cancel'}); setStream(false); }
function clearChat(){ vsc.postMessage({type:'clear'}); }
function injectCtx(){ vsc.postMessage({type:'context',mode}); }
function ctxbar(){ return document.getElementById('ctxbar'); }

function renderUser(msg){
  rmWelcome();
  const el=document.createElement('div'); el.className='msg';
  el.innerHTML=\`<div class="mmeta">you <span class="bdg bm">\${msg.mode||'chat'}</span></div><div class="ubub">\${esc(msg.content)}</div>\`;
  msgs().appendChild(el); scr(); setStream(true);
}

function aiStart(id){
  const el=document.createElement('div'); el.className='msg'; el.id='m'+id;
  el.innerHTML=\`<div class="mmeta"><div class="logo-dot" style="width:15px;height:15px;border-radius:3px;font-size:7px">AI</div> DevAI</div>
<div class="aibub" id="b\${id}"><div class="thk"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><span>Thinking…</span></div></div>\`;
  msgs().appendChild(el); scr();
}

function aiDelta(id,delta){
  if(!bufs[id]) bufs[id]='';
  bufs[id]+=delta;
  const el=document.getElementById('b'+id);
  if(el){ el.innerHTML=md(bufs[id]); scr(); }
}

function aiDone(id){
  if(bufs[id]) addActions(id);
  setStream(false);
}

function aiError(id,err){
  const el=document.getElementById('b'+id);
  if(el) el.innerHTML=\`<div class="err">\${esc(err)}</div>\`;
  setStream(false);
}

function clearDOM(){
  msgs().innerHTML=''; bufs={};
  const w=document.createElement('div'); w.id='welcome'; w.className='welcome';
  w.innerHTML='<p style="color:var(--fg2);font-size:12px;text-align:center;padding:16px">Chat cleared.</p>';
  msgs().appendChild(w);
}

function addActions(id){
  const bub=document.getElementById('b'+id);
  if(!bub) return;
  bub.querySelectorAll('.cb').forEach(blk=>{
    const pre=blk.querySelector('pre'), acts=blk.querySelector('.cba');
    if(!pre||!acts||acts.children.length>0) return;
    const code=pre.textContent||'';
    acts.innerHTML=\`<button class="cbn" onclick='cp(this,\${JSON.stringify(code)})'>⎘ copy</button><button class="cbn" onclick='ins(\${JSON.stringify(code)})'>↙ insert</button>\`;
  });
}

function cp(btn,code){ vsc.postMessage({type:'copy',text:code}); btn.textContent='✓'; btn.classList.add('ok'); setTimeout(()=>{btn.textContent='⎘ copy';btn.classList.remove('ok');},2000); }
function ins(code){ vsc.postMessage({type:'insert',text:code}); }

function onCtx(d){ ctxbar().innerHTML=\`<span class="ctxbdg">📎 \${esc(d.block.split('\\n')[0].replace('**File:**','').trim())}</span>\`; }

function md(text){
  text=text.replace(/\`\`\`(\\w*)?\\n?([\\s\\S]*?)\`\`\`/g,(_,l,c)=>\`<div class="cb"><div class="cbh"><span class="cbl">\${esc(l||'code')}</span><div class="cba"></div></div><pre>\${esc(c.trimEnd())}</pre></div>\`);
  text=text.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  text=text.replace(/\\*\\*(.*?)\\*\\*/g,'<strong>$1</strong>');
  text=text.replace(/^### (.+)$/gm,'<h3>$1</h3>');
  text=text.replace(/^## (.+)$/gm,'<h2>$1</h2>');
  text=text.replace(/^# (.+)$/gm,'<h1>$1</h1>');
  text=text.replace(/^[-*] (.+)$/gm,'<li>$1</li>');
  text=text.replace(/(<li>.*<\\/li>\\n?)+/g,s=>'<ul>'+s+'</ul>');
  text=text.split('\\n\\n').map(p=>p.trim()&&!p.trim().startsWith('<')?'<p>'+p.trim()+'</p>':p).join('');
  return text;
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function msgs(){ return document.getElementById('msgs'); }
function scr(){ const m=msgs(); m.scrollTop=m.scrollHeight; }
function rmWelcome(){ document.getElementById('welcome')?.remove(); document.getElementById('down-banner')?.remove(); }
function setStream(on){ streaming=on; document.getElementById('sbtn').disabled=on; document.getElementById('xbtn').style.display=on?'flex':'none'; }
</script>
</body>
</html>`;
  }
}

interface WebviewMsg { type: string; text: string; mode?: DevAIMode; }
function uid(): string { return Math.random().toString(36).slice(2,10); }
