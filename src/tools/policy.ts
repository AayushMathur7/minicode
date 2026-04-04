import type { AgentDefinition } from "../agent/agents";
import { type ToolDefinition } from "../types";

export type ToolPolicyMode = "safe" | "full";
const SAFE_MODE_ALLOWED_WRITE_TOOLS = new Set(["write_plan"]);

// Tools that only make sense in plan mode — hidden from execute mode.
const PLAN_ONLY_TOOLS = new Set(["write_plan", "exit_plan_mode"]);

// Write tools that ARE allowed in plan mode (plan-specific writes).
// Every other write tool is visible but gated at execution time.
const PLAN_MODE_ALLOWED_WRITES = new Set(["write_plan", "exit_plan_mode"]);

// ---------------------------------------------------------------------------
// Subagent tool restrictions
// ---------------------------------------------------------------------------
// These tools are NEVER available to subagents, regardless of agent definition.
// This is the minicode equivalent of Claude Code's ALL_AGENT_DISALLOWED_TOOLS
// (see claude-code/src/constants/tools.ts).
//
// The critical entry is "agent" — without it a subagent could spawn another
// subagent, causing unbounded recursion.
const SUBAGENT_BLOCKED_TOOLS = new Set([
    "agent",           // prevent recursive agent spawning
    "skill",           // skills are a main-thread concept
    "enter_plan_mode", // plan mode is a main-thread concept
    "exit_plan_mode",
    "write_plan",
]);

// Claude Code does substantial tool filtering before the model sees the tool
// list. This is the minimal version of that idea: in safe mode, only read-only
// tools are visible to and executable by the agent.
export function filterToolsByPolicy(
    tools: ToolDefinition[],
    mode: ToolPolicyMode,
): ToolDefinition[] {
    if (mode === "full") {
        return tools;
    }

    return tools.filter(
        (tool) =>
            tool.accessLevel === "read" || SAFE_MODE_ALLOWED_WRITE_TOOLS.has(tool.name),
    );
}

export type AgentMode = "execute" | "plan";

/**
 * Filter tools by agent mode.
 *
 * Claude Code's approach: the model sees ALL tools in every mode.
 * The mode only controls what happens at execution time (gating),
 * not what tools are visible. This lets the model plan around tools
 * it knows it'll have access to after exiting plan mode.
 *
 * Exception: plan-only tools (write_plan, exit_plan_mode) are hidden
 * in execute mode since they're meaningless outside plan mode.
 */
export function filterToolsByMode(
    tools: ToolDefinition[],
    mode: AgentMode,
) : ToolDefinition[] {
    if (mode === "execute") {
        return tools.filter((tool) => !PLAN_ONLY_TOOLS.has(tool.name));
    }

    // Plan mode: show everything (writes are gated at execution time in runAgent)
    return tools;
}

/**
 * Check if a tool call should be blocked in plan mode.
 * Returns a reason string if blocked, null if allowed.
 *
 * Write tools are blocked UNLESS they're plan-specific (write_plan, exit_plan_mode).
 * Read tools always pass. This is checked at execution time, not at tool visibility time.
 */
export function getPlanModeBlock(
    toolName: string,
    accessLevel: "read" | "write",
    mode: AgentMode,
): string | null {
    if (mode !== "plan") return null;
    if (accessLevel === "read") return null;
    if (PLAN_MODE_ALLOWED_WRITES.has(toolName)) return null;

    return `Tool "${toolName}" is blocked in plan mode. You can see all available tools, but write operations are not allowed until you exit plan mode. Use write_plan to save your plan, then call exit_plan_mode to get approval before making changes.`;
}

export function getToolsForRuntime(
    tools: ToolDefinition[],
    mode: AgentMode,
    policyMode: ToolPolicyMode
): ToolDefinition[] {
    return filterToolsByMode(filterToolsByPolicy(tools, policyMode), mode);
}

// ---------------------------------------------------------------------------
// Subagent tool filtering
// ---------------------------------------------------------------------------
// Applies three layers of restriction (mirrors Claude Code's approach):
//
//   1. Global blocklist  — SUBAGENT_BLOCKED_TOOLS (always removed)
//   2. Agent-level block — agentDef.blockedTools   (additional per-agent blocks)
//   3. Agent-level allow — agentDef.allowedTools    (whitelist; undefined = all)
//
// Then the normal policy/mode filters run on top so safe-mode and plan-mode
// restrictions are still respected.

/**
 * Filter the full tool list down to what a specific subagent is allowed to see.
 *
 * @param allTools      The complete set of registered tools (from tools/index.ts)
 * @param agentDef      The agent definition describing this subagent's restrictions
 * @param policyMode    The current tool policy mode (safe/full) — inherited from parent
 */
export function filterToolsForSubagent(
    allTools: ToolDefinition[],
    agentDef: AgentDefinition,
    policyMode: ToolPolicyMode,
): ToolDefinition[] {
    const agentMode = agentDef.agentMode ?? "execute";
    const effectivePolicy = agentDef.toolPolicyMode ?? policyMode;

    // Merge global + per-agent blocked tools into one set.
    const blocked = new Set(SUBAGENT_BLOCKED_TOOLS);
    if (agentDef.blockedTools) {
        for (const name of agentDef.blockedTools) {
            blocked.add(name);
        }
    }

    // Build allowlist set (undefined means "allow everything not blocked").
    const allowed: Set<string> | null =
        agentDef.allowedTools ? new Set(agentDef.allowedTools) : null;

    // Layer 1+2+3: blocked / allowed filtering
    const filtered = allTools.filter((tool) => {
        if (blocked.has(tool.name)) return false;
        if (allowed && !allowed.has(tool.name)) return false;
        return true;
    });

    // Layer 4: normal policy + mode filtering on top
    return getToolsForRuntime(filtered, agentMode, effectivePolicy);
}
