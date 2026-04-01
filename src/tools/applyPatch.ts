import fs from "node:fs/promises";
import path from "node:path";
import { type ToolDefinition, type ToolExecutionContext } from "../types";

type ApplyPatchArgs = {
    path: string;
    find: string;
    replace: string;
};

type PreparedPatch = {
    resolvedPath: string;
    displayPath: string;
    updatedContent: string;
    preview: string;
};

function assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }

    return value;
}

function assertString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`);
    }

    return value;
}

function resolveWorkspacePath(cwd: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.resolve(cwd, filePath);
}

function countOccurrences(content: string, search: string): number {
    let count = 0;
    let fromIndex = 0;

    while (true) {
        const index = content.indexOf(search, fromIndex);
        if (index === -1) {
            return count;
        }

        count += 1;
        fromIndex = index + search.length;
    }
}

function getLineNumber(content: string, offset: number): number {
    return content.slice(0, offset).split("\n").length;
}

function clipSnippet(content: string, center: number, length: number): string {
    const start = Math.max(0, center - length);
    const end = Math.min(content.length, center + length);
    return content.slice(start, end).trim();
}

function formatPreview(
    displayPath: string,
    lineNumber: number,
    beforeSnippet: string,
    afterSnippet: string,
): string {
    return [
        `File: ${displayPath}`,
        `Approximate line: ${lineNumber}`,
        "--- before",
        beforeSnippet,
        "+++ after",
        afterSnippet,
    ].join("\n");
}

function parseApplyPatchArgs(args: Record<string, unknown>): ApplyPatchArgs {
    return {
        path: assertNonEmptyString(args.path, "path"),
        find: assertNonEmptyString(args.find, "find"),
        replace: assertString(args.replace, "replace"),
    };
}

export async function prepareApplyPatch(
    rawArgs: Record<string, unknown>,
    context: ToolExecutionContext,
): Promise<PreparedPatch> {
    const args = parseApplyPatchArgs(rawArgs);
    const resolvedPath = resolveWorkspacePath(context.cwd, args.path);
    const originalContent = await fs.readFile(resolvedPath, "utf8");
    const occurrences = countOccurrences(originalContent, args.find);

    if (occurrences === 0) {
        throw new Error(`Could not find the target text in ${args.path}`);
    }

    if (occurrences > 1) {
        throw new Error(
            `apply_patch requires the find text to match exactly once in ${args.path}`,
        );
    }

    const matchIndex = originalContent.indexOf(args.find);
    const updatedContent = originalContent.replace(args.find, args.replace);
    const lineNumber = getLineNumber(originalContent, matchIndex);
    const beforeSnippet = clipSnippet(originalContent, matchIndex, 140);
    const afterSnippet = clipSnippet(updatedContent, matchIndex, 140);

    return {
        resolvedPath,
        displayPath: args.path,
        updatedContent,
        preview: formatPreview(args.path, lineNumber, beforeSnippet, afterSnippet),
    };
}

export const applyPatchTool: ToolDefinition = {
    name: "apply_patch",
    description:
        "Apply a targeted edit to one existing file by replacing one exact text block. Prefer this over write_file for small or local code changes.",
    accessLevel: "write",
    inputSchema: {
        type: "object",
        properties: {
            path: {
                type: "string",
                description: "Relative path to the existing file you want to patch",
            },
            find: {
                type: "string",
                description: "Exact text to replace. This must match exactly once in the file.",
            },
            replace: {
                type: "string",
                description: "Replacement text to write in place of the matched text",
            },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        const preparedPatch = await prepareApplyPatch(args, context);
        await fs.writeFile(preparedPatch.resolvedPath, preparedPatch.updatedContent, "utf8");
        return `Applied patch to ${preparedPatch.resolvedPath}`;
    },
};
