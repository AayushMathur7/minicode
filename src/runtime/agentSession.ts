import { randomUUID } from "node:crypto";
import {
	buildConversationFromCompactedContext,
	compactConversationWithSummary,
	formatCompactionSystemMessage,
	type CompactedContextState,
} from "../agent/compact";
import { createInitialContextBudget, updateEstimatedContextTokens } from "../agent/contextBudget";
import { drainNotifications, formatNotification } from "../agent/notificationQueue";
import { runAgent } from "../agent/runAgent";
import { type ModelClient } from "../llm/client";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentMode } from "../tools/policy";
import { type Message, type PlanApprovalDecision } from "../types";
import { EventBus } from "./eventBus";
import { maybeCompactConversation } from "./messages";
import { SessionStore } from "./sessionStore";
import { type AgentSessionEvent, type PermissionRequestHandler, type PlanApprovalHandler, type SessionAction } from "./sessionTypes";

type RuntimeSessionState = {
	sessionId: string;
	mode: AgentMode;
	conversationMessages: Message[];
	compactedContext?: CompactedContextState;
	contextBudget: ReturnType<typeof createInitialContextBudget>;
	isRunning: boolean;
	isCompacting: boolean;
	titleGenerated: boolean;
};

export class AgentSession {
	private readonly events = new EventBus<AgentSessionEvent>();
	private readonly state: RuntimeSessionState = {
		sessionId: randomUUID(),
		mode: "execute",
		conversationMessages: [],
		compactedContext: undefined,
		contextBudget: createInitialContextBudget(),
		isRunning: false,
		isCompacting: false,
		titleGenerated: false,
	};

	private activeRunAbortController: AbortController | null = null;

	constructor(
		private readonly client: ModelClient,
		private readonly createClient: () => ModelClient,
		private readonly store: SessionStore,
		private readonly cwd: string,
	) {}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		return this.events.subscribe(listener);
	}

	loadHistory(): ReturnType<SessionStore["loadHistory"]> {
		return this.store.loadHistory();
	}

	listSessions(): ReturnType<SessionStore["listSessions"]> {
		return this.store.listSessions();
	}

	searchSessions(query: string): ReturnType<SessionStore["searchSessions"]> {
		return this.store.searchSessions(query);
	}

	cancel(reason: string = "interrupt"): void {
		this.activeRunAbortController?.abort(reason);
	}

	setMode(mode: AgentMode): void {
		this.state.mode = mode;
		this.emitAction({ type: "mode_changed", mode });
	}

	clearSession(): void {
		this.state.sessionId = randomUUID();
		this.state.mode = "execute";
		this.state.conversationMessages = [];
		this.state.compactedContext = undefined;
		this.state.contextBudget = createInitialContextBudget(this.state.contextBudget.config);
		this.state.titleGenerated = false;
		this.emitAction({ type: "transcript_cleared" });
		this.emitAction({ type: "system_message_added", content: "New session started." });
	}

	async resumeSession(sessionId: string): Promise<void> {
		const messages = this.store.loadSession(sessionId);
		this.state.sessionId = sessionId;
		this.state.conversationMessages = messages;
		this.state.compactedContext = undefined;
		this.state.contextBudget = updateEstimatedContextTokens(
			createInitialContextBudget(this.state.contextBudget.config),
			messages,
		);
		this.state.titleGenerated = true;
		this.emitAction({ type: "session_resumed", messages, sessionId });
	}

	async compactConversation(): Promise<void> {
		if (this.state.isCompacting) {
			return;
		}

		if (this.state.conversationMessages.length === 0) {
			this.emitAction({ type: "system_message_added", content: "Nothing to compact yet" });
			return;
		}

		this.state.isCompacting = true;
		this.emitAction({ type: "system_message_added", content: "Compacting context..." });

		try {
			const compactedContext = await compactConversationWithSummary(
				this.createClient(),
				this.state.conversationMessages,
				this.state.contextBudget,
			);

			this.state.compactedContext = compactedContext;
			this.state.conversationMessages = buildConversationFromCompactedContext(compactedContext);
			this.state.contextBudget = updateEstimatedContextTokens(
				this.state.contextBudget,
				this.state.conversationMessages,
			);
			this.emitAction({
				type: "conversation_compacted",
				compactedContext,
				systemMessage: formatCompactionSystemMessage(compactedContext, this.state.contextBudget),
			});
		} finally {
			this.state.isCompacting = false;
		}
	}

	async submitPrompt(
		rawPrompt: string,
		requestPermission?: PermissionRequestHandler,
		requestPlanApproval?: PlanApprovalHandler,
	): Promise<void> {
		const prompt = rawPrompt.trim();
		if (!prompt || this.state.isRunning || this.state.isCompacting) {
			return;
		}

		const { compactedContext, conversationForRun, systemMessage } = await maybeCompactConversation({
			client: this.createClient(),
			conversationMessages: this.state.conversationMessages,
			contextBudget: this.state.contextBudget,
		});

		if (compactedContext && systemMessage) {
			this.state.compactedContext = compactedContext;
			this.state.conversationMessages = conversationForRun;
			this.state.contextBudget = updateEstimatedContextTokens(
				this.state.contextBudget,
				this.state.conversationMessages,
			);
			this.emitAction({
				type: "conversation_compacted",
				compactedContext,
				systemMessage,
			});
		}

		const transcriptMessages: Message[] = [
			...this.state.conversationMessages,
			{ role: "user", content: prompt },
		];

		this.state.conversationMessages = transcriptMessages;
		this.state.contextBudget = updateEstimatedContextTokens(this.state.contextBudget, transcriptMessages);
		this.emitAction({ type: "prompt_submitted", prompt });
		this.store.append(this.state.sessionId, { type: "user", content: prompt });
		this.store.appendHistory(prompt);

		await this.startRun(prompt, transcriptMessages, this.state.mode, requestPermission, requestPlanApproval);
	}

	private emitAction(action: SessionAction): void {
		this.events.emit({ type: "action", action });
	}

	private async generateTitle(userPrompt: string, assistantReply: string): Promise<void> {
		try {
			const titleClient = this.createClient();
			const step = await titleClient.next({
				messages: [
					{
						role: "system",
						content:
							"Generate a short title (max 6 words) for this conversation. Reply with ONLY the title, no quotes, no punctuation at the end.",
					},
					{ role: "user", content: userPrompt },
					{ role: "assistant", content: assistantReply },
					{ role: "user", content: "Title:" },
				],
				tools: [],
			});

			if (step.type === "message") {
				this.store.setTitle(this.state.sessionId, step.message.content.trim().slice(0, 60));
			}
		} catch {
			// Best effort only.
		}
	}

	private async startRun(
		prompt: string,
		transcriptMessages: Message[],
		mode: AgentMode,
		requestPermission?: PermissionRequestHandler,
		requestPlanApproval?: PlanApprovalHandler,
	): Promise<void> {
		this.state.isRunning = true;
		this.emitAction({ type: "run_started" });

		const abortController = new AbortController();
		this.activeRunAbortController = abortController;

		try {
			const message = await runAgent(
				this.client,
				transcriptMessages,
				{
					cwd: this.cwd,
					toolPolicyMode: "full",
					signal: abortController.signal,
					mode,
					sessionId: this.state.sessionId,
				},
				(event) => {
					if (event.type === "tool_requested") {
						this.store.append(this.state.sessionId, {
							type: "tool_call",
							name: event.toolName,
							args: event.args,
						});
					}

					if (event.type === "tool_finished") {
						this.store.append(this.state.sessionId, {
							type: "tool_result",
							name: event.toolName,
							content: event.preview,
						});
					}

					if (event.type === "plan_mode_entered") {
						this.state.mode = "plan";
					}

					if (event.type === "plan_mode_exited") {
						this.state.mode = "execute";
					}

					this.emitAction({ type: "agent_event", event });
				},
				requestPermission as
					| ((params: {
							toolName: string;
							accessLevel: "read" | "write";
							args: Record<string, unknown>;
							preview?: string;
					  }) => Promise<PermissionDecision>)
					| undefined,
				requestPlanApproval as
					| ((params: { filePath: string; content: string }) => Promise<PlanApprovalDecision>)
					| undefined,
			);

			this.state.conversationMessages = [
				...this.state.conversationMessages,
				{ role: "assistant", content: message.content },
			];
			this.state.contextBudget = updateEstimatedContextTokens(
				this.state.contextBudget,
				this.state.conversationMessages,
			);
			this.emitAction({ type: "assistant_message_added", content: message.content });
			this.store.append(this.state.sessionId, { type: "assistant", content: message.content });
			this.emitAction({ type: "run_completed" });

			if (!this.state.titleGenerated) {
				this.state.titleGenerated = true;
				void this.generateTitle(prompt, message.content);
			}

			const pending = drainNotifications();
			if (pending.length > 0) {
				const notificationText = pending.map(formatNotification).join("\n\n---\n\n");
				this.emitAction({
					type: "system_message_added",
					content: `${pending.length} background agent(s) completed — processing results...`,
				});
				await this.startRun(
					notificationText,
					[
						...this.state.conversationMessages,
						{ role: "user", content: notificationText },
					],
					this.state.mode,
					requestPermission,
					requestPlanApproval,
				);
			}
		} catch (error) {
			if (abortController.signal.aborted) {
				this.emitAction({ type: "run_cancelled" });
			} else {
				this.emitAction({
					type: "run_failed",
					error: error instanceof Error ? error.message : String(error),
				});
			}
		} finally {
			this.state.isRunning = false;
			if (this.activeRunAbortController === abortController) {
				this.activeRunAbortController = null;
			}
		}
	}
}
