/**
 * applyPatch.ts
 *
 * Implementation of the apply_patch tool used by the agent to perform precise, local
 * edits to a single file. It replaces exactly one matching text block with a new
 * string and safeguards against ambiguous or missing matches. A unified diff preview
 * is also created for UI display and debugging.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createPatch } from "diff";
import { type ToolDefinition, type ToolExecutionContext } from "../types";

/**
 * Arguments accepted by the apply_patch tool.
 * - path: Relative path to the existing file in the workspace (absolute is also accepted).
 * - find: Exact text to locate in the file. Must match exactly once.
 * - replace: Replacement text to write in place of the matched text.
 */
type ApplyPatchArgs = {
    path: string;
    find: string;
    replace: string;
};

/**
 * Information prepared before writing the patch to disk.
 * - resolvedPath: Absolute path to the target file on disk.
 * - displayPath: Path shown in the UI or messages (generally the provided relative path).
 * - updatedContent: File content after performing the replacement.
 * - preview: A unified diff preview of the change for display/debug.
 */
type PreparedPatch = {
    resolvedPath: string;
    displayPath: string;
    updatedContent: string;
    preview: string;
};

/**
 * Ensure a provided value is a non-empty string. Throws a helpful error otherwise.
 */
function assertNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }

    return value;
}

/**
 * Ensure a provided value is a string (allowing empty). Throws a helpful error otherwise.
 */
function assertString(value: unknown, field: string): string {
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`);
    }

    return value;
}

/**
 * Normalize a user-provided file path to an absolute path rooted at the current workspace.
 */
function resolveWorkspacePath(cwd: string, filePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }

    return path.resolve(cwd, filePath);
}

/**
 * Count non-overlapping occurrences of `search` within `content`.
 * Used to ensure the replacement target is unambiguous.
 */
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

/**
 * Create a small unified diff preview showing the replacement in context.
 */
function formatPreview(
    displayPath: string,
    originalContent: string,
    updatedContent: string,
): string {
    return createPatch(displayPath, originalContent, updatedContent, "before", "after", {
        context: 2,
    }).trim();
}

/**
 * Validate and coerce raw tool arguments into a strongly-typed structure.
 */
function parseApplyPatchArgs(args: Record<string, unknown>): ApplyPatchArgs {
    return {
        path: assertNonEmptyString(args.path, "path"),
        find: assertNonEmptyString(args.find, "find"),
        replace: assertString(args.replace, "replace"),
    };
}

/**
 * Prepare the patch by:
 * 1) Resolving the target file path
 * 2) Reading the file contents
 * 3) Verifying the `find` text occurs exactly once
 * 4) Computing the updated file content and a preview diff
 *
 * Throws descriptive errors when the target cannot be found or is ambiguous.
 */
export async function prepareApplyPatch(
    rawArgs: Record<string, unknown>,
    context: ToolExecutionContext,
): Promise<PreparedPatch> {
    if (context.signal?.aborted) {
        throw new Error(String(context.signal.reason ?? "cancelled"));
    }

    const args = parseApplyPatchArgs(rawArgs);
    const resolvedPath = resolveWorkspacePath(context.cwd, args.path);

    // Read the original file content to evaluate and perform the replacement
    const originalContent = await fs.readFile(resolvedPath, "utf8");

    // Ensure the `find` text appears exactly once to avoid unintended edits
    const occurrences = countOccurrences(originalContent, args.find);

    if (occurrences === 0) {
        throw new Error(`Could not find the target text in ${args.path}`);
    }

    if (occurrences > 1) {
        throw new Error(
            `apply_patch requires the find text to match exactly once in ${args.path}`,
        );
    }

    // Index retained for potential future enhancements (e.g., range-based validation)
    const matchIndex = originalContent.indexOf(args.find);

    // Perform the replacement to produce the updated file content
    const updatedContent = originalContent.replace(args.find, args.replace);

    // Return all prepared information; the caller is responsible for writing the file
    return {
        resolvedPath,
        displayPath: args.path,
        updatedContent,
        preview: formatPreview(args.path, originalContent, updatedContent),
    };
}

/**
 * Tool definition exposed to the agent runtime. It writes the prepared patch to disk
 * and returns a short confirmation message upon success.
 */
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
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const preparedPatch = await prepareApplyPatch(args, context);
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }
        await fs.writeFile(preparedPatch.resolvedPath, preparedPatch.updatedContent, "utf8");
        return `Applied patch to ${preparedPatch.resolvedPath}`;
    },
};
