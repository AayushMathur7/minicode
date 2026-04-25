import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Box, useApp, useInput, useStdin } from "ink";
import { OpenAIClient, StubClient, type ModelClient } from "../llm/client";
import { AgentSession } from "../runtime/agentSession";
import { SessionStore } from "../runtime/sessionStore";
import { initAgentTool } from "../tools/agentTool";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentMode } from "../tools/policy";
import { type PlanApprovalDecision } from "../types";
import { allTools } from "../tools";
import { Banner } from "./components/Banner";
import { ContextMeter } from "./components/ContextMeter";
import { DiffPreview } from "./components/DiffPreview";
import { FinalAnswer } from "./components/FinalAnswer";
import { InlineRunStatus } from "./components/InlineRunStatus";
import { InputBar } from "./components/InputBar";
import { PermissionPrompt } from "./components/PermissionPrompt";
import { PlanApprovalPrompt } from "./components/PlanApprovalPrompt";
import { SessionPicker, type SessionPickerItem } from "./components/SessionPicker";
import { SlashCommandMenu, getMatchingCommands } from "./components/SlashCommandMenu";
import { Transcript } from "./components/Transcript";
import { createInitialSessionState, sessionReducer } from "./state";

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
	const initialPromptSubmittedRef = useRef(false);
	const resumeHandledRef = useRef(false);
	const clientRef = useRef<ModelClient>(createClient());
	const sessionRef = useRef<AgentSession>(
		new AgentSession(clientRef.current, createClient, new SessionStore(), process.cwd()),
	);
	const [isCompacting, setIsCompacting] = useState(false);
	const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
	const [slashMenuIndex, setSlashMenuIndex] = useState(0);
	const promptHistoryRef = useRef<string[]>(sessionRef.current.loadHistory());
	const [historyIndex, setHistoryIndex] = useState(-1);
	const savedInputRef = useRef("");
	const [sessionPickerItems, setSessionPickerItems] = useState<SessionPickerItem[] | null>(null);
	const [sessionPickerIndex, setSessionPickerIndex] = useState(0);

	useEffect(() => {
		const unsubscribe = sessionRef.current.subscribe((event) => {
			if (event.type === "action") {
				dispatch(event.action);
			}
		});

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

		return unsubscribe;
	}, []);

	const showSlashMenu =
		!state.isRunning &&
		!isCompacting &&
		state.currentInput.startsWith("/") &&
		!state.currentInput.includes(" ");
	const slashMatches = showSlashMenu ? getMatchingCommands(state.currentInput) : [];
	const clampedMenuIndex = Math.min(slashMenuIndex, Math.max(0, slashMatches.length - 1));
	const terminalRows = process.stdout.rows ?? 24;
	const reservedRows =
		11 +
		(state.activeRun.status === "awaiting_permission" ? 4 : 0) +
		(state.activeRun.status === "awaiting_plan_approval" ? 8 : 0) +
		(state.activeRun.diffPreview ? 10 : 0) +
		(state.activeRun.error ? 2 : 0);
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

		sessionRef.current.setMode(state.mode === "execute" ? "plan" : "execute");
	}, [state.activeRun.pendingPermission, state.isRunning, state.mode]);

	const handleManualCompact = useCallback(async (): Promise<void> => {
		dispatch({ type: "input_changed", value: "" });
		setIsCompacting(true);
		try {
			await sessionRef.current.compactConversation();
		} finally {
			setIsCompacting(false);
		}
	}, []);

	const handleSlashCommand = useCallback(
		async (rawInput: string): Promise<boolean> => {
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
						sessionRef.current.setMode("plan");
					}
					dispatch({ type: "input_changed", value: "" });
					return true;
				case "execute":
					if (state.mode === "execute") {
						dispatch({ type: "system_message_added", content: "Already in execute mode" });
					} else {
						sessionRef.current.setMode("execute");
					}
					dispatch({ type: "input_changed", value: "" });
					return true;
				case "clear":
					sessionRef.current.clearSession();
					return true;
				case "compact":
					await handleManualCompact();
					return true;
				case "sessions":
				case "resume": {
					const sessions = sessionRef.current.listSessions();
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
					const results = sessionRef.current.searchSessions(query);
					if (results.length === 0) {
						dispatch({ type: "system_message_added", content: `No sessions found matching "${query}".` });
					} else {
						const list = results
							.slice(0, 10)
							.map((result, index) => {
								const ago = formatTimeAgo(result.modified);
								const prompt =
									result.firstPrompt.length > 40
										? `${result.firstPrompt.slice(0, 37)}...`
										: result.firstPrompt;
								return `  ${index + 1}. ${prompt}  — ${ago}\n     match: ${result.matchingLine}`;
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
		},
		[dispatch, exit, handleManualCompact, state.mode],
	);

	const submitPrompt = useCallback(
		async (prompt: string, _mode: AgentMode): Promise<void> => {
			const trimmedPrompt = prompt.trim();
			if (
				!trimmedPrompt ||
				state.isRunning ||
				state.activeRun.pendingPermission ||
				state.activeRun.pendingPlanApproval ||
				isCompacting
			) {
				return;
			}

			promptHistoryRef.current.push(trimmedPrompt);
			setHistoryIndex(-1);
			setTranscriptScrollOffset(0);

			await sessionRef.current.submitPrompt(
				trimmedPrompt,
				async (params) =>
					new Promise<PermissionDecision>((resolve) => {
						permissionResolverRef.current = resolve;
					}),
				async (params) =>
					new Promise<PlanApprovalDecision>((resolve) => {
						planApprovalResolverRef.current = resolve;
					}),
			);
		},
		[
			isCompacting,
			state.activeRun.pendingPermission,
			state.activeRun.pendingPlanApproval,
			state.isRunning,
		],
	);

	useInput(
		(input, key) => {
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
					sessionRef.current.cancel("interrupt");
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

			if (sessionPickerItems && sessionPickerItems.length > 0) {
				if (key.upArrow) {
					setSessionPickerIndex((index) => (index <= 0 ? sessionPickerItems.length - 1 : index - 1));
					return;
				}
				if (key.downArrow) {
					setSessionPickerIndex((index) =>
						index >= sessionPickerItems.length - 1 ? 0 : index + 1,
					);
					return;
				}
				if (key.return) {
					const selected = sessionPickerItems[sessionPickerIndex];
					if (selected) {
						void sessionRef.current.resumeSession(selected.id);
						setSessionPickerItems(null);
						setSessionPickerIndex(0);
					}
					return;
				}
				return;
			}

			if (showSlashMenu && slashMatches.length > 0) {
				if (key.upArrow) {
					setSlashMenuIndex((index) => (index <= 0 ? slashMatches.length - 1 : index - 1));
					return;
				}
				if (key.downArrow) {
					setSlashMenuIndex((index) => (index >= slashMatches.length - 1 ? 0 : index + 1));
					return;
				}
				if (key.tab) {
					const selected = slashMatches[clampedMenuIndex];
					if (selected) {
						dispatch({ type: "input_changed", value: `/${selected.name} ` });
						setSlashMenuIndex(0);
					}
					return;
				}
				if (key.return) {
					const selected = slashMatches[clampedMenuIndex];
					if (selected) {
						void handleSlashCommand(`/${selected.name}`);
						setSlashMenuIndex(0);
					}
					return;
				}
			}

			if (key.upArrow) {
				if (!state.isRunning && promptHistoryRef.current.length > 0) {
					const history = promptHistoryRef.current;
					if (historyIndex === -1) {
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

			if (
				state.activeRun.pendingPermission ||
				state.activeRun.pendingPlanApproval ||
				state.isRunning ||
				isCompacting
			) {
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
				dispatch({ type: "input_changed", value: state.currentInput.slice(0, -1) });
				setSlashMenuIndex(0);
				return;
			}

			if (!key.ctrl && !key.meta && input.length > 0) {
				dispatch({ type: "input_changed", value: `${state.currentInput}${input}` });
				setSlashMenuIndex(0);
			}
		},
		{
			isActive:
				isRawModeSupported &&
				!isCompacting &&
				!state.activeRun.pendingPermission &&
				!state.activeRun.pendingPlanApproval,
		},
	);

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

			sessionRef.current.cancel("shutdown");
		};
	}, []);

	useEffect(() => {
		if (!resumeSessionId || resumeHandledRef.current) return;
		resumeHandledRef.current = true;

		if (resumeSessionId === "last") {
			const sessions = sessionRef.current.listSessions();
			if (sessions.length > 0) {
				void sessionRef.current.resumeSession(sessions[0]!.id);
			}
			return;
		}

		void sessionRef.current.resumeSession(resumeSessionId);
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
			<FinalAnswer error={state.activeRun.error} />
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
					state.isRunning ||
					isCompacting ||
					Boolean(state.activeRun.pendingPermission) ||
					Boolean(state.activeRun.pendingPlanApproval) ||
					Boolean(sessionPickerItems)
				}
			/>
		</Box>
	);
}
