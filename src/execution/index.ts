import type { ExecutionBackend } from "./base";
import { LocalExecutionBackend } from "./local";

const localExecutionBackend = new LocalExecutionBackend();

export function getExecutionBackend(): ExecutionBackend {
    return localExecutionBackend;
}
