import { type ToolDefinition } from "../types";
import { applyPatchTool } from "./applyPatch";
import { readFileTool } from "./readFile";
import { runCommandTool } from "./runCommand";
import { searchCodeTool } from "./searchCode";
import { writeFileTool } from "./writeFile";
import { filterToolsByPolicy, type ToolPolicyMode } from "./policy";

export const allTools: ToolDefinition[] = [
    readFileTool,
    searchCodeTool,
    runCommandTool,
    applyPatchTool,
    writeFileTool,
];

export function getToolsForPolicy(mode: ToolPolicyMode): ToolDefinition[] {
    return filterToolsByPolicy(allTools, mode);
}

export function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
    return new Map<string, ToolDefinition>(tools.map((tool) => [tool.name, tool]));
}
