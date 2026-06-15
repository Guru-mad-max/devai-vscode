# DevAI – Local AI Coding Assistant for VS Code

> 100% free, 100% private. Powered by Ollama — runs entirely on your machine. No API key, no internet, no subscription.

![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blue?logo=visualstudiocode)
![License](https://img.shields.io/badge/license-MIT-green)
![Ollama](https://img.shields.io/badge/powered%20by-Ollama-orange)

---

## ✨ Features

- 💬 **AI Chat Sidebar** — Chat about your code, like Copilot Chat but local
- 👻 **Inline Completions** — Ghost-text autocomplete as you type (Tab to accept)
- 🐛 **Debug & Fix** — Select buggy code → right-click → DevAI: Debug
- ✨ **Generate Code** — Describe what you need, get production-ready code
- 🔬 **Explain Code** — Deep explanation of any selected code block
- ♻️ **Refactor** — Modernize and improve existing code
- 🧪 **Unit Tests** — Auto-generate test suites for selected code
- 📝 **Add Comments** — Add JSDoc/RDoc/docstrings automatically
- 🔒 **100% Private** — Your code never leaves your machine
- 🆓 **Completely Free** — No subscriptions, no API fees, no limits

---

## 🚀 Setup (5 minutes, one-time)

### Step 1 — Install Ollama
Download from **[ollama.com/download](https://ollama.com/download)** and install it.

### Step 2 — Pull a coding model
Open Terminal and run:
```bash
# Best for code (recommended)
ollama pull qwen2.5-coder:7b

# OR Meta's code model
ollama pull codellama:7b

# OR lightweight (fast on any Mac)
ollama pull llama3.2:3b
```

### Step 3 — Start Ollama
```bash
ollama serve
```

### Step 4 — Install DevAI in VS Code
- Open VS Code → Extensions → search `devai-assistant`
- Or press `Ctrl+P` → `ext install devai.devai-assistant`

That's it! DevAI auto-detects Ollama and your models.

---

## 📋 Usage

### Chat Sidebar
Click the **DevAI icon** in the Activity Bar. Choose a mode and start asking.

| Mode | What it does |
|---|---|
| Chat | General coding Q&A |
| Generate | Build from description |
| Debug | Find & fix bugs |
| Explain | Understand any code |
| Refactor | Modernize old code |
| Tests | Write test suites |

### Right-Click Menu
Select any code → right-click → **DevAI ✦**:
- Explain Selected Code
- Debug / Fix Selected Code
- Refactor Selected Code
- Generate Unit Tests
- Add Comments / Docs

### Keyboard Shortcuts
| Keys | Action |
|---|---|
| `Ctrl+Shift+A` | Open Chat |
| `Ctrl+Shift+E` | Explain selection |
| `Ctrl+Shift+G` | Generate code |
| `Ctrl+Shift+D` | Debug selection |
| `Ctrl+Shift+R` | Refactor selection |

---

## ⚙️ Settings

| Setting | Default | Description |
|---|---|---|
| `devai.ollamaHost` | `http://localhost:11434` | Ollama server URL |
| `devai.ollamaModel` | `qwen2.5-coder:7b` | Model to use |
| `devai.enableInlineCompletion` | `true` | Ghost-text completions |
| `devai.maxTokens` | `2048` | Max response length |
| `devai.contextLines` | `100` | Lines of context sent to AI |

---

## 🤖 Recommended Models

| Model | Size | Best for |
|---|---|---|
| `qwen2.5-coder:7b` | 4.7GB | Code generation, debugging ⭐ |
| `qwen2.5-coder:14b` | 9GB | Complex refactoring |
| `codellama:7b` | 3.8GB | General coding |
| `deepseek-coder-v2:16b` | 9GB | Large codebases |
| `llama3.2:3b` | 2GB | Fast, lightweight tasks |

---

## License
MIT © DevAI Contributors
