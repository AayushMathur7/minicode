import { type AgentEvent, type ToolAccessLevel } from "../types";

export type PermissionRequestState = {
    toolName: string;
    accessLevel: ToolAccessLevel;
};

export type DiffPreviewState = {
    path: string;
    preview: string;
};

export type RecentEvent = {
    id: number;
    text: string;
};

export type TranscriptEntry = {
    id: number;
    role: "user" | "assistant" | "system";
    content: string;
};

export type ActiveRunStatus =
    | "idle"
    | "running"
    | "awaiting_permission"
    | "completed"
    | "cancelled"
    | "failed";

export type ActiveRunState = {
    status: ActiveRunStatus;
    step: number;
    currentTool?: string;
    inlineStatus?: string;
    startedAt?: number;
    recentEvents: RecentEvent[];
    nextEventId: number;
    diffPreview?: DiffPreviewState;
    pendingPermission?: PermissionRequestState;
    finalMessage?: string;
    error?: string;
};

export type SessionAppState = {
    transcript: TranscriptEntry[];
    nextTranscriptId: number;
    currentInput: string;
    isRunning: boolean;
    activeRun: ActiveRunState;
};

export type SessionAction =
    | { type: "input_changed"; value: string }
    | { type: "prompt_submitted"; prompt: string }
    | { type: "assistant_message_added"; content: string }
    | { type: "agent_event"; event: AgentEvent }
    | { type: "run_started" }
    | { type: "run_completed" }
    | { type: "run_cancelled" }
    | { type: "run_failed"; error: string };

const MAX_RECENT_EVENTS = 10;

function appendRecentEvent(
    runState: ActiveRunState,
    line: string,
): Pick<ActiveRunState, "recentEvents" | "nextEventId"> {
    return {
        recentEvents: [
            ...runState.recentEvents,
            {
                id: runState.nextEventId,
                text: line,
            },
        ].slice(-MAX_RECENT_EVENTS),
        nextEventId: runState.nextEventId + 1,
    };
}

function getRecentEventLine(event: AgentEvent): string | undefined {
    switch (event.type) {
        case "run_started":
            return `Started: ${event.prompt}`;
        case "step_started":
            return `Step ${event.step}`;
        case "model_responded":
            return `Model chose ${event.responseType}`;
        case "tool_requested":
            return `Requested ${event.toolName}`;
        case "diff_preview_ready":
            return `Preview ready for ${event.path}`;
        case "tool_started":
            return `Running ${event.toolName}`;
        case "tool_finished":
            return `Finished ${event.toolName}`;
        case "tool_output_appended":
            return `Added ${event.toolName} output back into history`;
        case "tool_failed":
            return `${event.toolName} failed: ${event.error}`;
        case "permission_requested":
            return `Permission needed for ${event.toolName}`;
        case "permission_resolved":
            return `Permission ${event.decision} for ${event.toolName}`;
        case "final_message":
            return "Final answer ready";
        case "run_completed":
            return `Completed in ${event.totalSteps} steps`;
        case "run_cancelled":
            return `Cancelled${event.reason ? `: ${event.reason}` : ""}`;
        case "run_failed":
            return `Run failed: ${event.error}`;
    }
}

function describeToolRequest(
    toolName: string,
    args: Record<string, unknown>,
): string {
    if (toolName === "search_code") {
        const query = typeof args.query === "string" ? args.query : undefined;
        return query ? `searching for ${query}` : "searching codebase";
    }

    if (toolName === "read_file") {
        const path = typeof args.path === "string" ? args.path : undefined;
        return path ? `reading ${path.split("/").pop() ?? path}` : "reading file";
    }

    if (toolName === "apply_patch") {
        const path = typeof args.path === "string" ? args.path : undefined;
        return path ? `preparing patch for ${path.split("/").pop() ?? path}` : "preparing patch";
    }

    if (toolName === "write_file") {
        const path = typeof args.path === "string" ? args.path : undefined;
        return path ? `writing ${path.split("/").pop() ?? path}` : "writing file";
    }

    if (toolName === "run_command") {
        const command = typeof args.command === "string" ? args.command : undefined;
        return command ? `running ${command}` : "running command";
    }

    return `using ${toolName}`;
}

function getInlineStatus(event: AgentEvent): string | undefined {
    switch (event.type) {
        case "run_started":
            return "thinking";
        case "model_responded":
            return event.responseType === "tool_call" ? "working" : "writing response";
        case "tool_requested":
            return describeToolRequest(event.toolName, event.args);
        case "tool_started":
            return `running ${event.toolName}`;
        case "diff_preview_ready":
            return `reviewing patch for ${event.path.split("/").pop() ?? event.path}`;
        case "tool_finished":
            return `finished ${event.toolName}`;
        case "tool_output_appended":
            return "thinking";
        case "permission_requested":
            return `waiting for permission for ${event.toolName}`;
        case "permission_resolved":
            return event.decision === "allow" ? "continuing" : "permission denied";
        case "final_message":
        case "run_completed":
        case "run_cancelled":
        case "run_failed":
            return undefined;
        default:
            return undefined;
    }
}

export function createEmptyRunState(): ActiveRunState {
    return {
        status: "idle",
        step: 0,
        inlineStatus: undefined,
        startedAt: undefined,
        recentEvents: [],
        nextEventId: 0,
    };
}

export function createInitialSessionState(): SessionAppState {
    return {
        transcript: [],
        nextTranscriptId: 0,
        currentInput: "",
        isRunning: false,
        activeRun: createEmptyRunState(),
    };
}

export function applyAgentEventToRunState(
    runState: ActiveRunState,
    event: AgentEvent,
): ActiveRunState {
    const line = getRecentEventLine(event);
    const inlineStatus = getInlineStatus(event);
    const recentEventUpdate = line
        ? appendRecentEvent(runState, line)
        : {
            recentEvents: runState.recentEvents,
            nextEventId: runState.nextEventId,
        };

    switch (event.type) {
        case "run_started":
            return {
                ...runState,
                status: "running",
                startedAt: runState.startedAt ?? Date.now(),
                error: undefined,
                inlineStatus,
                ...recentEventUpdate,
            };
        case "step_started":
            return {
                ...runState,
                status: runState.status === "idle" ? "running" : runState.status,
                step: event.step,
                inlineStatus: inlineStatus ?? runState.inlineStatus,
                ...recentEventUpdate,
            };
        case "tool_requested":
            return {
                ...runState,
                currentTool: event.toolName,
                inlineStatus,
                ...recentEventUpdate,
            };
        case "diff_preview_ready":
            return {
                ...runState,
                inlineStatus,
                diffPreview: {
                    path: event.path,
                    preview: event.preview,
                },
                ...recentEventUpdate,
            };
        case "permission_requested":
            return {
                ...runState,
                status: "awaiting_permission",
                inlineStatus,
                pendingPermission: {
                    toolName: event.toolName,
                    accessLevel: event.accessLevel,
                },
                ...recentEventUpdate,
            };
        case "permission_resolved":
            return {
                ...runState,
                status: "running",
                inlineStatus,
                pendingPermission: undefined,
                ...recentEventUpdate,
            };
        case "final_message":
            return {
                ...runState,
                finalMessage: event.content,
                inlineStatus: undefined,
                ...recentEventUpdate,
            };
        case "run_completed":
            return {
                ...runState,
                status: "completed",
                inlineStatus: undefined,
                pendingPermission: undefined,
                ...recentEventUpdate,
            };
        case "run_cancelled":
            return {
                ...runState,
                status: "cancelled",
                error: undefined,
                inlineStatus: undefined,
                pendingPermission: undefined,
                ...recentEventUpdate,
            };
        case "run_failed":
            return {
                ...runState,
                status: "failed",
                error: event.error,
                inlineStatus: undefined,
                pendingPermission: undefined,
                ...recentEventUpdate,
            };
        default:
            return {
                ...runState,
                inlineStatus: inlineStatus ?? runState.inlineStatus,
                ...recentEventUpdate,
            };
    }
}

export function sessionReducer(
    state: SessionAppState,
    action: SessionAction,
): SessionAppState {
    switch (action.type) {
        case "input_changed":
            return {
                ...state,
                currentInput: action.value,
            };
        case "prompt_submitted":
            return {
                ...state,
                transcript: [
                    ...state.transcript,
                    {
                        id: state.nextTranscriptId,
                        role: "user",
                        content: action.prompt,
                    },
                ],
                nextTranscriptId: state.nextTranscriptId + 1,
                currentInput: "",
                isRunning: true,
                activeRun: {
                    ...createEmptyRunState(),
                    status: "running",
                    startedAt: Date.now(),
                    inlineStatus: "thinking",
                },
            };
        case "assistant_message_added":
            return {
                ...state,
                transcript: [
                    ...state.transcript,
                    {
                        id: state.nextTranscriptId,
                        role: "assistant",
                        content: action.content,
                    },
                ],
                nextTranscriptId: state.nextTranscriptId + 1,
            };
        case "run_started":
            return {
                ...state,
                isRunning: true,
                activeRun: {
                    ...state.activeRun,
                    status: "running",
                    error: undefined,
                },
            };
        case "run_completed":
            return {
                ...state,
                isRunning: false,
                activeRun: {
                    ...state.activeRun,
                    status: "completed",
                    pendingPermission: undefined,
                },
            };
        case "run_cancelled":
            return {
                ...state,
                isRunning: false,
                activeRun: {
                    ...state.activeRun,
                    status: "cancelled",
                    error: undefined,
                    pendingPermission: undefined,
                },
            };
        case "run_failed":
            return {
                ...state,
                isRunning: false,
                activeRun: {
                    ...state.activeRun,
                    status: "failed",
                    error: action.error,
                    pendingPermission: undefined,
                },
            };
        case "agent_event":
            if (action.event.type === "run_cancelled") {
                return {
                    ...state,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "system",
                            content: action.event.reason === "interrupt"
                                ? "Interrupted"
                                : (action.event.reason ? `Interrupted: ${action.event.reason}` : "Interrupted"),
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            return {
                ...state,
                activeRun: applyAgentEventToRunState(state.activeRun, action.event),
            };
    }
}
