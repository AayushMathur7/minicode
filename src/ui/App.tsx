import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Box, useApp, useInput, useStdin, useStdout } from "ink";
import { runAgent } from "../agent/runAgent";
import { OpenAIClient, StubClient, type ModelClient } from "../llm/client";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentEvent, type Message } from "../types";
import { Banner } from "./components/Banner";
import { DiffPreview } from "./components/DiffPreview";
import { FinalAnswer } from "./components/FinalAnswer";
import { InputBar } from "./components/InputBar";
import { InlineRunStatus } from "./components/InlineRunStatus";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { Transcript } from "./components/Transcript";
import { createInitialSessionState, sessionReducer } from "./state";

type Props = {
    initialPrompt?: string;
};

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
    const { stdout } = useStdout();
    const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
    const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
    const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);
    const activeRunAbortRef = useRef<AbortController | null>(null);
    const clientRef = useRef<ModelClient>(createClient());
    const initialPromptSubmittedRef = useRef(false);

    const handlePermissionDecision = useCallback((decision: PermissionDecision): void => {
        permissionResolverRef.current?.(decision);
        permissionResolverRef.current = null;
    }, []);

    const startRun = useCallback(async (prompt: string, transcriptMessages: Message[]): Promise<void> => {
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
                },
                (event: AgentEvent) => {
                    dispatch({ type: "agent_event", event });
                },
                async () =>
                    new Promise<PermissionDecision>((resolve) => {
                        permissionResolverRef.current = resolve;
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

    const submitPrompt = useCallback((prompt: string): void => {
        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt || state.isRunning || state.activeRun.pendingPermission) {
            return;
        }

        const transcriptMessages: Message[] = [
            ...state.transcript
                .filter((entry) => entry.role !== "system")
                .map<Message>((entry) => ({
                    role: entry.role,
                    content: entry.content,
                })),
            {
                role: "user",
                content: trimmedPrompt,
            },
        ];

        dispatch({ type: "prompt_submitted", prompt: trimmedPrompt });
        setTranscriptScrollOffset(0);
        void startRun(trimmedPrompt, transcriptMessages);
    }, [startRun, state.activeRun.pendingPermission, state.isRunning, state.transcript]);

    const visibleTranscriptCount = useMemo(() => {
        const terminalRows = stdout.rows ?? 24;
        return Math.max(4, Math.floor((terminalRows - 10) / 2));
    }, [stdout.rows]);

    const maxTranscriptScrollOffset = Math.max(0, state.transcript.length - visibleTranscriptCount);
    const clampedTranscriptScrollOffset = Math.min(transcriptScrollOffset, maxTranscriptScrollOffset);

    const visibleTranscript = useMemo(() => {
        if (state.transcript.length <= visibleTranscriptCount) {
            return state.transcript;
        }

        const endIndex = state.transcript.length - clampedTranscriptScrollOffset;
        const startIndex = Math.max(0, endIndex - visibleTranscriptCount);

        return state.transcript.slice(startIndex, endIndex);
    }, [clampedTranscriptScrollOffset, state.transcript, visibleTranscriptCount]);

    const hiddenAboveCount = Math.max(0, state.transcript.length - visibleTranscript.length - clampedTranscriptScrollOffset);
    const hiddenBelowCount = clampedTranscriptScrollOffset;

    useInput((input, key) => {
        if (key.ctrl && input.toLowerCase() === "c") {
            exit();
            return;
        }

        if (key.escape) {
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

        if (key.upArrow) {
            setTranscriptScrollOffset((current) => Math.min(maxTranscriptScrollOffset, current + 1));
            return;
        }

        if (key.downArrow) {
            setTranscriptScrollOffset((current) => Math.max(0, current - 1));
            return;
        }

        if (key.pageUp) {
            setTranscriptScrollOffset((current) => Math.min(maxTranscriptScrollOffset, current + 5));
            return;
        }

        if (key.pageDown) {
            setTranscriptScrollOffset((current) => Math.max(0, current - 5));
            return;
        }

        if (key.home) {
            setTranscriptScrollOffset(maxTranscriptScrollOffset);
            return;
        }

        if (key.end) {
            setTranscriptScrollOffset(0);
            return;
        }

        if (state.activeRun.pendingPermission || state.isRunning) {
            return;
        }

        if (key.return) {
            submitPrompt(state.currentInput);
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
        isActive: isRawModeSupported && !state.activeRun.pendingPermission,
    });

    useEffect(() => {
        return () => {
            if (permissionResolverRef.current) {
                permissionResolverRef.current("deny");
                permissionResolverRef.current = null;
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
        submitPrompt(initialPrompt);
    }, [initialPrompt, submitPrompt]);

    useEffect(() => {
        if (transcriptScrollOffset > maxTranscriptScrollOffset) {
            setTranscriptScrollOffset(maxTranscriptScrollOffset);
        }
    }, [maxTranscriptScrollOffset, transcriptScrollOffset]);

    return (
        <Box flexDirection="column">
            <Banner />
            <Transcript
                transcript={visibleTranscript}
                hiddenAboveCount={hiddenAboveCount}
                hiddenBelowCount={hiddenBelowCount}
            />
            <InlineRunStatus state={state.activeRun} />
            <DiffPreview diffPreview={state.activeRun.diffPreview} />
            <PermissionPrompt
                pendingPermission={state.activeRun.pendingPermission}
                onDecision={handlePermissionDecision}
            />
            <FinalAnswer
                error={state.activeRun.error}
            />
            <InputBar
                value={state.currentInput}
                disabled={state.isRunning || Boolean(state.activeRun.pendingPermission)}
            />
        </Box>
    );
}
