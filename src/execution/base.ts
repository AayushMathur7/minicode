import type { ExecutionRequest, ExecutionResult } from "./types";

export interface ExecutionBackend {
    execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
