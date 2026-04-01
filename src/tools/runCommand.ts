import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ToolDefinition } from "../types";

const execFileAsync = promisify(execFile);

// Start with a small read-only allowlist. This keeps the tool useful for
// inspection without turning it into unrestricted shell execution.
const ALLOWED_COMMANDS = new Set([
    "pwd",
    "ls",
    "cat",
    "rg",
    "git",
]);

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

type ExecError = Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
};

function assertString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${field} must be a non-empty string`);
    }

    return value;
}

function parseArgs(value: unknown): string[] {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error("args must be an array of strings");
    }

    return value;
}

function formatCommand(command: string, args: string[]): string {
    return [command, ...args].join(" ");
}

export const runCommandTool: ToolDefinition = {
    name: "run_command",
    description: "Run a safe read-only inspection command such as pwd, ls, cat, rg, or git",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The executable to run. Must be one of the allowlisted commands.",
            },
            args: {
                type: "array",
                items: { type: "string" },
                description: "Arguments to pass to the command. Each argument is a separate array item.",
            },
        },
        required: ["command", "args"],
        additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
        const command = assertString(args.command, "command");
        const commandArgs = parseArgs(args.args);

        if (!ALLOWED_COMMANDS.has(command)) {
            return `Command "${command}" is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`;
        }

        try {
            const { stdout, stderr } = await execFileAsync(command, commandArgs, {
                timeout: DEFAULT_TIMEOUT_MS,
                maxBuffer: DEFAULT_MAX_BUFFER,
                cwd: context.cwd,
            });

            const output = [stdout, stderr]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .join("\n")
                .trim();

            return output || `Command succeeded with no output: ${formatCommand(command, commandArgs)}`;
        } catch (error) {
            const execError = error as ExecError;
            const output = [execError.stdout, execError.stderr]
                .filter((value) => typeof value === "string" && value.trim().length > 0)
                .join("\n")
                .trim();

            if (output) {
                return output;
            }

            return `Command failed: ${formatCommand(command, commandArgs)}${
                execError.message ? `\n${execError.message}` : ""
            }`;
        }
    },
};
