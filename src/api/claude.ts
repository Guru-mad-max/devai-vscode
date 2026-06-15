import * as vscode from 'vscode';

export type ClaudeRole    = 'user' | 'assistant';
export type DevAIMode     = 'chat' | 'explain' | 'generate' | 'debug' | 'refactor' | 'tests' | 'comments';

export interface Message {
  role:    ClaudeRole;
  content: string;
}

export interface StreamChunk {
  type:  'text' | 'search' | 'done' | 'error';
  value: string;
}

export type StreamCallback = (chunk: StreamChunk) => void;

// ── System prompts per mode ──────────────────────────────────────────────────

const SYSTEM: Record<DevAIMode, string> = {
  chat: `You are DevAI, a world-class AI coding assistant built into VS Code, similar to GitHub Copilot. You have access to real-time web search to find the latest docs and APIs.

Rules:
- Always produce complete, production-ready, runnable code
- Use proper error handling, types, and comments
- Format code in fenced code blocks with the language tag
- When suggesting packages, search for the latest version
- Be concise in explanation but thorough in code
- Adapt your response to the language/framework in the user's file`,

  explain: `You are DevAI in Explain mode. Analyze the provided code thoroughly.

Return:
1. A plain-English summary (2-3 sentences)
2. Line-by-line breakdown of key parts
3. Any potential bugs, edge cases, or improvements
4. Relevant docs links (search for them)

Keep explanations developer-friendly. Use code blocks for examples.`,

  generate: `You are DevAI in Generate mode. Convert the user's description or TODO comment into complete, production-ready code.

Rules:
- Write the full implementation, not just a skeleton
- Include error handling, types (TypeScript/JSDoc where applicable)
- Add concise inline comments on non-obvious logic
- Search for the latest API/library syntax before generating
- Match the language and style of the surrounding code if provided`,

  debug: `You are DevAI in Debug mode. Find and fix the bug in the provided code.

Return:
1. Root cause analysis (1-2 sentences)
2. Fixed code in a code block
3. Explanation of the fix
4. How to prevent this in the future

Search for known issues/solutions if relevant (e.g., common framework bugs).`,

  refactor: `You are DevAI in Refactor mode. Improve the provided code.

Return:
1. What you changed and why (bullet list)
2. The fully refactored code in a code block
3. Any further suggestions

Focus on: readability, performance, modern idioms, DRY principles, and type safety.`,

  tests: `You are DevAI in Test Generation mode. Write comprehensive unit tests for the provided code.

Rules:
- Use the test framework that matches the project (Jest/Vitest/pytest/etc.) — search if unsure
- Test: happy paths, edge cases, error cases, boundary values
- Mock external dependencies
- Include a brief comment above each test describing what it tests
- Return complete, runnable test file`,

  comments: `You are DevAI in Documentation mode. Add comprehensive documentation to the provided code.

Rules:
- Add JSDoc / TSDoc / docstrings appropriate to the language
- Document: parameters, return values, thrown errors, examples
- Add inline comments for non-obvious logic
- Do NOT change any logic — only add documentation
- Return the fully documented code`,
};

// ── Main API Client ──────────────────────────────────────────────────────────

export class ClaudeClient {
  private static readonly API_URL  = 'https://api.anthropic.com/v1/messages';
  private static readonly API_VER  = '2023-06-01';
  private static readonly MAX_RETRY = 2;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Retrieve API key from SecretStorage */
  async getApiKey(): Promise<string | undefined> {
    return this.ctx.secrets.get('devai.apiKey');
  }

  /** Persist API key in SecretStorage */
  async setApiKey(key: string): Promise<void> {
    await this.ctx.secrets.store('devai.apiKey', key.trim());
  }

  private get config() {
    return vscode.workspace.getConfiguration('devai');
  }

  /** Stream a response from Claude, calling `onChunk` for each delta */
  async streamResponse(
    messages:    Message[],
    mode:        DevAIMode,
    onChunk:     StreamCallback,
    signal?:     AbortSignal,
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      onChunk({ type: 'error', value: 'NO_API_KEY' });
      return;
    }

    const model      = this.config.get<string>('model', 'claude-sonnet-4-6');
    const maxTokens  = this.config.get<number>('maxTokens', 2048);
    const webSearch  = this.config.get<boolean>('webSearch', true);

    const tools = webSearch ? [{ type: 'web_search_20250305', name: 'web_search' }] : [];

    const body = {
      model,
      max_tokens: maxTokens,
      system:     SYSTEM[mode],
      stream:     true,
      messages,
      ...(tools.length ? { tools } : {}),
    };

    for (let attempt = 0; attempt <= ClaudeClient.MAX_RETRY; attempt++) {
      try {
        await this._stream(body, onChunk, signal);
        return;
      } catch (err: unknown) {
        const isLast = attempt === ClaudeClient.MAX_RETRY;
        if (isLast || signal?.aborted) {
          onChunk({ type: 'error', value: errorMessage(err) });
          return;
        }
        // exponential back-off
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }

  private async _stream(
    body:    object,
    onChunk: StreamCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKey = (await this.getApiKey())!;

    const res = await fetch(ClaudeClient.API_URL, {
      method:  'POST',
      signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':          apiKey,
        'anthropic-version':  ClaudeClient.API_VER,
        'anthropic-beta':     'interleaved-thinking-2025-05-14',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`API ${res.status}: ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) { throw new Error('No response body'); }

    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data: ')) { continue; }
        const data = line.slice(6);
        if (data === '[DONE]') { break; }

        try {
          const evt = JSON.parse(data);

          // text delta
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            onChunk({ type: 'text', value: evt.delta.text });
          }
          // tool use = web search happening
          if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
            const q = (evt.content_block?.input as { query?: string })?.query ?? '';
            onChunk({ type: 'search', value: q });
          }
        } catch {
          // malformed SSE line – skip
        }
      }
    }
    onChunk({ type: 'done', value: '' });
  }

  /** One-shot (non-streaming) completion for inline autocomplete */
  async complete(prompt: string, signal?: AbortSignal): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) { return ''; }

    const model     = this.config.get<string>('model', 'claude-sonnet-4-6');
    const res = await fetch(ClaudeClient.API_URL, {
      method:  'POST',
      signal,
      headers: {
        'Content-Type':     'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': ClaudeClient.API_VER,
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        system: 'You are a code completion engine. Return ONLY the code that should follow the cursor. No explanation, no markdown, no code fences. Just the raw continuation.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) { return ''; }
    const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
    return json.content?.find(b => b.type === 'text')?.text?.trim() ?? '';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) { return err.message; }
  return String(err);
}
