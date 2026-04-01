import path from "node:path";
import fs from "node:fs/promises";
import { type ToolDefinition } from "../types";

function assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }

    return value;
}

function resolveWorkspacePath(cwd: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.resolve(cwd, filePath);
}

export const writeFileTool: ToolDefinition = {
    name: "write_file",
    description: "Write or overwrite a UTF-8 text file in the current workspace when you need to save generated content",
    accessLevel: "write",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative path to the file to write in the current workspace",
            },
            content: {
                type: "string",
                description: "Full UTF-8 text content to write to the target file",
            },
        },
        required: ["path", "content"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        const filePath = assertNonEmptyString(args.path, "path");
        const content = typeof args.content === "string" ? args.content : "";
        const resolvedPath = resolveWorkspacePath(context.cwd, filePath);

        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, content, "utf8");

        return `Wrote ${resolvedPath}`;
    },
};
