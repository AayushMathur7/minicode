import { type CompactedContextState } from "../agent/compact";
import { type ContextBudgetState } from "../agent/contextBudget";
import { type PermissionDecision } from "../tools/permissions";
import { type AgentMode } from "../tools/policy";
import { type AgentEvent, type Message, type PlanApprovalDecision, type ToolAccessLevel } from "../types";

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
	| { type: "session_resumed"; messages: Message[]; sessionId: string }
	| { type: "run_started" }
	| { type: "run_completed" }
	| { type: "run_cancelled" }
	| { type: "run_failed"; error: string };

export type AgentSessionEvent = {
	type: "action";
	action: SessionAction;
};

export type PermissionRequestHandler = (params: {
	toolName: string;
	accessLevel: ToolAccessLevel;
	args: Record<string, unknown>;
	preview?: string;
}) => Promise<PermissionDecision>;

export type PlanApprovalHandler = (params: {
	filePath: string;
	content: string;
}) => Promise<PlanApprovalDecision>;
