import { type Message } from "../types";
import { type ToolPolicyMode, type AgentMode } from "../tools/policy";
import { getSystemPrompt } from "../agent/systemPrompt";

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
    return [
        {
            role: "system",
            content: getSystemPrompt(options),
        },
        ...userMessages,
    ];
}
