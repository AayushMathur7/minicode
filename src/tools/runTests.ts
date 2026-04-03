import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type ToolDefinition } from "../types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
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

export const runTestsTool: ToolDefinition = {
    name: "run_tests",
    description: "Run the repository test command to verify behavior after changes or to find one concrete failing bug before editing code.",
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
        if (!packageJson?.scripts?.test) {
            return "No test script configured in package.json.";
        }

        try {
            const { stdout, stderr } = await execFileAsync("bun", ["run", "test"], {
                cwd: context.cwd,
                signal: context.signal,
                timeout: DEFAULT_TIMEOUT_MS,
                maxBuffer: DEFAULT_MAX_BUFFER,
            });

            const output = [stdout, stderr].filter(Boolean).join("\n").trim();
            return output || "Tests passed.";
        } catch (error) {
            const execError = error as { stdout?: string; stderr?: string; message?: string };
            const output = [execError.stdout, execError.stderr].filter(Boolean).join("\n").trim();
            return output || execError.message || "Tests failed.";
        }
    },
};
