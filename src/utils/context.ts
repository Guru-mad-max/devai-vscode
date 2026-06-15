import * as vscode from 'vscode';
import * as path    from 'path';

export interface EditorContext {
  /** Selected text, or empty string */
  selection:    string;
  /** Lines around the cursor (for completions / chat context) */
  surroundings: string;
  /** Language identifier (e.g. "typescript", "python") */
  language:     string;
  /** Filename without path */
  filename:     string;
  /** Relative workspace path */
  relativePath: string;
  /** Full file content (may be truncated for large files) */
  fileContent:  string;
  /** Cursor offset in the file */
  cursorLine:   number;
  /** Text BEFORE cursor (for inline completion) */
  prefix:       string;
  /** Text AFTER cursor (for inline completion) */
  suffix:       string;
}

const MAX_FILE_CHARS = 40_000; // ~10k tokens

export function getEditorContext(editor?: vscode.TextEditor): EditorContext | null {
  const e = editor ?? vscode.window.activeTextEditor;
  if (!e) { return null; }

  const doc       = e.document;
  const sel       = e.selection;
  const config    = vscode.workspace.getConfiguration('devai');
  const ctxLines  = config.get<number>('contextLines', 100);
  const wsFolder  = vscode.workspace.getWorkspaceFolder(doc.uri);
  const relPath   = wsFolder
    ? path.relative(wsFolder.uri.fsPath, doc.uri.fsPath)
    : path.basename(doc.uri.fsPath);

  const totalLines = doc.lineCount;
  const cursorLine = sel.active.line;
  const startLine  = Math.max(0, cursorLine - ctxLines);
  const endLine    = Math.min(totalLines - 1, cursorLine + ctxLines);

  const surroundings = doc.getText(new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER));
  const fullText     = doc.getText();
  const fileContent  = fullText.length > MAX_FILE_CHARS
    ? fullText.slice(0, MAX_FILE_CHARS) + '\n// [truncated — file too large]'
    : fullText;

  const cursorOffset = doc.offsetAt(sel.active);
  const prefix = fullText.slice(0, cursorOffset);
  const suffix = fullText.slice(cursorOffset);

  const selection = sel.isEmpty ? '' : doc.getText(sel);

  return {
    selection,
    surroundings,
    language:     doc.languageId,
    filename:     path.basename(doc.uri.fsPath),
    relativePath: relPath,
    fileContent,
    cursorLine:   cursorLine + 1,
    prefix,
    suffix,
  };
}

/** Build a rich context block to prepend to user messages */
export function buildContextBlock(ctx: EditorContext, includeFullFile = false): string {
  const lines: string[] = [
    `**File:** \`${ctx.relativePath}\`  |  **Language:** ${ctx.language}  |  **Line:** ${ctx.cursorLine}`,
    '',
  ];

  if (ctx.selection) {
    lines.push(
      `**Selected code:**`,
      '```' + ctx.language,
      ctx.selection,
      '```',
      '',
    );
  } else if (includeFullFile) {
    lines.push(
      `**File content:**`,
      '```' + ctx.language,
      ctx.fileContent,
      '```',
      '',
    );
  } else {
    lines.push(
      `**Surrounding code (context):**`,
      '```' + ctx.language,
      ctx.surroundings,
      '```',
      '',
    );
  }

  return lines.join('\n');
}

/** Build the prompt for inline ghost-text completion */
export function buildCompletionPrompt(ctx: EditorContext): string {
  const PREFIX_CHARS = 3000;
  const SUFFIX_CHARS = 500;

  const prefix = ctx.prefix.slice(-PREFIX_CHARS);
  const suffix = ctx.suffix.slice(0, SUFFIX_CHARS);

  return [
    `Language: ${ctx.language}`,
    `File: ${ctx.relativePath}`,
    '',
    '<prefix>',
    prefix,
    '</prefix>',
    '<suffix>',
    suffix,
    '</suffix>',
    '',
    'Complete the code at the <cursor> position between prefix and suffix. Output ONLY the inserted text, nothing else.',
  ].join('\n');
}
