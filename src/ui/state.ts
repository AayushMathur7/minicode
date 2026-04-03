import { type AgentEvent, type Message, type ToolAccessLevel } from "../types";
import { type AgentMode } from "../tools/policy";
import {
    createInitialContextBudget,
    recordModelUsage,
    updateEstimatedContextTokens,
    type ContextBudgetState,
} from "../agent/contextBudget";
import { type CompactedContextState } from "../agent/compact";

export type PermissionRequestState = {
    toolName: string;
    accessLevel: ToolAccessLevel;
};

export type DiffPreviewState = {
    path: string;
    preview: string;
};

export type PlanApprovalState = {
    filePath: string;
    content: string;
};

export type RecentEvent = {
    id: number;
    text: string;
};

export type TranscriptEntry = {
    id: number;
    role: "user" | "assistant" | "system" | "model_note" | "tool_call" | "tool_result";
    content: string;
    toolName?: string;
    isStreaming?: boolean;
};

export type ActiveRunStatus =
    | "idle"
    | "running"
    | "awaiting_permission"
    | "awaiting_plan_approval"
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
    pendingPlanApproval?: PlanApprovalState;
    finalMessage?: string;
    error?: string;
    mode: AgentMode;
};

export type SessionAppState = {
    transcript: TranscriptEntry[];
    conversationMessages: Message[];
    nextTranscriptId: number;
    streamingAssistantEntryId?: number;
    streamingReasoningEntryId?: number;
    currentInput: string;
    isRunning: boolean;
    mode: AgentMode;
    activePlanFilePath?: string;
    activePlanContent?: string;
    compactedContext?: CompactedContextState;
    contextBudget: ContextBudgetState;
    activeRun: ActiveRunState;
};

export type SessionAction =
    | { type: "input_changed"; value: string }
    | { type: "prompt_submitted"; prompt: string }
    | { type: "mode_changed"; mode: AgentMode }
    | { type: "system_message_added"; content: string }
    | { type: "assistant_message_added"; content: string }
    | { type: "transcript_cleared" }
    | { type: "conversation_compacted"; compactedContext: CompactedContextState; systemMessage: string }
    | { type: "context_budget_recomputed"; messages: Message[] }
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
        case "tool_call_detected":
            return `Preparing ${event.toolName}`;
        case "plan_mode_entered":
            return `Entered plan mode (${event.filePath})`;
        case "plan_written":
            return `Plan written to ${event.filePath}`;
        case "plan_approval_requested":
            return `Plan approval requested for ${event.filePath}`;
        case "plan_approval_resolved":
            return `Plan ${event.decision}`;
        case "plan_mode_exited":
            return `Exited plan mode (${event.filePath})`;
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

function formatToolCallLabel(
    toolName: string,
    args: Record<string, unknown>,
): string {
    const keyArg =
        (typeof args.path === "string" && args.path) ||
        (typeof args.query === "string" && args.query) ||
        (typeof args.command === "string" && args.command) ||
        (typeof args.pattern === "string" && args.pattern) ||
        (typeof args.file_path === "string" && args.file_path) ||
        undefined;

    if (keyArg) {
        // Truncate long args
        const display = keyArg.length > 80 ? `${keyArg.slice(0, 77)}...` : keyArg;
        return `${toolName}(${display})`;
    }

    return toolName;
}

function formatToolResultLabel(toolName: string, preview: string): string {
    const firstLine = preview.trim().split("\n")[0] ?? "";
    const compactPreview = firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;

    switch (toolName) {
        case "search_code":
            return compactPreview ? `found matches · ${compactPreview}` : "found matches";
        case "read_file":
        case "read_file_range":
            return "loaded file contents";
        case "get_file_outline":
            return "loaded file outline";
        case "run_typecheck":
            return compactPreview || "typecheck finished";
        case "run_tests":
            return compactPreview || "tests finished";
        case "write_file":
        case "apply_patch":
        case "write_plan":
            return compactPreview || "saved changes";
        case "enter_plan_mode":
            return "plan mode is active";
        case "exit_plan_mode":
            return "plan approved";
        default:
            return compactPreview || `${toolName} finished`;
    }
}

function getInlineStatus(event: AgentEvent): string | undefined {
    switch (event.type) {
        case "run_started":
            return "thinking";
        case "model_responded":
            return event.responseType === "tool_call" ? undefined : "writing response";
        case "tool_requested":
            return describeToolRequest(event.toolName, event.args);
        case "plan_mode_entered":
            return "entered plan mode";
        case "plan_written":
            return `saved plan to ${event.filePath.split("/").pop() ?? event.filePath}`;
        case "plan_approval_requested":
            return "waiting for plan approval";
        case "plan_approval_resolved":
            return event.decision === "approve" ? "plan approved" : "staying in plan mode";
        case "plan_mode_exited":
            return "returned to execute mode";
        case "tool_started":
            return `running ${event.toolName}`;
        case "diff_preview_ready":
            return `reviewing patch for ${event.path.split("/").pop() ?? event.path}`;
        case "tool_finished":
            return `finished ${event.toolName}`;
        case "tool_output_appended":
            return undefined;
        case "permission_requested":
            return `waiting for permission for ${event.toolName}`;
        case "permission_resolved":
            return event.decision === "allow" ? "continuing" : "permission denied";
        case "reasoning_summary_delta":
            return "thinking through options";
        case "reasoning_summary_completed":
            return undefined;
        case "assistant_text_started":
        case "assistant_text_delta":
            return "writing response";
        case "assistant_text_completed":
        case "model_thinking_completed":
            return undefined;
        case "model_thinking_started":
            return "thinking";
        case "tool_call_detected":
            return `preparing ${event.toolName}`;
        case "final_message":
        case "run_completed":
        case "run_cancelled":
        case "run_failed":
            return undefined;
        default:
            return undefined;
    }
}

function formatModeChangedTranscriptEntry(mode: AgentMode): string {
    return mode === "plan" ? "Plan mode enabled" : "Execute mode enabled";
}

function formatPlanSavedTranscriptEntry(filePath: string): string {
    return `Plan saved to ${filePath}`;
}

function formatPlanExitedTranscriptEntry(filePath: string): string {
    return `Exited plan mode using ${filePath}`;
}

export function createEmptyRunState(mode: AgentMode = "execute"): ActiveRunState {
    return {
        status: "idle",
        step: 0,
        inlineStatus: undefined,
        startedAt: undefined,
        recentEvents: [],
        nextEventId: 0,
        mode,
    };
}

export function createInitialSessionState(): SessionAppState {
    return {
        transcript: [],
        conversationMessages: [],
        nextTranscriptId: 0,
        streamingAssistantEntryId: undefined,
        streamingReasoningEntryId: undefined,
        currentInput: "",
        isRunning: false,
        mode: "execute",
        compactedContext: undefined,
        contextBudget: createInitialContextBudget(),
        activeRun: createEmptyRunState("execute"),
    };
}

function appendAssistantDeltaToTranscript(
    transcript: TranscriptEntry[],
    entryId: number,
    chunk: string,
): TranscriptEntry[] {
    return transcript.map((entry) =>
        entry.id === entryId
            ? {
                ...entry,
                content: `${entry.content}${chunk}`,
            }
            : entry,
    );
}

function replaceAssistantTranscriptEntry(
    transcript: TranscriptEntry[],
    entryId: number,
    content: string,
): TranscriptEntry[] {
    return transcript.map((entry) =>
        entry.id === entryId
            ? {
                ...entry,
                content,
                isStreaming: false,
            }
            : entry,
    );
}

function removeTranscriptEntry(
    transcript: TranscriptEntry[],
    entryId: number,
): TranscriptEntry[] {
    return transcript.filter((entry) => entry.id !== entryId);
}

function completeTranscriptEntry(
    transcript: TranscriptEntry[],
    entryId: number,
): TranscriptEntry[] {
    return transcript.map((entry) =>
        entry.id === entryId
            ? {
                ...entry,
                isStreaming: false,
            }
            : entry,
    );
}

function recomputeBudgetFromConversation(
    budget: ContextBudgetState,
    conversationMessages: Message[],
): ContextBudgetState {
    return updateEstimatedContextTokens(budget, conversationMessages);
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
        case "plan_approval_requested":
            return {
                ...runState,
                status: "awaiting_plan_approval",
                inlineStatus: "waiting for plan approval",
                pendingPlanApproval: {
                    filePath: event.filePath,
                    content: event.content,
                },
                ...recentEventUpdate,
            };
        case "plan_approval_resolved":
            return {
                ...runState,
                status: "running",
                inlineStatus:
                    event.decision === "approve" ? "plan approved" : "staying in plan mode",
                pendingPlanApproval: undefined,
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
                pendingPlanApproval: undefined,
                ...recentEventUpdate,
            };
        case "run_cancelled":
            return {
                ...runState,
                status: "cancelled",
                error: undefined,
                inlineStatus: undefined,
                pendingPermission: undefined,
                pendingPlanApproval: undefined,
                ...recentEventUpdate,
            };
        case "run_failed":
            return {
                ...runState,
                status: "failed",
                error: event.error,
                inlineStatus: undefined,
                pendingPermission: undefined,
                pendingPlanApproval: undefined,
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
            {
                const nextConversationMessages = [
                    ...state.conversationMessages,
                    {
                        role: "user" as const,
                        content: action.prompt,
                    },
                ];

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
                conversationMessages: nextConversationMessages,
                nextTranscriptId: state.nextTranscriptId + 1,
                streamingAssistantEntryId: undefined,
                streamingReasoningEntryId: undefined,
                currentInput: "",
                isRunning: true,
                contextBudget: recomputeBudgetFromConversation(
                    state.contextBudget,
                    nextConversationMessages,
                ),
                activeRun: {
                    ...createEmptyRunState(state.mode),
                    status: "running",
                    startedAt: Date.now(),
                    inlineStatus: "thinking",
                },
            };
            }
        case "mode_changed":
            return {
                ...state,
                mode: action.mode,
                transcript: [
                    ...state.transcript,
                    {
                        id: state.nextTranscriptId,
                        role: "system",
                        content: formatModeChangedTranscriptEntry(action.mode),
                    },
                ],
                nextTranscriptId: state.nextTranscriptId + 1,
                activeRun: {
                    ...state.activeRun,
                    mode: action.mode,
                },
            };
        case "system_message_added":
            return {
                ...state,
                transcript: [
                    ...state.transcript,
                    {
                        id: state.nextTranscriptId,
                        role: "system",
                        content: action.content,
                    },
                ],
                nextTranscriptId: state.nextTranscriptId + 1,
            };
        case "assistant_message_added":
            if (state.streamingAssistantEntryId !== undefined) {
                const nextConversationMessages = [
                    ...state.conversationMessages,
                    {
                        role: "assistant" as const,
                        content: action.content,
                    },
                ];
                return {
                    ...state,
                    transcript: replaceAssistantTranscriptEntry(
                        state.transcript,
                        state.streamingAssistantEntryId,
                        action.content,
                    ),
                    conversationMessages: nextConversationMessages,
                    contextBudget: recomputeBudgetFromConversation(
                        state.contextBudget,
                        nextConversationMessages,
                    ),
                    streamingAssistantEntryId: undefined,
                };
            }

            {
                const nextConversationMessages = [
                    ...state.conversationMessages,
                    {
                        role: "assistant" as const,
                        content: action.content,
                    },
                ];
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
                conversationMessages: nextConversationMessages,
                nextTranscriptId: state.nextTranscriptId + 1,
                contextBudget: recomputeBudgetFromConversation(
                    state.contextBudget,
                    nextConversationMessages,
                ),
            };
            }
        case "transcript_cleared":
            return {
                ...state,
                transcript: [],
                conversationMessages: [],
                nextTranscriptId: 0,
                streamingAssistantEntryId: undefined,
                streamingReasoningEntryId: undefined,
                currentInput: "",
                compactedContext: undefined,
                contextBudget: createInitialContextBudget(state.contextBudget.config),
                activeRun: createEmptyRunState(state.mode),
            };
        case "conversation_compacted":
            {
                const compactedConversationMessages = [
                    {
                        role: "system" as const,
                        content: action.compactedContext.summary,
                    },
                    ...action.compactedContext.preservedMessages,
                ];
            return {
                ...state,
                compactedContext: action.compactedContext,
                conversationMessages: compactedConversationMessages,
                transcript: [
                    ...state.transcript,
                    {
                        id: state.nextTranscriptId,
                        role: "system",
                        content: action.systemMessage,
                    },
                ],
                nextTranscriptId: state.nextTranscriptId + 1,
                contextBudget: updateEstimatedContextTokens(
                    state.contextBudget,
                    compactedConversationMessages,
                ),
            };
            }
        case "context_budget_recomputed":
            return {
                ...state,
                contextBudget: updateEstimatedContextTokens(state.contextBudget, action.messages),
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
                streamingAssistantEntryId: undefined,
                streamingReasoningEntryId: undefined,
                activeRun: {
                    ...state.activeRun,
                    status: "completed",
                    pendingPermission: undefined,
                    pendingPlanApproval: undefined,
                },
            };
        case "run_cancelled":
            return {
                ...state,
                isRunning: false,
                streamingAssistantEntryId: undefined,
                streamingReasoningEntryId: undefined,
                activeRun: {
                    ...state.activeRun,
                    status: "cancelled",
                    error: undefined,
                    pendingPermission: undefined,
                    pendingPlanApproval: undefined,
                },
            };
        case "run_failed":
            return {
                ...state,
                isRunning: false,
                streamingAssistantEntryId: undefined,
                streamingReasoningEntryId: undefined,
                activeRun: {
                    ...state.activeRun,
                    status: "failed",
                    error: action.error,
                    pendingPermission: undefined,
                    pendingPlanApproval: undefined,
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
                    streamingAssistantEntryId: undefined,
                    streamingReasoningEntryId: undefined,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "reasoning_summary_delta") {
                if (state.streamingReasoningEntryId === undefined) {
                    return {
                        ...state,
                        transcript: [
                            ...state.transcript,
                            {
                                id: state.nextTranscriptId,
                                role: "model_note",
                                content: action.event.chunk,
                                isStreaming: true,
                            },
                        ],
                        nextTranscriptId: state.nextTranscriptId + 1,
                        streamingReasoningEntryId: state.nextTranscriptId,
                        activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                    };
                }

                return {
                    ...state,
                    transcript: appendAssistantDeltaToTranscript(
                        state.transcript,
                        state.streamingReasoningEntryId,
                        action.event.chunk,
                    ),
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "reasoning_summary_completed") {
                if (state.streamingReasoningEntryId === undefined) {
                    return {
                        ...state,
                        activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                    };
                }

                return {
                    ...state,
                    transcript: replaceAssistantTranscriptEntry(
                        state.transcript,
                        state.streamingReasoningEntryId,
                        action.event.content,
                    ),
                    streamingReasoningEntryId: undefined,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "assistant_text_started") {
                if (state.streamingAssistantEntryId !== undefined) {
                    return {
                        ...state,
                        activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                    };
                }

                return {
                    ...state,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "assistant",
                            content: "",
                            isStreaming: true,
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    streamingAssistantEntryId: state.nextTranscriptId,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "assistant_text_delta") {
                if (state.streamingAssistantEntryId === undefined) {
                    return {
                        ...state,
                        transcript: [
                            ...state.transcript,
                            {
                                id: state.nextTranscriptId,
                                role: "assistant",
                                content: action.event.chunk,
                                isStreaming: true,
                            },
                        ],
                        nextTranscriptId: state.nextTranscriptId + 1,
                        streamingAssistantEntryId: state.nextTranscriptId,
                        activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                    };
                }

                return {
                    ...state,
                    transcript: appendAssistantDeltaToTranscript(
                        state.transcript,
                        state.streamingAssistantEntryId,
                        action.event.chunk,
                    ),
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "assistant_text_completed") {
                if (state.streamingAssistantEntryId === undefined) {
                    return {
                        ...state,
                        activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                    };
                }

                return {
                    ...state,
                    transcript: replaceAssistantTranscriptEntry(
                        state.transcript,
                        state.streamingAssistantEntryId,
                        action.event.content,
                    ),
                    // Keep the entry id around until the final assistant message is
                    // committed so the reducer can replace the streamed row instead
                    // of appending a duplicate copy of the same answer.
                    streamingAssistantEntryId: state.streamingAssistantEntryId,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "plan_mode_entered") {
                return {
                    ...state,
                    mode: "plan",
                    activePlanFilePath: action.event.filePath,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "system",
                            content: formatModeChangedTranscriptEntry("plan"),
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(
                        {
                            ...state.activeRun,
                            mode: "plan",
                        },
                        action.event,
                    ),
                };
            }

            if (action.event.type === "plan_written") {
                return {
                    ...state,
                    activePlanFilePath: action.event.filePath,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "system",
                            content: formatPlanSavedTranscriptEntry(action.event.filePath),
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "plan_approval_requested") {
                return {
                    ...state,
                    activePlanFilePath: action.event.filePath,
                    activePlanContent: action.event.content,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "plan_mode_exited") {
                return {
                    ...state,
                    mode: "execute",
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "system",
                            content: formatPlanExitedTranscriptEntry(action.event.filePath),
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(
                        {
                            ...state.activeRun,
                            mode: "execute",
                        },
                        action.event,
                    ),
                };
            }

            if (action.event.type === "usage_updated") {
                return {
                    ...state,
                    contextBudget: recordModelUsage(state.contextBudget, {
                        model: action.event.model,
                        inputTokens: action.event.inputTokens,
                        outputTokens: action.event.outputTokens,
                        totalTokens: action.event.totalTokens,
                    }),
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "tool_requested") {
                const transcript =
                    state.streamingAssistantEntryId !== undefined
                        ? removeTranscriptEntry(state.transcript, state.streamingAssistantEntryId)
                        : state.transcript;
                const finalTranscript =
                    state.streamingReasoningEntryId !== undefined
                        ? completeTranscriptEntry(transcript, state.streamingReasoningEntryId)
                        : transcript;

                return {
                    ...state,
                    transcript: [
                        ...finalTranscript,
                        {
                            id: state.nextTranscriptId,
                            role: "tool_call",
                            content: formatToolCallLabel(action.event.toolName, action.event.args),
                            toolName: action.event.toolName,
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    streamingAssistantEntryId: undefined,
                    streamingReasoningEntryId: undefined,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "tool_finished") {
                return {
                    ...state,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "tool_result",
                            content: formatToolResultLabel(action.event.toolName, action.event.preview),
                            toolName: action.event.toolName,
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "tool_failed") {
                return {
                    ...state,
                    transcript: [
                        ...state.transcript,
                        {
                            id: state.nextTranscriptId,
                            role: "tool_result",
                            content: `error · ${action.event.error}`,
                            toolName: action.event.toolName,
                        },
                    ],
                    nextTranscriptId: state.nextTranscriptId + 1,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            if (action.event.type === "diff_preview_ready") {
                return {
                    ...state,
                    activeRun: applyAgentEventToRunState(state.activeRun, action.event),
                };
            }

            return {
                ...state,
                activeRun: applyAgentEventToRunState(state.activeRun, action.event),
            };
    }
}
