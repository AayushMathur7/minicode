import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type ToolDefinition } from "../types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024 * 4;

type PackageJson = {
    scripts?: Record<string, string>;
};

async function readPackageJson(cwd: string): Promise<PackageJson | undefined> {
    const packageJsonPath = path.join(cwd, "package.json");

    try {
        const content = await fs.readFile(packageJsonPath, "utf8");
        return JSON.parse(content) as PackageJson;
    } catch {
        return undefined;
    }
}

function formatCommand(args: string[]): string {
    return ["bun", ...args].join(" ");
}

export const runTypecheckTool: ToolDefinition = {
    name: "run_typecheck",
    description: "Run the repository typecheck command to verify edits or to quickly identify a concrete TypeScript bug before changing code.",
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
    },
    execute: async (_args: Record<string, unknown>, context) => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }

        const packageJson = await readPackageJson(context.cwd);
        let commandArgs: string[] | undefined;

        if (packageJson?.scripts?.typecheck) {
            commandArgs = ["run", "typecheck"];
        } else if (packageJson?.scripts?.check) {
            commandArgs = ["run", "check"];
        }

        if (!commandArgs) {
            return "No typecheck script configured. Expected package.json scripts.typecheck or scripts.check.";
        }

        try {
            const { stdout, stderr } = await execFileAsync("bun", commandArgs, {
                cwd: context.cwd,
                signal: context.signal,
                timeout: DEFAULT_TIMEOUT_MS,
                maxBuffer: DEFAULT_MAX_BUFFER,
            });

            const output = [stdout, stderr].filter(Boolean).join("\n").trim();
            return output || `Typecheck passed: ${formatCommand(commandArgs)}`;
        } catch (error) {
            const execError = error as { stdout?: string; stderr?: string; message?: string };
            const output = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
            return output || execError.message || `Typecheck failed: ${formatCommand(commandArgs)}`;
        }
    },
};
