import { type SessionState } from "../types";

export function createSessionState(args: {
    goal: string;
    toolPolicyMode: "safe" | "full";
}): SessionState {
    return {
        goal: args.goal,
        startedAt: Date.now(),
        stepCount: 0,
        toolPolicyMode: args.toolPolicyMode,
        toolsUsed: [],
        filesRead: [],
    };
}

export function recordStepStart(state: SessionState, step: number): SessionState {
    return {
        ...state,
        stepCount: step,
    };
}

export function recordToolRequested(
    state: SessionState,
    toolName: string,
    args: Record<string, unknown>,
): SessionState {
    const filesRead =
        toolName === "read_file" && typeof args.path === "string"
            ? [...state.filesRead, args.path]
            : state.filesRead;

    return {
        ...state,
        lastToolName: toolName,
        toolsUsed: [...state.toolsUsed, toolName],
        filesRead,
    };
}

export function recordToolFinished(
    state: SessionState,
    toolName: string,
    preview: string,
): SessionState {
    return {
        ...state,
        lastToolName: toolName,
        lastToolPreview: preview,
    };
}

export function recordFinalMessage(
    state: SessionState,
    content: string,
): SessionState {
    return {
        ...state,
        finalMessage: content,
    };
}
