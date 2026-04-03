import { type ToolDefinition } from "../types";

export type ToolPolicyMode = "safe" | "full";
const SAFE_MODE_ALLOWED_WRITE_TOOLS = new Set(["write_plan"]);
const PLAN_MODE_ALLOWED_WRITE_TOOLS = new Set(["write_plan"]);
const PLAN_MODE_ALLOWED_READ_TOOLS = new Set(["exit_plan_mode"]);
const EXECUTE_MODE_HIDDEN_TOOLS = new Set(["write_plan", "exit_plan_mode"]);

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

export function filterToolsByMode(
    tools: ToolDefinition[],
    mode: AgentMode,
) : ToolDefinition[] {
    if (mode === "execute") {
        return tools.filter((tool) => !EXECUTE_MODE_HIDDEN_TOOLS.has(tool.name));
    }

    return tools.filter(
        (tool) =>
            tool.accessLevel === "read"
            || PLAN_MODE_ALLOWED_WRITE_TOOLS.has(tool.name)
            || PLAN_MODE_ALLOWED_READ_TOOLS.has(tool.name),
    );
}

export function getToolsForRuntime(
    tools: ToolDefinition[],
    mode: AgentMode,
    policyMode: ToolPolicyMode
): ToolDefinition[] {
    return filterToolsByMode(filterToolsByPolicy(tools, policyMode), mode);
}
