import * as vscode from 'vscode';
import { ChatPanel }        from '../webview/ChatPanel';
import { OllamaClient }     from '../api/ollama';
import { getEditorContext, buildContextBlock } from '../utils/context';

export function registerCommands(
  ctx:    vscode.ExtensionContext,
  panel:  ChatPanel,
  client: OllamaClient,
): void {

  reg(ctx, 'devai.openChat', () => {
    vscode.commands.executeCommand('devai.chatView.focus');
  });

  reg(ctx, 'devai.setApiKey', async () => {
    vscode.window.showInformationMessage('DevAI uses Ollama (local) — no API key needed! Just run: ollama serve');
  });

  reg(ctx, 'devai.clearHistory', () => {
    vscode.commands.executeCommand('devai.chatView.focus');
  });

  reg(ctx, 'devai.explainCode', async () => {
    const ec = requireSel('explain'); if (!ec) { return; }
    await panel.sendWithContext(
      `Explain this ${ec.language} code in detail:\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'explain',
    );
  });

  reg(ctx, 'devai.generateCode', async () => {
    const ec = getEditorContext();
    const prompt = await vscode.window.showInputBox({
      prompt: 'Describe the code to generate',
      placeHolder: 'e.g. RSpec test for a customer creation flow',
    });
    if (!prompt) { return; }
    const ctx_block = ec ? buildContextBlock(ec) : '';
    await panel.sendWithContext(ctx_block + '\n\nGenerate: ' + prompt, 'generate');
  });

  reg(ctx, 'devai.debugCode', async () => {
    const ec = requireSel('debug'); if (!ec) { return; }
    await panel.sendWithContext(
      `Debug and fix this ${ec.language} code:\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'debug',
    );
  });

  reg(ctx, 'devai.refactorCode', async () => {
    const ec = requireSel('refactor'); if (!ec) { return; }
    await panel.sendWithContext(
      `Refactor this ${ec.language} code for readability and best practices:\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'refactor',
    );
  });

  reg(ctx, 'devai.generateTests', async () => {
    const ec = requireSel('tests'); if (!ec) { return; }
    await panel.sendWithContext(
      `Write comprehensive ${ec.language} tests for:\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'tests',
    );
  });

  reg(ctx, 'devai.addComments', async () => {
    const ec = requireSel('comments'); if (!ec) { return; }
    await panel.sendWithContext(
      `Add full documentation/comments to this ${ec.language} code without changing logic:\n\`\`\`${ec.language}\n${ec.selection}\n\`\`\``,
      'comments',
    );
  });

  // Quick model picker command
  reg(ctx, 'devai.pickModel', async () => {
    const models = await client.getModels();
    if (!models.length) {
      vscode.window.showWarningMessage('No Ollama models installed. Run: ollama pull qwen2.5-coder:7b');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      models.map(m => ({ label: m.name, description: `${(m.size / 1e9).toFixed(1)} GB` })),
      { placeHolder: 'Select Ollama model for DevAI' },
    );
    if (pick) {
      await vscode.workspace.getConfiguration('devai').update('ollamaModel', pick.label, true);
      vscode.window.showInformationMessage(`DevAI: switched to ${pick.label}`);
    }
  });
}

function reg(ctx: vscode.ExtensionContext, id: string, fn: (...a: unknown[]) => unknown) {
  ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
}

function requireSel(action: string) {
  const ec = getEditorContext();
  if (!ec?.selection) {
    vscode.window.showWarningMessage(`DevAI: Select code first to ${action} it.`);
    return null;
  }
  return ec;
}
