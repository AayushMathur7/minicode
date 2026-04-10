export type ExecutionRequest = {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    maxBuffer: number;
    signal?: AbortSignal;
};

export type ExecutionResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    errorMessage?: string;
};
