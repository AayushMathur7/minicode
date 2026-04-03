import fs from "node:fs/promises";
import path from "node:path";
import { type ToolDefinition } from "../types";

const MAX_LINES = 250;

function assertPositiveInteger(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`${field} must be a positive integer`);
    }

    return value;
}

function assertPath(value: unknown): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("path must be a non-empty string");
    }

    return value;
}

function resolveWorkspacePath(cwd: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.resolve(cwd, filePath);
}

function formatLineRange(
    filePath: string,
    lines: string[],
    startLine: number,
): string {
    if (lines.length === 0) {
        return `${filePath}:${startLine}-${startLine} is empty`;
    }

    const width = String(startLine + lines.length - 1).length;
    const body = lines
        .map((line, index) => `${String(startLine + index).padStart(width, " ")} | ${line}`)
        .join("\n");

    return `${filePath}:${startLine}-${startLine + lines.length - 1}\n${body}`;
}

export const readFileRangeTool: ToolDefinition = {
    name: "read_file_range",
    description: "Read a targeted line range from a UTF-8 file when you already know the file path and only need a slice.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative path to the UTF-8 text file in the current workspace",
            },
            startLine: {
                type: "number",
                description: "One-based starting line number to read",
            },
            endLine: {
                type: "number",
                description: "One-based ending line number to read, inclusive",
            },
        },
        required: ["path", "startLine", "endLine"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const filePath = assertPath(args.path);
        const startLine = assertPositiveInteger(args.startLine, "startLine");
        const endLine = assertPositiveInteger(args.endLine, "endLine");

        if (endLine < startLine) {
            throw new Error("endLine must be greater than or equal to startLine");
        }

        if (endLine - startLine + 1 > MAX_LINES) {
            throw new Error(`read_file_range can return at most ${MAX_LINES} lines at once`);
        }

        const resolvedPath = resolveWorkspacePath(context.cwd, filePath);
        const content = await fs.readFile(resolvedPath, "utf8");
        const fileLines = content.split("\n");

        if (startLine > fileLines.length) {
            throw new Error(`${filePath} only has ${fileLines.length} lines`);
        }

        const selectedLines = fileLines.slice(startLine - 1, endLine);
        return formatLineRange(filePath, selectedLines, startLine);
    },
};
