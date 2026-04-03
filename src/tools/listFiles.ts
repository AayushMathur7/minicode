// Tool: list_files - Lists files in the workspace for broad discovery before searching or reading specific files.
// This utility uses ripgrep (rg) to enumerate files while respecting ignore rules and limits.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ToolDefinition } from "../types";
const execFileAsync = promisify(execFile);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseLimit(value: unknown): number {
    if (value === undefined || value === null) {
        return DEFAULT_LIMIT;
    }

    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error("limit must be a positive integer");
    }

    return Math.min(value, MAX_LIMIT);
}

function parsePattern(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("pattern must be a non-empty string when provided");
    }

    return value;
}

export const listFilesTool: ToolDefinition = {
    name: "list_files",
    description: "List files in the workspace for broad discovery before searching or reading specific files.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            pattern: {
                type: ["string", "null"],
                description: "Optional glob-style filter such as src/**/*.ts or *.md. Pass null to list all files.",
            },
            limit: {
                type: ["number", "null"],
                description: "Maximum number of file paths to return (default: 200). Pass null for default.",
            },
        },
        required: ["pattern", "limit"],

        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const pattern = parsePattern(args.pattern);
        const limit = parseLimit(args.limit);
        const rgArgs = [
            "--files",
            "--hidden",
            "-g",
            "!.git",
            "-g",
            "!node_modules",
        ];

        if (pattern) {
            rgArgs.push("-g", pattern);
        }

        rgArgs.push(".");

        const { stdout } = await execFileAsync("rg", rgArgs, {
            cwd: context.cwd,
            signal: context.signal,
        });

        const files = stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, limit);

        if (files.length === 0) {
            return pattern
                ? `No files matched pattern "${pattern}"`
                : "No files found in the workspace";
        }

        return files.join("\n");
    },
};
