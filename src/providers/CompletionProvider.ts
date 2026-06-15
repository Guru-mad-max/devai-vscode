import * as vscode from 'vscode';
import { OllamaClient }                              from '../api/ollama';
import { getEditorContext, buildCompletionPrompt }   from '../utils/context';

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
  private pending:   AbortController | null = null;
  private debouncer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly client: OllamaClient) {}

  provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token:    vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    const config  = vscode.workspace.getConfiguration('devai');
    const enabled = config.get<boolean>('enableInlineCompletion', true);
    const delay   = config.get<number>('inlineCompletionDelay', 800);

    if (!enabled) { return Promise.resolve(null); }

    const lineText = document.lineAt(position.line).text.slice(0, position.character).trim();
    if (lineText.length < 4) { return Promise.resolve(null); }

    return new Promise((resolve) => {
      if (this.debouncer) { clearTimeout(this.debouncer); }
      this.debouncer = setTimeout(async () => {
        if (token.isCancellationRequested) { resolve(null); return; }

        this.pending?.abort();
        this.pending = new AbortController();

        try {
          const editor = vscode.window.activeTextEditor;
          const ctx    = getEditorContext(editor);
          if (!ctx) { resolve(null); return; }

          const prompt = buildCompletionPrompt(ctx);
          const text   = await this.client.complete(prompt, this.pending.signal);

          if (!text || token.isCancellationRequested) { resolve(null); return; }

          resolve({
            items: [new vscode.InlineCompletionItem(
              text,
              new vscode.Range(position, position),
            )],
          });
        } catch {
          resolve(null);
        }
      }, delay);
    });
  }
}
