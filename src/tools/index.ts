import { type ToolDefinition } from "../types";
import { applyPatchTool } from "./applyPatch";
import { enterPlanModeTool } from "./enterPlanMode";
import { exitPlanModeTool } from "./exitPlanMode";
import { getFileOutlineTool } from "./getFileOutline";
import { listFilesTool } from "./listFiles";
import { readFileTool } from "./readFile";
import { readFileRangeTool } from "./readFileRange";
import { runCommandTool } from "./runCommand";
import { runTestsTool } from "./runTests";
import { runTypecheckTool } from "./runTypecheck";
import { searchCodeTool } from "./searchCode";
import { writePlanTool } from "./writePlan";
import { writeFileTool } from "./writeFile";
import { filterToolsByPolicy, type ToolPolicyMode } from "./policy";

export const allTools: ToolDefinition[] = [
    enterPlanModeTool,
    listFilesTool,
    readFileTool,
    readFileRangeTool,
    getFileOutlineTool,
    searchCodeTool,
    runCommandTool,
    runTypecheckTool,
    runTestsTool,
    exitPlanModeTool,
    writePlanTool,
    applyPatchTool,
    writeFileTool,
];

export function getToolsForPolicy(mode: ToolPolicyMode): ToolDefinition[] {
    return filterToolsByPolicy(allTools, mode);
}

export function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
    return new Map<string, ToolDefinition>(tools.map((tool) => [tool.name, tool]));
}
