import { preparePlanApproval } from "../agent/plans";
import { type ToolDefinition } from "../types";

export const exitPlanModeTool: ToolDefinition = {
    name: "exit_plan_mode",
    description:
        "Present the current plan for approval and exit plan mode after the plan has been written. Use this only when the plan file is ready for review.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
    },
    execute: async (_args, context) => {
        if (context.agentMode !== "plan") {
            throw new Error("exit_plan_mode can only be used while plan mode is active");
        }

        const approval = await preparePlanApproval(context.cwd, context.sessionId);
        return `Requested approval for ${approval.displayPath}`;
    },
};
