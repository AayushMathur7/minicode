import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ToolDefinition } from "../types";

const execFileAsync = promisify(execFile);

export const searchCodeTool: ToolDefinition = {
    name: "search_code",
    description: "Search the workspace for code or text matching a query before reading specific files",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Text, symbol name, or phrase to search for in the workspace",
            },
        },
        required: ["query"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        const query = args.query as string;
        try {
            const { stdout, stderr } = await execFileAsync("rg", [
                "-n",
                // Treat the query as literal text. The model usually wants plain
                // code/text search, and regex metacharacters like `(` should not
                // cause the search itself to fail.
                "-F",
                "--hidden",
                "--glob",
                "!.git",
                query,
                ".",
            ], {
                cwd: context.cwd,
                signal: context.signal,
            });

            return stdout || stderr || `No matches found for "${query}"`;
        } catch (error) {
            const execError = error as { code?: number; stdout?: string; stderr?: string };
            if (execError.code === 1) {
                return `No matches found for "${query}"`;
            }

            throw error;
        }
    },
};
