import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { Box, useApp, useInput, useStdin } from "ink";
import { runAgent } from "../agent/runAgent";
import { OpenAIClient, StubClient, type ModelClient } from "../llm/client";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentMode } from "../tools/policy";
import { type AgentEvent, type Message, type PlanApprovalDecision } from "../types";
import { initAgentTool } from "../tools/agentTool";
import { allTools } from "../tools";
import { drainNotifications, formatNotification } from "../agent/notificationQueue";
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
import {
    appendToSession,
    appendToHistory,
    listSessions,
    loadHistory,
    loadSessions,
    searchSessions,
    setSessionTitle,
} from "../utils/sessionStorage";
import { SlashCommandMenu, getMatchingCommands } from "./components/SlashCommandMenu";
import { SessionPicker, type SessionPickerItem } from "./components/SessionPicker";

type Props = {
    initialPrompt?: string;
    resumeSessionId?: string;
};

const HELP_TEXT = [
    "Available commands:",
    "/plan        - switch to plan mode",
    "/execute     - switch to execute mode",
    "/compact     - compact older context",
    "/clear       - clear transcript and start new session",
    "/sessions    - list previous sessions",
    "/resume <n>  - resume a previous session",
    "/search <q>  - search across all sessions",
    "/help        - show this help",
    "/quit        - exit minicode",
    "",
    "Up/Down arrows cycle through prompt history.",
].join("\n");

function createClient(): ModelClient {
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey) {
        return new OpenAIClient(apiKey);
    }

    return new StubClient();
}

function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    return `${days}d ago`;
}

export function App({ initialPrompt, resumeSessionId }: Props): React.ReactElement {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
    const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
    const permissionResolverRef = useRef<((decision: PermissionDecision) => void) | null>(null);
    const planApprovalResolverRef = useRef<((decision: PlanApprovalDecision) => void) | null>(null);
    const activeRunAbortRef = useRef<AbortController | null>(null);
    const clientRef = useRef<ModelClient>(createClient());
    const initialPromptSubmittedRef = useRef(false);
    const sessionIdRef = useRef(randomUUID());

    // Give the agent tool access to the shared ModelClient and full tool list.
    // This runs once on mount (clientRef is stable).
    useEffect(() => {
        initAgentTool(clientRef.current, allTools, (event) => {
            switch (event.type) {
                case "subagent_started": {
                    const label = event.background
                        ? `agent:${event.agentType} (background)`
                        : `agent:${event.agentType}`;
                    dispatch({
                        type: "agent_event",
                        event: { type: "tool_started", toolName: label },
                    });
                    break;
                }
                case "subagent_tool_used":
                    dispatch({
                        type: "agent_event",
                        event: {
                            type: "tool_started",
                            toolName: `agent:${event.agentType} → ${event.toolName}`,
                        },
                    });
                    break;
                case "subagent_finished":
                    dispatch({
                        type: "agent_event",
                        event: {
                            type: "tool_finished",
                            toolName: `agent:${event.agentType}`,
                            preview: `${event.toolUseCount} tool uses`,
                        },
                    });
                    break;
            }
        });
    }, []);
    const [isCompacting, setIsCompacting] = useState(false);
    const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
    const [slashMenuIndex, setSlashMenuIndex] = useState(0);

    // Prompt history (up/down arrow to cycle)
    const promptHistoryRef = useRef<string[]>(loadHistory());
    const [historyIndex, setHistoryIndex] = useState(-1); // -1 = not browsing
    const savedInputRef = useRef(""); // stash current input when entering history

    // Session picker (interactive resume)
    const [sessionPickerItems, setSessionPickerItems] = useState<SessionPickerItem[] | null>(null);
    const [sessionPickerIndex, setSessionPickerIndex] = useState(0);

    // Session title generation (once per session)
    const titleGeneratedRef = useRef(false);

    // Compute slash command menu state from current input
    const showSlashMenu = !state.isRunning
        && !isCompacting
        && state.currentInput.startsWith("/")
        && !state.currentInput.includes(" ");
    const slashMatches = showSlashMenu ? getMatchingCommands(state.currentInput) : [];
    const clampedMenuIndex = Math.min(slashMenuIndex, Math.max(0, slashMatches.length - 1));
    const terminalRows = process.stdout.rows ?? 24;
    const reservedRows =
        11
        + (state.activeRun.status === "awaiting_permission" ? 4 : 0)
        + (state.activeRun.status === "awaiting_plan_approval" ? 8 : 0)
        + (state.activeRun.diffPreview ? 10 : 0)
        + (state.activeRun.error ? 2 : 0);
    const transcriptViewportSize = Math.max(4, terminalRows - reservedRows);
    const maxTranscriptScrollOffset = Math.max(0, state.transcript.length - transcriptViewportSize);
    const transcriptStartIndex = Math.max(
        0,
        state.transcript.length - transcriptViewportSize - transcriptScrollOffset,
    );
    const visibleTranscript = state.transcript.slice(
        transcriptStartIndex,
        transcriptStartIndex + transcriptViewportSize,
    );
    const showEarlierMessages = transcriptStartIndex > 0;
    const showLaterMessages = transcriptStartIndex + visibleTranscript.length < state.transcript.length;

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
                sessionIdRef.current = randomUUID();
                dispatch({ type: "transcript_cleared" });
                dispatch({ type: "system_message_added", content: "New session started." });
                return true;
            case "compact":
                await handleManualCompact();
                return true;
            case "sessions":
            case "resume": {
                const sessions = listSessions();
                if (sessions.length === 0) {
                    dispatch({ type: "system_message_added", content: "No previous sessions found." });
                    dispatch({ type: "input_changed", value: "" });
                    return true;
                }
                setSessionPickerItems(sessions);
                setSessionPickerIndex(0);
                dispatch({ type: "input_changed", value: "" });
                return true;
            }
            case "search": {
                const query = trimmedInput.slice("/search".length).trim();
                if (!query) {
                    dispatch({ type: "system_message_added", content: "Usage: /search <query>" });
                    dispatch({ type: "input_changed", value: "" });
                    return true;
                }
                const results = searchSessions(query);
                if (results.length === 0) {
                    dispatch({ type: "system_message_added", content: `No sessions found matching "${query}".` });
                } else {
                    const list = results
                        .slice(0, 10)
                        .map((r, i) => {
                            const ago = formatTimeAgo(r.modified);
                            const prompt = r.firstPrompt.length > 40
                                ? r.firstPrompt.slice(0, 37) + "..."
                                : r.firstPrompt;
                            return `  ${i + 1}. ${prompt}  — ${ago}\n     match: ${r.matchingLine}`;
                        })
                        .join("\n");
                    dispatch({
                        type: "system_message_added",
                        content: `Sessions matching "${query}":\n${list}`,
                    });
                }
                dispatch({ type: "input_changed", value: "" });
                return true;
            }
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

    const generateTitle = useCallback(async (userPrompt: string, assistantReply: string, sid: string) => {
        try {
            const titleClient = createClient();
            const step = await titleClient.next({
                messages: [
                    { role: "system", content: "Generate a short title (max 6 words) for this conversation. Reply with ONLY the title, no quotes, no punctuation at the end." },
                    { role: "user", content: userPrompt },
                    { role: "assistant", content: assistantReply },
                    { role: "user", content: "Title:" },
                ],
                tools: [],
            });
            if (step.type === "message") {
                const title = step.message.content.trim().slice(0, 60);
                setSessionTitle(sid, title);
            }
        } catch {
            // Title generation is best-effort — don't crash the session
        }
    }, []);

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
                    
                    // Persist to disk                                                                                                                    
                    if (event.type === "tool_requested") {
                        appendToSession(sessionIdRef.current, {                                                                                           
                            type: "tool_call",                            
                            name: event.toolName,                                                                                                         
                            args: event.args,
                        });                                                                                                                               
                    } else if (event.type === "tool_finished") {          
                        appendToSession(sessionIdRef.current, {
                            type: "tool_result",
                            name: event.toolName,
                            content: event.preview,                                                                                                       
                        });
                    }
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
            appendToSession(sessionIdRef.current, { type: "assistant", content: message.content });

            dispatch({ type: "run_completed" });

            // Auto-generate a session title after the first exchange
            if (!titleGeneratedRef.current) {
                titleGeneratedRef.current = true;
                void generateTitle(prompt, message.content, sessionIdRef.current);
            }

            // --- Auto-drain background agent notifications ---
            // If any background sub-agents completed while the main loop was
            // running (or just after it finished), inject their results as a
            // new conversation turn so the model can see them.
            // This mirrors Claude Code's useQueueProcessor: when the main
            // query finishes and the REPL is idle, check the queue and
            // auto-submit any pending notifications.
            const pending = drainNotifications();
            if (pending.length > 0) {
                const notificationText = pending
                    .map(formatNotification)
                    .join("\n\n---\n\n");

                const notificationMessages: Message[] = [
                    ...transcriptMessages,
                    { role: "assistant", content: message.content },
                    { role: "user", content: notificationText },
                ];

                dispatch({
                    type: "system_message_added",
                    content: `${pending.length} background agent(s) completed — processing results...`,
                });

                // Start a new agent turn with the notification injected.
                // This is fire-and-forget; it re-enters startRun which will
                // itself check for more notifications when it finishes
                // (handles cascading completions).
                void startRun(notificationText, notificationMessages, mode);
            }
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
        appendToSession(sessionIdRef.current, { type: "user", content: trimmedPrompt });
        appendToHistory(trimmedPrompt);
        promptHistoryRef.current.push(trimmedPrompt);
        setHistoryIndex(-1);

        setTranscriptScrollOffset(0);
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

            if (sessionPickerItems) {
                setSessionPickerItems(null);
                setSessionPickerIndex(0);
                return;
            }

            exit();
            return;
        }

        // --- Session picker navigation ---
        if (sessionPickerItems && sessionPickerItems.length > 0) {
            if (key.upArrow) {
                setSessionPickerIndex((i) => (i <= 0 ? sessionPickerItems.length - 1 : i - 1));
                return;
            }
            if (key.downArrow) {
                setSessionPickerIndex((i) => (i >= sessionPickerItems.length - 1 ? 0 : i + 1));
                return;
            }
            if (key.return) {
                const selected = sessionPickerItems[sessionPickerIndex];
                if (selected) {
                    const messages = loadSessions(selected.id);
                    sessionIdRef.current = selected.id as ReturnType<typeof randomUUID>;
                    dispatch({ type: "session_resumed", messages, sessionId: selected.id });
                    setSessionPickerItems(null);
                    setSessionPickerIndex(0);
                }
                return;
            }
            // Absorb all other keys while picker is open
            return;
        }

        // --- Slash command menu navigation ---
        if (showSlashMenu && slashMatches.length > 0) {
            if (key.upArrow) {
                setSlashMenuIndex((i) => (i <= 0 ? slashMatches.length - 1 : i - 1));
                return;
            }
            if (key.downArrow) {
                setSlashMenuIndex((i) => (i >= slashMatches.length - 1 ? 0 : i + 1));
                return;
            }
            if (key.tab) {
                // Autocomplete the selected command
                const selected = slashMatches[clampedMenuIndex];
                if (selected) {
                    dispatch({ type: "input_changed", value: `/${selected.name} ` });
                    setSlashMenuIndex(0);
                }
                return;
            }
            if (key.return) {
                // Run the selected command
                const selected = slashMatches[clampedMenuIndex];
                if (selected) {
                    void handleSlashCommand(`/${selected.name}`);
                    setSlashMenuIndex(0);
                }
                return;
            }
        }

        // --- Prompt history (when idle) or transcript scrolling (when running) ---
        if (key.upArrow) {
            if (!state.isRunning && promptHistoryRef.current.length > 0) {
                const history = promptHistoryRef.current;
                if (historyIndex === -1) {
                    // Entering history — save current input
                    savedInputRef.current = state.currentInput;
                    const newIndex = history.length - 1;
                    setHistoryIndex(newIndex);
                    dispatch({ type: "input_changed", value: history[newIndex]! });
                } else if (historyIndex > 0) {
                    const newIndex = historyIndex - 1;
                    setHistoryIndex(newIndex);
                    dispatch({ type: "input_changed", value: history[newIndex]! });
                }
            } else {
                setTranscriptScrollOffset((current) => Math.min(maxTranscriptScrollOffset, current + 1));
            }
            return;
        }

        if (key.downArrow) {
            if (!state.isRunning && historyIndex !== -1) {
                const history = promptHistoryRef.current;
                if (historyIndex < history.length - 1) {
                    const newIndex = historyIndex + 1;
                    setHistoryIndex(newIndex);
                    dispatch({ type: "input_changed", value: history[newIndex]! });
                } else {
                    // Past the end — restore saved input
                    setHistoryIndex(-1);
                    dispatch({ type: "input_changed", value: savedInputRef.current });
                }
            } else {
                setTranscriptScrollOffset((current) => Math.max(0, current - 1));
            }
            return;
        }

        if (key.pageUp) {
            setTranscriptScrollOffset((current) =>
                Math.min(maxTranscriptScrollOffset, current + Math.max(3, Math.floor(transcriptViewportSize / 2))),
            );
            return;
        }

        if (key.pageDown) {
            setTranscriptScrollOffset((current) =>
                Math.max(0, current - Math.max(3, Math.floor(transcriptViewportSize / 2))),
            );
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
            setSlashMenuIndex(0);
            return;
        }

        if (!key.ctrl && !key.meta && input.length > 0) {
            dispatch({
                type: "input_changed",
                value: `${state.currentInput}${input}`,
            });
            setSlashMenuIndex(0);
        }
    }, {
        isActive:
            isRawModeSupported
            && !isCompacting
            && !state.activeRun.pendingPermission
            && !state.activeRun.pendingPlanApproval,
    });

    useEffect(() => {
        setTranscriptScrollOffset((current) => Math.min(current, maxTranscriptScrollOffset));
    }, [maxTranscriptScrollOffset]);

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

    // Resume session from --resume flag
    const resumeHandledRef = useRef(false);
    useEffect(() => {
        if (!resumeSessionId || resumeHandledRef.current) return;
        resumeHandledRef.current = true;

        if (resumeSessionId === "last") {
            const sessions = listSessions();
            if (sessions.length > 0) {
                const last = sessions[0]!;
                const messages = loadSessions(last.id);
                sessionIdRef.current = last.id as ReturnType<typeof randomUUID>;
                dispatch({ type: "session_resumed", messages, sessionId: last.id });
                titleGeneratedRef.current = true; // already has a title
            }
        } else {
            const messages = loadSessions(resumeSessionId);
            sessionIdRef.current = resumeSessionId as ReturnType<typeof randomUUID>;
            dispatch({ type: "session_resumed", messages, sessionId: resumeSessionId });
            titleGeneratedRef.current = true;
        }
    }, [resumeSessionId]);

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
            <Transcript
                transcript={visibleTranscript}
                showEarlier={showEarlierMessages}
                showLater={showLaterMessages}
            />
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
            {showSlashMenu && slashMatches.length > 0 && (
                <SlashCommandMenu
                    matches={slashMatches}
                    selectedIndex={clampedMenuIndex}
                />
            )}
            {sessionPickerItems && sessionPickerItems.length > 0 && (
                <SessionPicker
                    sessions={sessionPickerItems}
                    selectedIndex={sessionPickerIndex}
                    formatTimeAgo={formatTimeAgo}
                />
            )}
            <InputBar
                value={state.currentInput}
                mode={state.mode}
                disabled={
                    state.isRunning
                    || isCompacting
                    || Boolean(state.activeRun.pendingPermission)
                    || Boolean(state.activeRun.pendingPlanApproval)
                    || Boolean(sessionPickerItems)
                }
            />
        </Box>
    );
}
