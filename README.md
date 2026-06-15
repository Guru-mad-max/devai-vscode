# DevAI – AI Coding Assistant for VS Code

> Production-grade AI coding assistant powered by Claude, with live web search and inline completions.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue?logo=visualstudiocode)
![License](https://img.shields.io/badge/license-MIT-green)
![Build](https://github.com/YOUR_USERNAME/devai-vscode/actions/workflows/release.yml/badge.svg)

---

## Features

| Feature | Description |
|---|---|
| 💬 **AI Chat Sidebar** | Full chat interface, like Copilot Chat — ask anything about your code |
| 🔍 **Live Web Search** | Finds the latest docs, APIs, and Stack Overflow solutions in real time |
| 👻 **Inline Completions** | Ghost-text autocomplete as you type (Tab to accept) |
| ⚡ **Streaming Responses** | See answers appear word-by-word, no waiting |
| 🐛 **Debug & Fix** | Select buggy code → right-click → DevAI: Debug |
| ✨ **Generate Code** | Describe what you need, get production-ready code |
| 🔬 **Explain Code** | Deep explanation of any selected code block |
| ♻️ **Refactor** | Modernize and improve existing code |
| 🧪 **Unit Tests** | Auto-generate test suites for selected code |
| 📝 **Add Comments** | Add JSDoc / docstrings automatically |
| 📎 **Context-Aware** | Sends your current file, language, and cursor position as context |
| 🎨 **Theme-Aware** | Matches your VS Code dark/light theme |
| 🔒 **Secure Key Storage** | API key stored in VS Code's encrypted SecretStorage |

---

## Installation

### From VS Code Marketplace (recommended)
1. Open VS Code
2. Press `Ctrl+P` and run: `ext install devai.devai-assistant`

### Manual (.vsix)
1. Download the latest `.vsix` from [Releases](https://github.com/YOUR_USERNAME/devai-vscode/releases)
2. In VS Code: `Extensions → … → Install from VSIX`

### From source
```bash
git clone https://github.com/YOUR_USERNAME/devai-vscode
cd devai-vscode
npm install
npm run build
```
Then press `F5` in VS Code to launch the Extension Development Host.

---

## Setup

1. Get a free API key at **[console.anthropic.com](https://console.anthropic.com)**
2. In VS Code, run `DevAI: Set Claude API Key` from the Command Palette (`Ctrl+Shift+P`)
3. Click the **DevAI icon** in the Activity Bar (left sidebar) to open the chat

---

## Usage

### Chat Sidebar
Click the DevAI icon in the Activity Bar. Choose a mode:
- **Chat** — general coding questions
- **Generate** — describe what to build
- **Debug** — paste errors or broken code
- **Explain** — understand unfamiliar code
- **Refactor** — improve existing code
- **Tests** — generate unit tests

### Right-Click Context Menu
Select any code → right-click → **DevAI ✦** submenu:

```
DevAI ✦
  ├── Explain Selected Code
  ├── Debug / Fix Selected Code
  ├── Refactor Selected Code
  ├── Generate Unit Tests
  └── Add JSDoc / Comments
```

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Open DevAI Chat |
| `Ctrl+Shift+E` | Explain selected code |
| `Ctrl+Shift+G` | Generate code |
| `Ctrl+Shift+D` | Debug selected code |
| `Ctrl+Shift+R` | Refactor selected code |

### Inline Completions
Start typing and DevAI will suggest completions as ghost text. Press **Tab** to accept.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `devai.model` | `claude-sonnet-4-6` | Claude model to use |
| `devai.enableInlineCompletion` | `true` | Enable ghost-text completions |
| `devai.inlineCompletionDelay` | `600` | Debounce delay (ms) |
| `devai.maxTokens` | `2048` | Max response length |
| `devai.webSearch` | `true` | Enable live web search |
| `devai.contextLines` | `100` | Lines of context sent to AI |

---

## Publishing to VS Code Marketplace

1. [Create a publisher](https://marketplace.visualstudio.com/manage) on VS Code Marketplace
2. Update `publisher` in `package.json`
3. Get a Personal Access Token from Azure DevOps
4. Add it as `VSCE_PAT` in your GitHub repo secrets
5. Push a version tag: `git tag v1.0.0 && git push --tags`

The GitHub Actions workflow will automatically build and publish.

---

## Architecture

```
devai-vscode/
├── src/
│   ├── extension.ts          # Entry point — wires everything
│   ├── api/
│   │   └── claude.ts         # Claude API client (streaming + web search)
│   ├── webview/
│   │   └── ChatPanel.ts      # Sidebar chat UI (WebviewViewProvider)
│   ├── providers/
│   │   └── CompletionProvider.ts  # Inline ghost-text completions
│   ├── commands/
│   │   └── index.ts          # All VS Code command registrations
│   └── utils/
│       └── context.ts        # Editor context extraction
├── .github/workflows/
│   └── release.yml           # CI + Marketplace publish pipeline
├── esbuild.js                # Build script
└── package.json              # Extension manifest
```

---

## Contributing

```bash
npm install          # Install deps
npm run watch        # Watch mode (rebuilds on change)
# Press F5 in VS Code → launches Extension Development Host
```

PRs welcome! Please open an issue first for large changes.

---

## License

MIT © DevAI Contributors
