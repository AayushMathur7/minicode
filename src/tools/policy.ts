import { type ToolDefinition } from "../types";

export type ToolPolicyMode = "safe" | "full";

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

    return tools.filter((tool) => tool.accessLevel === "read");
}