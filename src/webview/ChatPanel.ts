import * as vscode from 'vscode';
import { ClaudeClient, DevAIMode, Message, StreamChunk } from '../api/claude';
import { getEditorContext, buildContextBlock }            from '../utils/context';

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
  private history:    ChatMessage[]     = [];
  private apiHistory: Message[]         = [];
  private abort:      AbortController | null = null;

  constructor(
    private readonly ctx:    vscode.ExtensionContext,
    private readonly client: ClaudeClient,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context:    vscode.WebviewViewResolveContext,
    _token:      vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts:  true,
      localResourceRoots: [this.ctx.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'send':    await this.handleSend(msg.text, msg.mode ?? 'chat'); break;
        case 'cancel':  this.cancelStream(); break;
        case 'clear':   this.clearHistory(); break;
        case 'setKey':  await this.handleSetKey(); break;
        case 'context': await this.injectContext(msg.mode ?? 'chat'); break;
        case 'copy':    await vscode.env.clipboard.writeText(msg.text); break;
        case 'insert':  await this.insertToEditor(msg.text); break;
        case 'ready':   await this.checkApiKey(); break;
      }
    });

    // Re-render on theme change
    vscode.window.onDidChangeActiveColorTheme(() => {
      if (this.view) {
        this.view.webview.postMessage({ type: 'theme', dark: this.isDark() });
      }
    });
  }

  /** Called from commands to send a message with editor context */
  async sendWithContext(prompt: string, mode: DevAIMode): Promise<void> {
    await vscode.commands.executeCommand('devai.chatView.focus');
    await this.handleSend(prompt, mode, true);
  }

  private async handleSend(userText: string, mode: DevAIMode, withContext = false): Promise<void> {
    const ctx = getEditorContext();

    let fullPrompt = userText;
    if (withContext && ctx) {
      const ctxBlock = buildContextBlock(ctx);
      fullPrompt = ctxBlock + '\n\n' + userText;
    } else if (ctx && !withContext) {
      // Always include lightweight file info
      fullPrompt = `[File: ${ctx.relativePath}, Lang: ${ctx.language}]\n\n${userText}`;
    }

    const userMsg: ChatMessage = { id: uid(), role: 'user', content: userText, mode, ts: Date.now() };
    this.history.push(userMsg);
    this.post({ type: 'userMsg', msg: userMsg });

    this.apiHistory.push({ role: 'user', content: fullPrompt });

    // Create streaming assistant message
    const aiId  = uid();
    const aiMsg: ChatMessage = { id: aiId, role: 'assistant', content: '', mode, ts: Date.now() };
    this.history.push(aiMsg);
    this.post({ type: 'aiStart', id: aiId });

    this.abort = new AbortController();
    let fullText = '';

    await this.client.streamResponse(
      this.apiHistory,
      mode,
      (chunk: StreamChunk) => {
        if (chunk.type === 'text') {
          fullText += chunk.value;
          aiMsg.content = fullText;
          this.post({ type: 'aiDelta', id: aiId, delta: chunk.value });
        } else if (chunk.type === 'search') {
          this.post({ type: 'aiSearch', id: aiId, query: chunk.value });
        } else if (chunk.type === 'done') {
          this.post({ type: 'aiDone', id: aiId });
          this.apiHistory.push({ role: 'assistant', content: fullText });
        } else if (chunk.type === 'error') {
          this.post({ type: 'aiError', id: aiId, error: chunk.value });
          if (chunk.value === 'NO_API_KEY') { this.handleSetKey(); }
        }
      },
      this.abort.signal,
    );
  }

  private cancelStream(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private clearHistory(): void {
    this.history    = [];
    this.apiHistory = [];
    this.post({ type: 'cleared' });
  }

  private async handleSetKey(): Promise<void> {
    const key = await vscode.window.showInputBox({
      prompt:    'Enter your Anthropic API key (starts with sk-ant-…)',
      password:  true,
      placeHolder: 'sk-ant-api03-…',
      validateInput: v => v?.startsWith('sk-') ? null : 'Must start with sk-',
    });
    if (key) {
      await this.client.setApiKey(key);
      vscode.window.showInformationMessage('DevAI: API key saved ✓');
      this.post({ type: 'keySet' });
    }
  }

  private async injectContext(mode: DevAIMode): Promise<void> {
    const ctx = getEditorContext();
    if (!ctx) {
      this.post({ type: 'noContext' });
      return;
    }
    const block = buildContextBlock(ctx, true);
    this.post({ type: 'contextInjected', block, language: ctx.language, mode });
  }

  private async insertToEditor(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { vscode.window.showWarningMessage('No active editor to insert into.'); return; }
    await editor.edit(b => b.replace(editor.selection, text));
  }

  private async checkApiKey(): Promise<void> {
    const has = !!(await this.client.getApiKey());
    this.post({ type: 'keyStatus', hasKey: has, dark: this.isDark() });
  }

  private isDark(): boolean {
    return vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
  }

  private post(msg: object): void {
    this.view?.webview.postMessage(msg);
  }

  // ── HTML ────────────────────────────────────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const nonce = uid();
    const csp   = [
      `default-src 'none'`,
      `style-src   'nonce-${nonce}' 'unsafe-inline'`,
      `script-src  'nonce-${nonce}'`,
      `img-src     ${webview.cspSource} data:`,
      `font-src    ${webview.cspSource}`,
    ].join('; ');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevAI</title>
<style nonce="${nonce}">
:root {
  --bg:          var(--vscode-sideBar-background, #1e1e1e);
  --bg2:         var(--vscode-editor-background, #252526);
  --bg3:         var(--vscode-input-background, #3c3c3c);
  --fg:          var(--vscode-foreground, #cccccc);
  --fg2:         var(--vscode-descriptionForeground, #858585);
  --accent:      var(--vscode-button-background, #0e639c);
  --accent-fg:   var(--vscode-button-foreground, #fff);
  --border:      var(--vscode-panel-border, #454545);
  --code-bg:     var(--vscode-textCodeBlock-background, #1a1a2e);
  --purple:      #7c6af7;
  --green:       #4ec9b0;
  --yellow:      #dcdcaa;
  --red:         #f48771;
  font-size: 13px;
  color: var(--fg);
  background: var(--bg);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, system-ui); background: var(--bg); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* ── Header ── */
.header { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--bg); }
.logo { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--purple); }
.logo-icon { width: 20px; height: 20px; border-radius: 4px; background: var(--purple); color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.spacer { flex: 1; }
.hbtn { background: none; border: 1px solid var(--border); color: var(--fg2); padding: 3px 7px; border-radius: 4px; cursor: pointer; font-size: 11px; }
.hbtn:hover { background: var(--bg3); color: var(--fg); }

/* ── Mode Tabs ── */
.modes { display: flex; gap: 3px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; flex-shrink: 0; background: var(--bg); }
.mode-btn { font-size: 11px; padding: 3px 8px; border-radius: 3px; border: 1px solid transparent; background: none; cursor: pointer; color: var(--fg2); transition: all .12s; }
.mode-btn:hover { background: var(--bg3); color: var(--fg); }
.mode-btn.active { background: var(--purple); color: #fff; border-color: var(--purple); }

/* ── Messages ── */
.messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
.messages::-webkit-scrollbar { width: 4px; }
.messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

/* ── Welcome ── */
.welcome { text-align: center; padding: 20px 10px; color: var(--fg2); }
.welcome h2 { font-size: 15px; font-weight: 600; color: var(--fg); margin-bottom: 6px; }
.welcome p  { font-size: 12px; line-height: 1.6; }
.shortcut-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 14px; }
.shortcut { background: var(--bg2); border: 1px solid var(--border); border-radius: 4px; padding: 7px 8px; font-size: 11px; text-align: left; cursor: pointer; color: var(--fg2); }
.shortcut:hover { border-color: var(--purple); color: var(--fg); }
.shortcut .key { font-size: 10px; color: var(--purple); font-family: monospace; display: block; margin-bottom: 2px; }

/* ── No-Key Banner ── */
.no-key { margin: 8px; padding: 10px 12px; background: rgba(124,106,247,.12); border: 1px solid rgba(124,106,247,.3); border-radius: 6px; font-size: 12px; line-height: 1.6; }
.no-key a { color: var(--purple); cursor: pointer; text-decoration: underline; }

/* ── Messages ── */
.msg { display: flex; flex-direction: column; gap: 4px; animation: fadein .18s ease; }
@keyframes fadein { from { opacity:0; transform:translateY(3px); } to { opacity:1; } }
.msg-meta { font-size: 10px; color: var(--fg2); display: flex; align-items: center; gap: 5px; }
.badge { font-size: 9px; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: .5px; }
.badge-mode { background: rgba(124,106,247,.2); color: var(--purple); }
.badge-search { background: rgba(78,201,176,.15); color: var(--green); }

.user-bubble { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px 8px 2px 8px; padding: 8px 10px; font-size: 13px; line-height: 1.55; align-self: flex-end; max-width: 90%; white-space: pre-wrap; word-break: break-word; }

.ai-bubble { font-size: 13px; line-height: 1.65; color: var(--fg); width: 100%; }
.ai-bubble p { margin-bottom: 7px; }
.ai-bubble p:last-child { margin-bottom: 0; }
.ai-bubble ul, .ai-bubble ol { margin: 6px 0 6px 18px; }
.ai-bubble li { margin-bottom: 3px; }
.ai-bubble strong { color: var(--fg); font-weight: 600; }
.ai-bubble code { font-family: var(--vscode-editor-font-family, 'Cascadia Code', monospace); font-size: 11.5px; background: var(--code-bg); padding: 1px 5px; border-radius: 3px; color: var(--yellow); }
.ai-bubble h1, .ai-bubble h2, .ai-bubble h3 { font-weight: 600; margin: 10px 0 4px; color: var(--fg); }
.ai-bubble h1 { font-size: 15px; } .ai-bubble h2 { font-size: 14px; } .ai-bubble h3 { font-size: 13px; }

/* ── Code Blocks ── */
.code-block { border-radius: 5px; border: 1px solid var(--border); overflow: hidden; margin: 8px 0; }
.code-block-header { display: flex; align-items: center; padding: 5px 10px; background: var(--bg3); border-bottom: 1px solid var(--border); gap: 6px; }
.code-lang { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: var(--green); font-family: monospace; }
.code-actions { margin-left: auto; display: flex; gap: 5px; }
.cbtn { font-size: 10px; padding: 2px 7px; border-radius: 3px; border: 1px solid var(--border); background: none; cursor: pointer; color: var(--fg2); display: flex; align-items: center; gap: 3px; }
.cbtn:hover { background: var(--bg); color: var(--fg); }
.cbtn.ok { color: var(--green); border-color: var(--green); }
.code-block pre { margin: 0; padding: 12px; overflow-x: auto; font-family: var(--vscode-editor-font-family, 'Cascadia Code', monospace); font-size: 12px; line-height: 1.65; background: var(--code-bg); color: var(--fg); white-space: pre; tab-size: 2; }

/* ── Thinking ── */
.thinking { display: flex; align-items: center; gap: 7px; padding: 8px 0; font-size: 12px; color: var(--fg2); }
.dots { display: flex; gap: 3px; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--purple); animation: bounce .9s infinite; }
.dot:nth-child(2) { animation-delay: .15s; }
.dot:nth-child(3) { animation-delay: .30s; }
@keyframes bounce { 0%,100% { transform:translateY(0); opacity:.4; } 50% { transform:translateY(-4px); opacity:1; } }
.search-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 7px; border-radius: 10px; background: rgba(78,201,176,.12); color: var(--green); border: 1px solid rgba(78,201,176,.25); }

/* ── Error ── */
.error-msg { padding: 8px 10px; background: rgba(244,135,113,.1); border: 1px solid rgba(244,135,113,.3); border-radius: 5px; font-size: 12px; color: var(--red); }

/* ── Input ── */
.input-area { padding: 8px 10px 10px; border-top: 1px solid var(--border); flex-shrink: 0; background: var(--bg); }
.context-bar { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; font-size: 11px; color: var(--fg2); min-height: 18px; overflow: hidden; }
.ctx-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(78,201,176,.12); color: var(--green); border: 1px solid rgba(78,201,176,.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.input-row { display: flex; gap: 6px; align-items: flex-end; }
.prompt-box { flex: 1; min-height: 34px; max-height: 120px; padding: 7px 10px; font-size: 13px; font-family: inherit; border-radius: 5px; border: 1px solid var(--border); background: var(--bg3); color: var(--fg); resize: none; line-height: 1.5; outline: none; }
.prompt-box:focus { border-color: var(--purple); }
.prompt-box::placeholder { color: var(--fg2); }
.send-btn { width: 32px; height: 32px; border-radius: 5px; border: none; background: var(--purple); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; transition: background .12s; }
.send-btn:hover:not(:disabled) { background: #6a58e6; }
.send-btn:disabled { background: var(--bg3); color: var(--fg2); cursor: not-allowed; }
.send-btn svg { width: 14px; height: 14px; fill: currentColor; }
.cancel-btn { width: 32px; height: 32px; border-radius: 5px; border: 1px solid var(--border); background: none; color: var(--red); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
.cancel-btn:hover { background: rgba(244,135,113,.1); }
</style>
</head>
<body>

<div class="header">
  <div class="logo">
    <div class="logo-icon">AI</div>
    DevAI
  </div>
  <div class="spacer"></div>
  <button class="hbtn" onclick="injectCtx()">+ context</button>
  <button class="hbtn" onclick="clearChat()">clear</button>
  <button class="hbtn" onclick="setKey()">API key</button>
</div>

<div class="modes">
  <button class="mode-btn active" data-mode="chat"     onclick="setMode(this)">Chat</button>
  <button class="mode-btn"        data-mode="generate" onclick="setMode(this)">Generate</button>
  <button class="mode-btn"        data-mode="debug"    onclick="setMode(this)">Debug</button>
  <button class="mode-btn"        data-mode="explain"  onclick="setMode(this)">Explain</button>
  <button class="mode-btn"        data-mode="refactor" onclick="setMode(this)">Refactor</button>
  <button class="mode-btn"        data-mode="tests"    onclick="setMode(this)">Tests</button>
</div>

<div class="messages" id="messages">
  <div class="welcome" id="welcome">
    <div class="logo-icon" style="width:36px;height:36px;border-radius:8px;font-size:16px;margin:0 auto 10px">AI</div>
    <h2>DevAI – Your coding partner</h2>
    <p>Powered by Claude with live web search.<br>Right-click any selection for quick actions.</p>
    <div class="shortcut-grid">
      <div class="shortcut" onclick="tryPrompt('Write a ')"><span class="key">Generate</span>Build code from description</div>
      <div class="shortcut" onclick="setModeAndFocus('debug')"><span class="key">Debug</span>Find & fix bugs instantly</div>
      <div class="shortcut" onclick="setModeAndFocus('explain')"><span class="key">Explain</span>Understand any code</div>
      <div class="shortcut" onclick="setModeAndFocus('tests')"><span class="key">Tests</span>Auto-generate unit tests</div>
    </div>
  </div>
</div>

<div class="input-area">
  <div class="context-bar" id="context-bar"></div>
  <div class="input-row">
    <textarea id="prompt-box" class="prompt-box" placeholder="Ask me to build, debug, explain anything…" rows="1"
      onkeydown="handleKey(event)" oninput="resize(this)"></textarea>
    <button class="send-btn" id="send-btn" onclick="send()" title="Send (Enter)">
      <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
    </button>
    <button class="cancel-btn" id="cancel-btn" onclick="cancel()" style="display:none" title="Cancel">✕</button>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

let mode       = 'chat';
let streaming  = false;
let currentId  = null;
let ctxInfo    = null;

// ── VS Code message handler ──────────────────────────────────────────────────
window.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'keyStatus':     onKeyStatus(data); break;
    case 'keySet':        hideNoBanner(); break;
    case 'userMsg':       renderUser(data.msg); break;
    case 'aiStart':       aiStart(data.id); break;
    case 'aiDelta':       aiDelta(data.id, data.delta); break;
    case 'aiSearch':      aiSearch(data.id, data.query); break;
    case 'aiDone':        aiDone(data.id); break;
    case 'aiError':       aiError(data.id, data.error); break;
    case 'cleared':       clearDOM(); break;
    case 'contextInjected': onContext(data); break;
    case 'noContext':     showContextBar('No active editor open.', false); break;
    case 'theme':         document.documentElement.setAttribute('data-vscode-theme-kind', data.dark ? 'vscode-dark' : 'vscode-light'); break;
  }
});

vscode.postMessage({ type: 'ready' });

// ── Mode ─────────────────────────────────────────────────────────────────────
function setMode(btn) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  mode = btn.dataset.mode;
  const ph = { chat:'Ask me anything…', generate:'Describe what to build…', debug:'Paste error or buggy code…', explain:'Paste code to explain…', refactor:'Paste code to refactor…', tests:'Paste code to test…' };
  document.getElementById('prompt-box').placeholder = ph[mode] || 'Ask me anything…';
}

function setModeAndFocus(m) {
  const btn = document.querySelector(\`.mode-btn[data-mode="\${m}"]\`);
  if (btn) setMode(btn);
  document.getElementById('prompt-box').focus();
}

function tryPrompt(t) {
  const box = document.getElementById('prompt-box');
  box.value = t;
  box.focus();
  resize(box);
}

// ── Input ────────────────────────────────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
}

function resize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function send() {
  if (streaming) return;
  const box  = document.getElementById('prompt-box');
  const text = box.value.trim();
  if (!text) return;
  box.value = '';
  box.style.height = 'auto';
  vscode.postMessage({ type: 'send', text, mode });
}

function cancel() {
  vscode.postMessage({ type: 'cancel' });
  setStreamUI(false);
}

function clearChat() { vscode.postMessage({ type: 'clear' }); }
function setKey()    { vscode.postMessage({ type: 'setKey' }); }
function injectCtx() { vscode.postMessage({ type: 'context', mode }); }

// ── Render ───────────────────────────────────────────────────────────────────
function renderUser(msg) {
  removeWelcome();
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = \`
    <div class="msg-meta">you &nbsp;<span class="badge badge-mode">\${msg.mode || 'chat'}</span></div>
    <div class="user-bubble">\${esc(msg.content)}</div>\`;
  msgs().appendChild(el);
  scrollBottom();
  setStreamUI(true);
}

function aiStart(id) {
  const el = document.createElement('div');
  el.className = 'msg';
  el.id = 'msg-' + id;
  el.innerHTML = \`
    <div class="msg-meta">DevAI <span id="search-\${id}"></span></div>
    <div class="ai-bubble" id="bubble-\${id}">
      <div class="thinking"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><span>Thinking…</span></div>
    </div>\`;
  msgs().appendChild(el);
  scrollBottom();
  currentId = id;
}

let buffers = {};
function aiDelta(id, delta) {
  if (!buffers[id]) buffers[id] = '';
  buffers[id] += delta;
  const el = document.getElementById('bubble-' + id);
  if (el) { el.innerHTML = renderMarkdown(buffers[id]); scrollBottom(); }
}

function aiSearch(id, query) {
  const el = document.getElementById('search-' + id);
  if (el && query) {
    el.innerHTML = \`<span class="search-pill">🔍 \${esc(query)}</span>\`;
  }
}

function aiDone(id) {
  buffers[id] && addCodeActions(id);
  setStreamUI(false);
  currentId = null;
}

function aiError(id, err) {
  const el = document.getElementById('bubble-' + id);
  if (el) {
    const msg = err === 'NO_API_KEY'
      ? 'No API key set. <a onclick="setKey()">Click here to add your Claude API key.</a>'
      : 'Error: ' + esc(err);
    el.innerHTML = \`<div class="error-msg">\${msg}</div>\`;
  }
  setStreamUI(false);
}

function clearDOM() {
  const m = msgs();
  m.innerHTML = '';
  buffers = {};
  const w = document.createElement('div');
  w.className = 'welcome';
  w.id = 'welcome';
  w.innerHTML = '<p style="color:var(--fg2);font-size:12px;text-align:center;padding:20px">Chat cleared.</p>';
  m.appendChild(w);
}

// ── Code blocks ──────────────────────────────────────────────────────────────
function addCodeActions(id) {
  const bubble = document.getElementById('bubble-' + id);
  if (!bubble) return;
  bubble.querySelectorAll('.code-block').forEach(blk => {
    const pre  = blk.querySelector('pre');
    const acts = blk.querySelector('.code-actions');
    if (!pre || !acts || acts.children.length > 0) return;
    const code = pre.textContent || '';
    acts.innerHTML = \`
      <button class="cbtn" onclick="copyCode(this, \${JSON.stringify(code)})">⎘ copy</button>
      <button class="cbtn" onclick="insertCode(\${JSON.stringify(code)})">↙ insert</button>\`;
  });
}

function copyCode(btn, code) {
  vscode.postMessage({ type: 'copy', text: code });
  btn.textContent = '✓ copied';
  btn.classList.add('ok');
  setTimeout(() => { btn.textContent = '⎘ copy'; btn.classList.remove('ok'); }, 2000);
}

function insertCode(code) {
  vscode.postMessage({ type: 'insert', text: code });
}

// ── Context bar ──────────────────────────────────────────────────────────────
function onContext(data) {
  ctxInfo = data;
  showContextBar(\`📎 \${data.block.split('\\n')[0].replace('**File:**','').trim()}\`, true);
}

function showContextBar(text, good) {
  const bar = document.getElementById('context-bar');
  bar.innerHTML = good
    ? \`<span class="ctx-badge">\${esc(text)}</span>\`
    : \`<span style="color:var(--red);font-size:11px;">\${esc(text)}</span>\`;
}

// ── Key / API ────────────────────────────────────────────────────────────────
function onKeyStatus(data) {
  if (!data.hasKey) {
    const m = msgs();
    const banner = document.createElement('div');
    banner.className = 'no-key';
    banner.id = 'no-key-banner';
    banner.innerHTML = '🔑 <strong>API key not set.</strong> <a onclick="setKey()">Add your Claude API key</a> to get started. <br><small style="color:var(--fg2)">Get one free at <a onclick="openLink()">console.anthropic.com</a></small>';
    m.insertBefore(banner, m.firstChild);
  }
}

function hideNoBanner() {
  document.getElementById('no-key-banner')?.remove();
}

function openLink() {
  vscode.postMessage({ type: 'openUrl', url: 'https://console.anthropic.com' });
}

// ── Markdown renderer ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
  // Code blocks first
  text = text.replace(/\`\`\`(\\w*)?\\n?([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
    const l = lang || 'code';
    return \`<div class="code-block">
      <div class="code-block-header">
        <span class="code-lang">\${esc(l)}</span>
        <div class="code-actions"></div>
      </div>
      <pre>\${esc(code.trimEnd())}</pre>
    </div>\`;
  });
  // Inline code
  text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>');
  // Headings
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  // Lists
  text = text.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>.*<\\/li>\\n?)+/g, s => '<ul>' + s + '</ul>');
  // Paragraphs
  text = text.split('\\n\\n').map(p => p.trim() && !p.includes('<') ? '<p>' + p.trim() + '</p>' : p).join('');
  return text;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function msgs()       { return document.getElementById('messages'); }
function scrollBottom(){ const m = msgs(); m.scrollTop = m.scrollHeight; }
function removeWelcome(){ document.getElementById('welcome')?.remove(); }
function setStreamUI(on) {
  streaming = on;
  document.getElementById('send-btn').disabled   = on;
  document.getElementById('cancel-btn').style.display = on ? 'flex' : 'none';
}
</script>
</body>
</html>`;
  }
}

// ── Types & helpers ───────────────────────────────────────────────────────────

interface WebviewMessage {
  type:  string;
  text:  string;
  mode?: DevAIMode;
  url?:  string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
