# minicode

A local AI coding agent with a terminal UI. Think, plan, and execute code changes through an interactive agent loop powered by OpenAI's Responses API.

Built with Bun, React Ink, and TypeScript.

## Features

- **Agent loop** — think-act-observe cycle that reads code, proposes changes, and executes them
- **15 built-in tools** — file read/write, search (ripgrep), patch, run commands, typecheck, test
- **Plan mode** — explore and plan before making changes, with approval gates
- **Sub-agents** — delegate tasks to background agents (explore-only or full capability)
- **Skills** — extensible markdown-based skill system (`.minicode/skills/`)
- **Session persistence** — resume previous sessions, search across history
- **Permission system** — prompts before sensitive operations, safe/full mode toggle
- **Path-aware concurrency** — parallel reads, serialized writes to the same file
- **Context compaction** — summarize old messages when approaching token limits

## Setup

```bash
bun install
```

Set your OpenAI API key:

```bash
export OPENAI_API_KEY=sk-...
```

Bun loads `.env` automatically, so you can also put it there.

## Usage

```bash
# Start the TUI
bun run tui

# Start with an initial prompt
bun run tui "fix the bug in src/foo.ts"

# Resume the last session
bun run tui --continue

# Resume a specific session
bun run tui --resume <session-id>
```

### Slash commands

| Command | Description |
|---|---|
| `/plan` | Switch to plan mode (read-only exploration) |
| `/execute` | Switch to execute mode (apply changes) |
| `/sessions` | List saved sessions |
| `/resume <n>` | Resume a specific session |
| `/search <query>` | Search across sessions |
| `/compact` | Compress old context |
| `/clear` | Clear the screen |
| `/help` | Show all commands |
| `/quit` | Exit |

## Project structure

```
src/
  agent/          # Agent loop, system prompt, plans, compaction
  tools/          # Tool definitions (read, write, search, patch, etc.)
  llm/            # LLM client abstraction (OpenAI Responses API)
  ui/             # React/Ink terminal interface
  context/        # Message assembly
  skills/         # Skill loader
  entrypoints/    # CLI entry point
.minicode/
  settings.json   # Hooks configuration
  skills/         # Custom skills (markdown)
  sessions/       # Session history (JSONL)
```

## Configuration

### Hooks

Configure pre/post tool hooks in `.minicode/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "your-check.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "prettier --write" }] }
    ]
  }
}
```

### Skills

Add custom skills as markdown files in `.minicode/skills/`:

```markdown
---
name: my-skill
description: What this skill does
---

Instructions for the agent when this skill is invoked...
```

## Development

```bash
# Run tests
bun test

# Type check
bun run check
```
