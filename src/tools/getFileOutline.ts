import fs from "node:fs/promises";
import path from "node:path";
import { type ToolDefinition } from "../types";

type OutlineEntry = {
    line: number;
    kind: string;
    label: string;
};

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

function collectOutline(lines: string[]): OutlineEntry[] {
    const entries: OutlineEntry[] = [];

    lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const patterns: Array<[RegExp, string]> = [
            [/^\s*export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/, "function"],
            [/^\s*(async\s+)?function\s+([A-Za-z0-9_$]+)/, "function"],
            [/^\s*export\s+class\s+([A-Za-z0-9_$]+)/, "class"],
            [/^\s*class\s+([A-Za-z0-9_$]+)/, "class"],
            [/^\s*export\s+interface\s+([A-Za-z0-9_$]+)/, "interface"],
            [/^\s*interface\s+([A-Za-z0-9_$]+)/, "interface"],
            [/^\s*export\s+type\s+([A-Za-z0-9_$]+)/, "type"],
            [/^\s*type\s+([A-Za-z0-9_$]+)/, "type"],
            [/^\s*export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/, "const"],
            [/^\s*const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?\(/, "const"],
            [/^\s*export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?[^=]*=>/, "const"],
            [/^\s*const\s+([A-Za-z0-9_$]+)\s*=\s*(async\s*)?[^=]*=>/, "const"],
            [/^\s*export\s+default\s+function\s+([A-Za-z0-9_$]+)/, "default function"],
            [/^\s*export\s+default\s+class\s+([A-Za-z0-9_$]+)/, "default class"],
            [/^\s*def\s+([A-Za-z0-9_]+)\s*\(/, "function"],
        ];

        for (const [pattern, kind] of patterns) {
            const match = line.match(pattern);
            if (!match) {
                continue;
            }

            const label = match[2] ?? match[1];
            if (label) {
                entries.push({ line: lineNumber, kind, label });
            }
            return;
        }
    });

    return entries;
}

export const getFileOutlineTool: ToolDefinition = {
    name: "get_file_outline",
    description: "Return a lightweight structural outline of a source file, such as functions, classes, interfaces, and top-level symbols.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative path to the source file in the current workspace",
            },
        },
        required: ["path"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const filePath = assertPath(args.path);
        const resolvedPath = resolveWorkspacePath(context.cwd, filePath);
        const content = await fs.readFile(resolvedPath, "utf8");
        const outline = collectOutline(content.split("\n"));

        if (outline.length === 0) {
            return `No recognizable outline entries found in ${filePath}`;
        }

        return `${filePath}\n${outline
            .map((entry) => `${String(entry.line).padStart(4, " ")} | ${entry.kind} ${entry.label}`)
            .join("\n")}`;
    },
};
