import * as vscode from 'vscode';
import { OllamaClient }       from './api/ollama';
import { ChatPanel }          from './webview/ChatPanel';
import { CompletionProvider } from './providers/CompletionProvider';
import { registerCommands }   from './commands/index';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[DevAI] Activating…');

  const client = new OllamaClient();
  const panel  = new ChatPanel(context, client);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatPanel.viewType, panel,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  const completionProvider = new CompletionProvider(client);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' }, completionProvider,
    ),
  );

  registerCommands(context, panel, client);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text    = '$(sparkle) DevAI';
  status.tooltip = 'Open DevAI — Local AI Coding Assistant';
  status.command = 'devai.openChat';
  status.show();
  context.subscriptions.push(status);

  // Check Ollama on startup
  checkOllamaOnStartup(client);

  console.log('[DevAI] Ready ✓');
}

export function deactivate(): void {}

async function checkOllamaOnStartup(client: OllamaClient): Promise<void> {
  const running = await client.isRunning();
  if (!running) {
    const pick = await vscode.window.showWarningMessage(
      'DevAI: Ollama is not running. Start it to use DevAI.',
      'Download Ollama',
      'How to start',
    );
    if (pick === 'Download Ollama') {
      vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
    } else if (pick === 'How to start') {
      vscode.window.showInformationMessage(
        'Run in your terminal: ollama serve  —  then: ollama pull qwen2.5-coder:7b',
      );
    }
    return;
  }

  const models = await client.getModels();
  if (models.length === 0) {
    const pick = await vscode.window.showWarningMessage(
      'DevAI: Ollama is running but no models are installed.',
      'Install coding model',
    );
    if (pick === 'Install coding model') {
      const terminal = vscode.window.createTerminal('DevAI Setup');
      terminal.show();
      terminal.sendText('ollama pull qwen2.5-coder:7b');
    }
  }
}
