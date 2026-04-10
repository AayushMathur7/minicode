import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutionBackend } from "./base";
import type { ExecutionRequest, ExecutionResult } from "./types";

const execFileAsync = promisify(execFile);

type ExecError = Error & {
    code?: number | string;
    stdout?: string;
    stderr?: string;
};

function normalizeExitCode(code: number | string | undefined): number {
    return typeof code === "number" ? code : 1;
}

export class LocalExecutionBackend implements ExecutionBackend {
    async execute(request: ExecutionRequest): Promise<ExecutionResult> {
        try {
            const { stdout, stderr } = await execFileAsync(
                request.command,
                request.args,
                {
                    timeout: request.timeoutMs,
                    maxBuffer: request.maxBuffer,
                    cwd: request.cwd,
                    signal: request.signal,
                },
            );

            return {
                stdout: stdout ?? "",
                stderr: stderr ?? "",
                exitCode: 0,
            };
        } catch (error) {
            const execError = error as ExecError;

            // Surface process output even for failures so callers can decide
            // whether to show command output or a generic failure message.
            return {
                stdout: execError.stdout ?? "",
                stderr: execError.stderr ?? "",
                exitCode: normalizeExitCode(execError.code),
                errorMessage: execError.message,
            };
        }
    }
}
