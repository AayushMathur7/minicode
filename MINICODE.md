# Minicode Project Instructions

## Runtime
- Bun runtime, not Node.js
- `bun test` for tests, `bun check` (tsc --noEmit) for type checking
- Bun auto-loads .env — no dotenv needed

## Architecture
- Agent loop: `src/agent/runAgent.ts` — main think-act-observe cycle
- Tools: `src/tools/` — each tool is a `ToolDefinition` with name, schema, accessLevel, execute
- LLM client: `src/llm/openai.ts` — OpenAI Responses API with streaming
- UI: `src/ui/` — React/Ink terminal interface
- Sub-agents: `src/tools/agentTool.ts` — background agents via notification queue

## Conventions
- TypeScript strict mode, no `any`
- Prefer `type` over `interface` unless extending
- Tools declare `accessLevel: "read" | "write"` — this drives permission prompts and concurrent execution
- File paths in tool args use the key `path` — the concurrency system extracts paths from this field
- Keep tool execute functions pure: take args + context, return string

## Testing
- Tests live next to source: `foo.ts` → `foo.test.ts`
- Use `bun:test` imports: `import { test, expect, describe } from "bun:test"`
- Test clients: `StubClient` for unit tests, `ScriptedClient` for agent loop tests
- Both must implement `hasPendingToolCalls(): boolean`

## Key patterns
- Sub-agents run on the same event loop (no threads/forks), concurrency comes from async I/O
- Background agents use fire-and-forget Promises with a notification queue drained between turns
- Tool concurrency is path-aware: writes to different files run in parallel, same file serialized
- Policy filtering: safe/full modes + per-agent tool restrictions via `filterToolsForSubagent()`
