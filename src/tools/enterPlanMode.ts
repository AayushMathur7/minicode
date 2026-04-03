import { getPlanArtifact } from "../agent/plans";
import { type ToolDefinition } from "../types";

export const enterPlanModeTool: ToolDefinition = {
    name: "enter_plan_mode",
    description:
        "Switch into plan mode for repo investigation. Use this when the task needs an explicit plan before editing. After exploring, save the plan with write_plan and call exit_plan_mode for approval.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
    },
    execute: async (_args, context) => {
        const planArtifact = getPlanArtifact(context.cwd, context.sessionId);

        return [
            `Entered plan mode.`,
            `Draft the plan in ${planArtifact.displayPath} with write_plan.`,
            `When the plan is ready, call exit_plan_mode to request approval.`,
        ].join(" ");
    },
};
