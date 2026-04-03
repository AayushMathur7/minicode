import path from "node:path";
import fs from "node:fs/promises";
import { type ToolDefinition } from "../types";

export const readFileTool: ToolDefinition = {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace after you know its path",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative path to a UTF-8 text file in the current workspace",
            },
        },
        required: ["path"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const targetPath = args.path as string;
        const resolvedPath = targetPath.startsWith("/")
            ? targetPath
            : `${context.cwd}/${targetPath}`;
        const normalizedPath = resolvedPath.startsWith("/")
            ? resolvedPath
            : pathModuleResolve(context.cwd, resolvedPath);
        const content = await fs.readFile(normalizedPath, "utf8");
        return content;
    },
};

function pathModuleResolve(cwd: string, filePath: string): string {
    return path.resolve(cwd, filePath);
}
