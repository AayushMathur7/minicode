import type { ToolDefinition } from "../../types";
import type { AgentMode, ToolPolicyMode } from "../../tools/policy";

// ---------------------------------------------------------------------------
// Agent Definition
// ---------------------------------------------------------------------------
// An agent definition describes a "persona" that the main agent can delegate
// work to. Each definition carries its own system prompt, tool restrictions,
// and (optionally) a different model identifier.
//
// This is the minicode equivalent of Claude Code's BuiltInAgentDefinition
// (see claude-code/src/tools/AgentTool/loadAgentsDir.ts).
// ---------------------------------------------------------------------------

export type AgentDefinition = {
    /** Unique key the model uses to select this agent (e.g. "explore"). */
    name: string;

    /** One-line description shown to the model so it knows when to delegate. */
    description: string;

    /**
     * System prompt injected into the sub-agent's conversation.
     * Receives the parent's cwd so it can reference the workspace.
     */
    getSystemPrompt: (cwd: string) => string;

    /**
     * Whitelist of tool names this agent is allowed to use.
     * `undefined` means "all tools" (after the global subagent blocklist
     * is applied — see filterToolsForSubagent in policy.ts).
     */
    allowedTools?: string[];

    /**
     * Additional tool names to explicitly block for this agent,
     * applied on top of the global SUBAGENT_BLOCKED_TOOLS.
     */
    blockedTools?: string[];

    /** Optional model override (e.g. a cheaper model for read-only work). */
    model?: string;

    /** Tool policy mode for the sub-agent. Defaults to parent's mode. */
    toolPolicyMode?: ToolPolicyMode;

    /** Agent mode the sub-agent runs in. Defaults to "execute". */
    agentMode?: AgentMode;
};

// ---------------------------------------------------------------------------
// Built-in agents
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = [
    "read_file",
    "read_file_range",
    "search_code",
    "list_files",
    "get_file_outline",
    "run_command",
];

export const exploreAgent: AgentDefinition = {
    name: "explore",
    description:
        "Fast, read-only codebase search. Use when you need to find files, " +
        "understand code structure, or answer questions about the codebase " +
        "without making any changes.",
    allowedTools: READ_ONLY_TOOLS,
    agentMode: "execute",
    getSystemPrompt: (cwd: string) => [
        "You are a read-only search specialist working inside a local repository.",
        "",
        "=== CRITICAL: READ-ONLY MODE ===",
        "You MUST NOT create, modify, or delete any files.",
        "Your job is to search, read, and report findings — nothing else.",
        "",
        "Strengths:",
        "- Finding files with list_files",
        "- Searching code with search_code (regex-capable via ripgrep)",
        "- Reading files with read_file / read_file_range",
        "- Understanding structure with get_file_outline",
        "- Running read-only commands (git log, git diff, ls, cat) with run_command",
        "",
        "Guidelines:",
        "- Use list_files for broad discovery, then search_code to narrow down.",
        "- Prefer read_file_range over read_file when you only need a section.",
        "- Run multiple searches in sequence if the first one isn't enough.",
        "- NEVER use run_command to modify anything (no git add, npm install, rm, etc.).",
        "- Be concise: report your findings clearly and stop.",
        "",
        `Working directory: ${cwd}`,
    ].join("\n"),
};

export const generalAgent: AgentDefinition = {
    name: "general",
    description:
        "General-purpose agent for complex, multi-step tasks that require " +
        "both reading and writing. Use when the task involves code changes, " +
        "running tests, or any modification to the repository.",
    // undefined means "all tools" — the subagent blocklist in policy.ts
    // will still remove dangerous tools like the agent tool itself.
    allowedTools: undefined,
    agentMode: "execute",
    getSystemPrompt: (cwd: string) => [
        "You are a sub-agent completing a specific task inside a local repository.",
        "",
        "You have access to the full set of coding tools (read, write, search, run commands).",
        "Focus exclusively on the task you were given. Do not wander beyond its scope.",
        "",
        "Guidelines:",
        "- Read before you write: understand existing code first.",
        "- Prefer apply_patch for targeted edits over write_file.",
        "- After edits, verify with run_typecheck / run_tests when relevant.",
        "- Be concise in your final message: explain what you did and stop.",
        "",
        `Working directory: ${cwd}`,
    ].join("\n"),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All built-in agent definitions, keyed by name. */
export const builtInAgents: ReadonlyMap<string, AgentDefinition> = new Map([
    [exploreAgent.name, exploreAgent],
    [generalAgent.name, generalAgent],
]);

/** Look up an agent definition by name. Returns undefined if not found. */
export function getAgentDefinition(name: string): AgentDefinition | undefined {
    return builtInAgents.get(name);
}

/** List all available agent type names (used in error messages / prompts). */
export function getAvailableAgentNames(): string[] {
    return [...builtInAgents.keys()];
}
