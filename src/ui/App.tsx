import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { Box, useApp, useInput, useStdin } from "ink";
import { runAgent } from "../agent/runAgent";
import { OpenAIClient, StubClient, type ModelClient } from "../llm/client";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentMode } from "../tools/policy";
import { type AgentEvent, type Message, type PlanApprovalDecision } from "../types";
import {
    buildConversationFromCompactedContext,
    compactConversationWithSummary,
    formatCompactionSystemMessage,
} from "../agent/compact";
import { shouldAutoCompact, updateEstimatedContextTokens } from "../agent/contextBudget";
import { Banner } from "./components/Banner";
import { ContextMeter } from "./components/ContextMeter";
import { DiffPreview } from "./components/DiffPreview";
import { FinalAnswer } from "./components/FinalAnswer";
import { InputBar } from "./components/InputBar";
import { InlineRunStatus } from "./components/InlineRunStatus";
import { PlanApprovalPrompt } from "./components/PlanApprovalPrompt";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { Transcript } from "./components/Transcript";
import { createInitialSessionState, sessionReducer } from "./state";

type Props = {
    initialPrompt?: string;
};

const HELP_TEXT = [
    "Available commands:",
    "/plan - switch the session into plan mode",
    "/execute - switch back to execute mode",
    "/compact - compact older model context and keep a recent tail",
    "/clear - clear the visible transcript",
    "/help - show available commands",
    "/quit - exit minicode",
].join("\n");

function createClient(): ModelClient {
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
        return new OpenAIClient(apiKey);
    }

    return new StubClient();
}

export function App({ initialPrompt }: Props): React.ReactElement {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
    const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
    const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);
    const planApprovalResolverRef = useRef<((decision: PlanApprovalDecision) => void) | null>(null);
    const activeRunAbortRef = useRef<AbortController | null>(null);
    const clientRef = useRef<ModelClient>(createClient());
    const initialPromptSubmittedRef = useRef(false);
    const sessionIdRef = useRef(randomUUID());
    const [isCompacting, setIsCompacting] = useState(false);

    const handlePermissionDecision = useCallback((decision: PermissionDecision): void => {
        permissionResolverRef.current?.(decision);
        permissionResolverRef.current = null;
    }, []);

    const handlePlanApprovalDecision = useCallback((decision: PlanApprovalDecision): void => {
        planApprovalResolverRef.current?.(decision);
        planApprovalResolverRef.current = null;
    }, []);

    const handleModeToggle = useCallback((): void => {
        if (state.isRunning || state.activeRun.pendingPermission) {
            return;
        }

        dispatch({
            type: "mode_changed",
            mode: state.mode === "execute" ? "plan" : "execute",
        });
    }, [state.activeRun.pendingPermission, state.isRunning, state.mode]);

    /**
     * The UI transcript contains more than the model should necessarily see:
     * - streamed notes
     * - tool feed rows
     * - system status messages
     *
     * For model history we currently keep only the canonical user/assistant turns.
     */
    const getConversationMessages = useCallback((): Message[] => {
        return state.conversationMessages;
    }, [state.conversationMessages]);

    const performCompaction = useCallback(async (conversationMessages: Message[]) => {
        if (conversationMessages.length === 0 || isCompacting) {
            return undefined;
        }

        setIsCompacting(true);
        dispatch({
            type: "system_message_added",
            content: "Compacting context...",
        });

        try {
            const compactedContext = await compactConversationWithSummary(
                createClient(),
                conversationMessages,
                state.contextBudget,
            );

            dispatch({
                type: "conversation_compacted",
                compactedContext,
                systemMessage: formatCompactionSystemMessage(compactedContext, state.contextBudget),
            });
            return compactedContext;
        } finally {
            setIsCompacting(false);
        }
    }, [isCompacting, state.contextBudget]);

    const handleManualCompact = useCallback(async (): Promise<void> => {
        const conversationMessages = getConversationMessages();

        if (conversationMessages.length === 0) {
            dispatch({
                type: "system_message_added",
                content: "Nothing to compact yet",
            });
            dispatch({ type: "input_changed", value: "" });
            return;
        }

        dispatch({ type: "input_changed", value: "" });
        await performCompaction(conversationMessages);
    }, [getConversationMessages, performCompaction]);

    const handleSlashCommand = useCallback(async (rawInput: string): Promise<boolean> => {
        const trimmedInput = rawInput.trim();

        if (!trimmedInput.startsWith("/")) {
            return false;
        }

        const [command] = trimmedInput.slice(1).split(/\s+/, 1);

        switch (command) {
            case "plan":
                if (state.mode === "plan") {
                    dispatch({ type: "system_message_added", content: "Already in plan mode" });
                } else {
                    dispatch({ type: "mode_changed", mode: "plan" });
                }
                dispatch({ type: "input_changed", value: "" });
                return true;
            case "execute":
                if (state.mode === "execute") {
                    dispatch({ type: "system_message_added", content: "Already in execute mode" });
                } else {
                    dispatch({ type: "mode_changed", mode: "execute" });
                }
                dispatch({ type: "input_changed", value: "" });
                return true;
            case "clear":
                dispatch({ type: "transcript_cleared" });
                return true;
            case "compact":
                await handleManualCompact();
                return true;
            case "help":
                dispatch({ type: "system_message_added", content: HELP_TEXT });
                dispatch({ type: "input_changed", value: "" });
                return true;
            case "quit":
            case "exit":
                exit();
                return true;
            default:
                dispatch({
                    type: "system_message_added",
                    content: `Unknown command: /${command}. Use /help to see available commands.`,
                });
                dispatch({ type: "input_changed", value: "" });
                return true;
        }
    }, [dispatch, exit, handleManualCompact, state.mode]);

    const startRun = useCallback(async (prompt: string, transcriptMessages: Message[], mode: AgentMode): Promise<void> => {
        dispatch({ type: "run_started" });
        const abortController = new AbortController();
        activeRunAbortRef.current = abortController;

        try {
            const message = await runAgent(
                clientRef.current,
                transcriptMessages,
                {
                    cwd: process.cwd(),
                    toolPolicyMode: "full",
                    signal: abortController.signal,
                    mode,
                    sessionId: sessionIdRef.current,
                },
                (event: AgentEvent) => {
                    dispatch({ type: "agent_event", event });
                },
                async () =>
                    new Promise<PermissionDecision>((resolve) => {
                    permissionResolverRef.current = resolve;
                }),
                async () =>
                    new Promise<PlanApprovalDecision>((resolve) => {
                        planApprovalResolverRef.current = resolve;
                    }),
            );

            dispatch({ type: "assistant_message_added", content: message.content });
            dispatch({ type: "run_completed" });
        } catch (error) {
            if (abortController.signal.aborted) {
                dispatch({ type: "run_cancelled" });
                return;
            }

            dispatch({
                type: "run_failed",
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            if (activeRunAbortRef.current === abortController) {
                activeRunAbortRef.current = null;
            }
        }
    }, []);

    const submitPrompt = useCallback(async (prompt: string, mode: AgentMode): Promise<void> => {
        const trimmedPrompt = prompt.trim();

        if (
            !trimmedPrompt
            || state.isRunning
            || state.activeRun.pendingPermission
            || state.activeRun.pendingPlanApproval
            || isCompacting
        ) {
            return;
        }

        const liveConversationMessages = getConversationMessages();
        const projectedConversation = [
            ...liveConversationMessages,
            {
                role: "user" as const,
                content: trimmedPrompt,
            },
        ];
        const projectedBudget = updateEstimatedContextTokens(
            state.contextBudget,
            projectedConversation,
        );

        let conversationForRun = liveConversationMessages;

        if (shouldAutoCompact(projectedBudget) && liveConversationMessages.length > 0) {
            const compactedContext = await performCompaction(liveConversationMessages);
            if (compactedContext) {
                conversationForRun = buildConversationFromCompactedContext(compactedContext);
            }
        }

        const transcriptMessages: Message[] = [
            ...conversationForRun,
            {
                role: "user",
                content: trimmedPrompt,
            },
        ];

        dispatch({ type: "prompt_submitted", prompt: trimmedPrompt });
        void startRun(trimmedPrompt, transcriptMessages, mode);
    }, [
        getConversationMessages,
        isCompacting,
        startRun,
        state.activeRun.pendingPermission,
        state.activeRun.pendingPlanApproval,
        state.compactedContext,
        state.contextBudget,
        state.isRunning,
        performCompaction,
    ]);

    useInput((input, key) => {
        if (key.ctrl && input.toLowerCase() === "c") {
            exit();
            return;
        }

        if (key.escape) {
            if (state.activeRun.pendingPlanApproval) {
                handlePlanApprovalDecision("reject");
                return;
            }

            if (state.activeRun.pendingPermission) {
                handlePermissionDecision("deny");
                return;
            }

            if (state.isRunning) {
                activeRunAbortRef.current?.abort("interrupt");
                return;
            }

            exit();
            return;
        }

        if (state.activeRun.pendingPermission || state.activeRun.pendingPlanApproval || state.isRunning || isCompacting) {
            return;
        }

        if (key.tab && key.shift) {
            handleModeToggle();
            return;
        }

        if (key.return) {
            const trimmedInput = state.currentInput.trim();

            if (trimmedInput.startsWith("/")) {
                void handleSlashCommand(state.currentInput);
                return;
            }

            void submitPrompt(state.currentInput, state.mode);
            return;
        }

        if (key.backspace || key.delete) {
            dispatch({
                type: "input_changed",
                value: state.currentInput.slice(0, -1),
            });
            return;
        }

        if (!key.ctrl && !key.meta && input.length > 0) {
            dispatch({
                type: "input_changed",
                value: `${state.currentInput}${input}`,
            });
        }
    }, {
        isActive:
            isRawModeSupported
            && !isCompacting
            && !state.activeRun.pendingPermission
            && !state.activeRun.pendingPlanApproval,
    });

    useEffect(() => {
        return () => {
            if (permissionResolverRef.current) {
                permissionResolverRef.current("deny");
                permissionResolverRef.current = null;
            }

            if (planApprovalResolverRef.current) {
                planApprovalResolverRef.current("reject");
                planApprovalResolverRef.current = null;
            }

            activeRunAbortRef.current?.abort("shutdown");
            activeRunAbortRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!initialPrompt || initialPromptSubmittedRef.current) {
            return;
        }

        initialPromptSubmittedRef.current = true;

        if (initialPrompt.trim().startsWith("/")) {
            void handleSlashCommand(initialPrompt);
            return;
        }

        void submitPrompt(initialPrompt, "execute");
    }, [handleSlashCommand, initialPrompt, submitPrompt]);

    return (
        <Box flexDirection="column">
            <Banner />
            <ContextMeter budget={state.contextBudget} compacted={Boolean(state.compactedContext)} />
            <Transcript transcript={state.transcript} />
            <InlineRunStatus state={state.activeRun} />
            <DiffPreview diffPreview={state.activeRun.diffPreview} />
            <PermissionPrompt
                pendingPermission={state.activeRun.pendingPermission}
                onDecision={handlePermissionDecision}
            />
            <PlanApprovalPrompt
                pendingPlanApproval={state.activeRun.pendingPlanApproval}
                onDecision={handlePlanApprovalDecision}
            />
            <FinalAnswer
                error={state.activeRun.error}
            />
            <InputBar
                value={state.currentInput}
                mode={state.mode}
                disabled={
                    state.isRunning
                    || isCompacting
                    || Boolean(state.activeRun.pendingPermission)
                    || Boolean(state.activeRun.pendingPlanApproval)
                }
            />
        </Box>
    );
}
