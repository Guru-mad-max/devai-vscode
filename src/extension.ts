import * as vscode from 'vscode';
import { ClaudeClient }       from './api/claude';
import { ChatPanel }          from './webview/ChatPanel';
import { CompletionProvider } from './providers/CompletionProvider';
import { registerCommands }   from './commands/index';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[DevAI] Activating…');

  // ── Core services ──────────────────────────────────────────────────────────
  const client = new ClaudeClient(context);
  const panel  = new ChatPanel(context, client);

  // ── Sidebar webview ────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatPanel.viewType,
      panel,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // ── Inline completions ─────────────────────────────────────────────────────
  const completionProvider = new CompletionProvider(client);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      completionProvider,
    ),
  );

  // ── Commands ───────────────────────────────────────────────────────────────
  registerCommands(context, panel, client);

  // ── Status bar item ────────────────────────────────────────────────────────
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100,
  );
  status.text     = '$(sparkle) DevAI';
  status.tooltip  = 'Open DevAI Chat (Ctrl+Shift+A)';
  status.command  = 'devai.openChat';
  status.show();
  context.subscriptions.push(status);

  // ── First-run prompt ───────────────────────────────────────────────────────
  promptFirstRun(client);

  console.log('[DevAI] Ready ✓');
}

export function deactivate(): void {
  console.log('[DevAI] Deactivated.');
}

async function promptFirstRun(client: ClaudeClient): Promise<void> {
  const key = await client.getApiKey();
  if (key) { return; }

  const choice = await vscode.window.showInformationMessage(
    'Welcome to DevAI! Add your Claude API key to get started.',
    'Add API Key',
    'Get a free key',
    'Later',
  );

  if (choice === 'Add API Key') {
    vscode.commands.executeCommand('devai.setApiKey');
  } else if (choice === 'Get a free key') {
    vscode.env.openExternal(vscode.Uri.parse('https://console.anthropic.com'));
  }
}
