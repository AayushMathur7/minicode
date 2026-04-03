import { type Message } from "../types";
import { type ToolPolicyMode, type AgentMode } from "../tools/policy";
import { getSystemPrompt } from "../agent/systemPrompt";
import { loadProjectInstructions } from "../utils/sessionStorage";

export function buildMessages(
    userMessages: Message[],
    options: {
        cwd?: string;
        toolPolicyMode?: ToolPolicyMode;
        agentMode?: AgentMode;
        availableToolNames?: string[];
        taskPrompt?: string;
    } = {},
): Message[] {
    const systemPrompt = getSystemPrompt(options);

    // Load MINICODE.md project instructions if present
    const projectInstructions = options.cwd
        ? loadProjectInstructions(options.cwd)
        : null;

    const fullSystemPrompt = projectInstructions
        ? `${systemPrompt}\n\n## Project Instructions (from MINICODE.md)\n\n${projectInstructions}`
        : systemPrompt;

    return [
        {
            role: "system",
            content: fullSystemPrompt,
        },
        ...userMessages,
    ];
}
