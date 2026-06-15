import * as vscode from 'vscode';
import { ChatPanel }               from '../webview/ChatPanel';
import { ClaudeClient }            from '../api/claude';
import { getEditorContext, buildContextBlock } from '../utils/context';

export function registerCommands(
  ctx:    vscode.ExtensionContext,
  panel:  ChatPanel,
  client: ClaudeClient,
): void {

  // ── Open Chat ──────────────────────────────────────────────────────────────
  reg(ctx, 'devai.openChat', () => {
    vscode.commands.executeCommand('devai.chatView.focus');
  });

  // ── Set API Key ────────────────────────────────────────────────────────────
  reg(ctx, 'devai.setApiKey', async () => {
    const key = await vscode.window.showInputBox({
      prompt:      'Enter your Anthropic Claude API key',
      password:    true,
      placeHolder: 'sk-ant-api03-…',
      validateInput: v => v?.startsWith('sk-') ? null : 'Key must start with sk-',
    });
    if (key) {
      await client.setApiKey(key);
      vscode.window.showInformationMessage('DevAI: API key saved ✓');
    }
  });

  // ── Clear History ──────────────────────────────────────────────────────────
  reg(ctx, 'devai.clearHistory', () => {
    vscode.commands.executeCommand('devai.chatView.focus');
    panel.sendWithContext('', 'chat'); // triggers clear via UI
  });

  // ── Explain Code ──────────────────────────────────────────────────────────
  reg(ctx, 'devai.explainCode', async () => {
    const ec = requireSelection('explain');
    if (!ec) { return; }
    await panel.sendWithContext(
      `Explain this ${ec.language} code in detail:\n\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'explain',
    );
  });

  // ── Generate Code ──────────────────────────────────────────────────────────
  reg(ctx, 'devai.generateCode', async () => {
    const ec = getEditorContext();
    const prompt = await vscode.window.showInputBox({
      prompt:      'Describe the code you want to generate',
      placeHolder: 'e.g. a React hook that debounces an input value',
    });
    if (!prompt) { return; }

    const ctx_block = ec ? buildContextBlock(ec) : '';
    await panel.sendWithContext(
      ctx_block + '\n\nGenerate: ' + prompt,
      'generate',
    );
  });

  // ── Debug / Fix Code ───────────────────────────────────────────────────────
  reg(ctx, 'devai.debugCode', async () => {
    const ec = requireSelection('debug');
    if (!ec) { return; }
    await panel.sendWithContext(
      `Debug and fix this ${ec.language} code. Identify the bug and return a corrected version:\n\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'debug',
    );
  });

  // ── Refactor Code ─────────────────────────────────────────────────────────
  reg(ctx, 'devai.refactorCode', async () => {
    const ec = requireSelection('refactor');
    if (!ec) { return; }
    await panel.sendWithContext(
      `Refactor this ${ec.language} code for readability, performance, and modern best practices:\n\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'refactor',
    );
  });

  // ── Generate Unit Tests ────────────────────────────────────────────────────
  reg(ctx, 'devai.generateTests', async () => {
    const ec = requireSelection('tests');
    if (!ec) { return; }
    await panel.sendWithContext(
      `Write comprehensive unit tests for this ${ec.language} code:\n\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'tests',
    );
  });

  // ── Add Comments / JSDoc ──────────────────────────────────────────────────
  reg(ctx, 'devai.addComments', async () => {
    const ec = requireSelection('comments');
    if (!ec) { return; }
    await panel.sendWithContext(
      `Add comprehensive JSDoc/docstring documentation to this ${ec.language} code without changing any logic:\n\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'comments',
    );
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function reg(
  ctx:     vscode.ExtensionContext,
  id:      string,
  handler: (...args: unknown[]) => unknown,
): void {
  ctx.subscriptions.push(vscode.commands.registerCommand(id, handler));
}

function requireSelection(action: string) {
  const ec = getEditorContext();
  if (!ec?.selection) {
    vscode.window.showWarningMessage(
      `DevAI: Select some code first to ${action} it.`,
    );
    return null;
  }
  return ec;
}
