import {
	buildConversationFromCompactedContext,
	compactConversationWithSummary,
	formatCompactionSystemMessage,
	type CompactedContextState,
} from "../agent/compact";
import {
	shouldAutoCompact,
	updateEstimatedContextTokens,
	type ContextBudgetState,
} from "../agent/contextBudget";
import { type ModelClient } from "../llm/client";
import { type Message } from "../types";

export async function maybeCompactConversation(args: {
	client: ModelClient;
	conversationMessages: Message[];
	contextBudget: ContextBudgetState;
	signal?: AbortSignal;
}): Promise<{
	compactedContext?: CompactedContextState;
	conversationForRun: Message[];
	systemMessage?: string;
}> {
	const projectedBudget = updateEstimatedContextTokens(args.contextBudget, args.conversationMessages);
	if (!shouldAutoCompact(projectedBudget) || args.conversationMessages.length === 0) {
		return { conversationForRun: args.conversationMessages };
	}

	const compactedContext = await compactConversationWithSummary(
		args.client,
		args.conversationMessages,
		args.contextBudget,
		{ signal: args.signal },
	);

	return {
		compactedContext,
		conversationForRun: buildConversationFromCompactedContext(compactedContext),
		systemMessage: formatCompactionSystemMessage(compactedContext, args.contextBudget),
	};
}
