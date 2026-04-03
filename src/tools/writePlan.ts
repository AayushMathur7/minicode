import { writePlanFile } from "../agent/plans";
import { type ToolDefinition } from "../types";

function assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }

    return value;
}

export const writePlanTool: ToolDefinition = {
    name: "write_plan",
    description:
        "Write the current plan as markdown to the session plan file while in plan mode. Use this instead of editing repository files directly.",
    accessLevel: "write",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "Full markdown plan content to save for review",
            },
        },
        required: ["content"],
        additionalProperties: false,
    },
    execute: async (args, context) => {
        if (context.agentMode !== "plan") {
            throw new Error("write_plan can only be used while plan mode is active");
        }

        const content = assertNonEmptyString(args.content, "content");
        const artifact = await writePlanFile(context.cwd, context.sessionId, content);
        return `Wrote plan to ${artifact.displayPath}`;
    },
};
