import * as vscode from 'vscode';

export type DevAIMode = 'chat' | 'explain' | 'generate' | 'debug' | 'refactor' | 'tests' | 'comments';

export interface Message {
  role:    'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaModel {
  name:       string;
  modified_at: string;
  size:       number;
}

export interface StreamChunk {
  type:  'text' | 'done' | 'error';
  value: string;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM: Record<DevAIMode, string> = {
  chat: `You are DevAI, a world-class AI coding assistant running locally on the developer's machine via Ollama. You write production-ready, complete, runnable code. Always use proper error handling, types, and comments. Format all code in fenced blocks with language tags. Be concise in explanation but thorough in code. Adapt to the language and framework shown in the user's file.`,

  explain: `You are DevAI in Explain mode. Analyze the provided code thoroughly and return:
1. A plain-English summary (2-3 sentences)
2. Breakdown of key parts with line references
3. Potential bugs, edge cases, or improvements
4. Suggestions for better patterns

Keep explanations developer-friendly. Use code blocks for examples.`,

  generate: `You are DevAI in Generate mode. Convert the user's description into complete, production-ready code.
- Write the full implementation, not a skeleton
- Include error handling and types
- Add concise inline comments on non-obvious logic
- Match the language and style of surrounding code if provided`,

  debug: `You are DevAI in Debug mode. Find and fix bugs systematically.
Return:
1. Root cause (1-2 sentences)
2. Fixed code in a code block
3. Explanation of the fix
4. How to prevent this class of bug`,

  refactor: `You are DevAI in Refactor mode. Improve code quality, readability and performance.
Return:
1. What you changed and why (bullet list)
2. The fully refactored code
3. Any further suggestions`,

  tests: `You are DevAI in Test Generation mode. Write comprehensive unit/integration tests.
- Detect and use the existing test framework (RSpec, Jest, pytest, etc.)
- Cover: happy paths, edge cases, error cases, boundary values
- Mock external dependencies
- Add a comment above each test describing what it covers
- Return a complete, runnable test file`,

  comments: `You are DevAI in Documentation mode. Add comprehensive documentation without changing any logic.
- Add JSDoc/TSDoc/RDoc/docstrings appropriate to the language
- Document parameters, return values, thrown errors, examples
- Add inline comments for non-obvious logic
- Return the fully documented code`,
};

// ── Ollama Client ─────────────────────────────────────────────────────────────

export class OllamaClient {
  private get host(): string {
    return vscode.workspace.getConfiguration('devai').get<string>('ollamaHost', 'http://localhost:11434');
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('devai').get<string>('ollamaModel', 'llama3.2');
  }

  private get maxTokens(): number {
    return vscode.workspace.getConfiguration('devai').get<number>('maxTokens', 2048);
  }

  /** Check if Ollama is running and return available models */
  async getModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) { return []; }
      const json = await res.json() as { models?: OllamaModel[] };
      return json.models ?? [];
    } catch {
      return [];
    }
  }

  async isRunning(): Promise<boolean> {
    const models = await this.getModels();
    return models.length >= 0;  // returns [] even with no models if running
  }

  /** Stream a response, calling onChunk for each text delta */
  async streamResponse(
    messages:  Message[],
    mode:      DevAIMode,
    onChunk:   StreamCallback,
    signal?:   AbortSignal,
  ): Promise<void> {
    const systemMsg: Message = { role: 'system', content: SYSTEM[mode] };
    const allMessages = [systemMsg, ...messages];

    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    this.model,
          messages: allMessages,
          stream:   true,
          options:  { num_predict: this.maxTokens, temperature: 0.2 },
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        onChunk({ type: 'error', value: `Ollama error ${res.status}: ${text}` });
        return;
      }

      const reader  = res.body?.getReader();
      if (!reader) { onChunk({ type: 'error', value: 'No response stream' }); return; }

      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { continue; }
          try {
            const evt = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };

            if (evt.error) {
              onChunk({ type: 'error', value: evt.error });
              return;
            }
            if (evt.message?.content) {
              onChunk({ type: 'text', value: evt.message.content });
            }
            if (evt.done) {
              onChunk({ type: 'done', value: '' });
              return;
            }
          } catch {
            // malformed line — skip
          }
        }
      }
      onChunk({ type: 'done', value: '' });

    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') { return; }
      const msg = err instanceof Error ? err.message : String(err);
      onChunk({ type: 'error', value: msg.includes('fetch') ? 'OLLAMA_NOT_RUNNING' : msg });
    }
  }

  /** One-shot completion for inline autocomplete */
  async complete(prompt: string, signal?: AbortSignal): Promise<string> {
    try {
      const res = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  this.model,
          prompt,
          stream: false,
          options: { num_predict: 128, temperature: 0.1, stop: ['\n\n', '```'] },
        }),
      });
      if (!res.ok) { return ''; }
      const json = await res.json() as { response?: string };
      return (json.response ?? '').trim();
    } catch {
      return '';
    }
  }
}
