import { type ModelClient } from "../llm/client";
import { type Message } from "../types";
import {
    estimateMessagesTokens,
    type ContextBudgetState,
} from "./contextBudget";

export const DEFAULT_MESSAGES_TO_KEEP = 8;

export type CompactedContextState = {
    /**
     * Human-readable note for the transcript / debug UI.
     */
    boundaryLabel: string;
    /**
     * Summary of the older part of the conversation.
     *
     * In a later version, this should come from a dedicated summarizer/model call.
     * For now we build a deterministic placeholder so the runtime plumbing exists.
     */
    summary: string;
    /**
     * Recent messages we keep verbatim after compaction.
     */
    preservedMessages: Message[];
    originalMessageCount: number;
    estimatedTokensBefore: number;
    estimatedTokensAfter: number;
};

export type CompactConversationOptions = {
    keepLastMessages?: number;
};

function formatMessageForSummary(message: Message): string {
    const prefix = message.role === "user" ? "User" : "Assistant";
    const content = message.content.length > 160
        ? `${message.content.slice(0, 157)}...`
        : message.content;
    return `- ${prefix}: ${content}`;
}

/**
 * Extremely small first-pass summary builder.
 *
 * This is intentionally deterministic and cheap. The goal of the scaffold is
 * to teach the data flow first:
 * old messages -> summary artifact -> preserved tail
 *
 * Later, replace this with a real compaction model call.
 */
function buildNaiveSummary(messagesToCompact: Message[]): string {
    if (messagesToCompact.length === 0) {
        return "No older messages needed compaction.";
    }

    const summaryLines = messagesToCompact.map(formatMessageForSummary);
    return [
        "Compacted conversation summary:",
        ...summaryLines,
    ].join("\n");
}

function buildCompactionPrompt(messagesToCompact: Message[]): Message[] {
    const transcript = messagesToCompact
        .map((message, index) => {
            const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System";
            return `[${index + 1}] ${role}\n${message.content}`;
        })
        .join("\n\n");

    return [
        {
            role: "system",
            content: [
                "You are creating a compaction summary for a coding-agent session.",
                "Your job is to preserve the information a future model turn will need in order to continue the work without re-reading the full conversation.",
                "",
                "Write a plain-text summary with these exact sections:",
                "1. Primary Request and Intent",
                "2. Key Technical Concepts",
                "3. Files and Code Sections",
                "4. Errors and Fixes",
                "5. Pending Tasks",
                "6. Current Work",
                "7. Next Step",
                "",
                "Requirements:",
                "- Focus on concrete technical continuity, not chatty prose.",
                "- Include file paths when they matter.",
                "- Include specific decisions, constraints, and user preferences.",
                "- Include bugs or dead ends and how they were resolved.",
                "- In 'Current Work', describe exactly what was happening most recently.",
                "- In 'Next Step', name the most natural immediate continuation.",
                "- If code snippets are essential, include short snippets only.",
                "- Output plain text only. Do not call tools.",
                "",
                "This prompt is inspired by Claude Code's compaction style, but intentionally smaller for minicode.",
            ].join("\n"),
        },
        {
            role: "user",
            content: [
                "Summarize this older conversation slice for future continuation.",
                "Assume newer messages will remain verbatim after your summary, so your job is to preserve the older technical context clearly and compactly.",
                transcript || "(empty transcript)",
            ].join("\n\n"),
        },
    ];
}

/**
 * First real compaction hook.
 *
 * We use a dedicated client call with no tools so compaction behaves like a
 * summarizer, not like the normal tool-using loop.
 *
 * Important: callers should prefer a fresh client instance for compaction so
 * they do not interfere with the main conversation's provider-specific state
 * (for example OpenAI previous_response_id tool loops).
 */
export async function summarizeMessagesForCompaction(
    client: ModelClient,
    messagesToCompact: Message[],
    signal?: AbortSignal,
): Promise<string> {
    if (messagesToCompact.length === 0) {
        return buildNaiveSummary(messagesToCompact);
    }

    const step = await client.next({
        messages: buildCompactionPrompt(messagesToCompact),
        tools: [],
        signal,
    });

    if (step.type === "message") {
        const summary = step.message.content.trim();
        if (
            summary
            && !summary.startsWith("No supported tools are available in the current stub setup.")
        ) {
            return summary;
        }
    }

    return buildNaiveSummary(messagesToCompact);
}

/**
 * Build a compacted view of the conversation.
 *
 * This does NOT mutate the transcript.
 * It creates a model-facing artifact that can be used for future turns.
 */
export function compactConversation(
    messages: Message[],
    budget: ContextBudgetState,
    options: CompactConversationOptions = {},
): CompactedContextState {
    const keepLastMessages = options.keepLastMessages ?? DEFAULT_MESSAGES_TO_KEEP;
    const splitIndex = Math.max(0, messages.length - keepLastMessages);
    const messagesToCompact = messages.slice(0, splitIndex);
    const preservedMessages = messages.slice(splitIndex);
    const summary = buildNaiveSummary(messagesToCompact);

    const estimatedTokensBefore = estimateMessagesTokens(messages);
    const estimatedTokensAfter = estimateMessagesTokens([
        {
            role: "system",
            content: summary,
        },
        ...preservedMessages,
    ]);

    return {
        boundaryLabel: `Conversation compacted · kept ${preservedMessages.length} recent messages`,
        summary,
        preservedMessages,
        originalMessageCount: messages.length,
        estimatedTokensBefore,
        estimatedTokensAfter,
    };
}

export async function compactConversationWithSummary(
    client: ModelClient,
    messages: Message[],
    budget: ContextBudgetState,
    options: CompactConversationOptions & { signal?: AbortSignal } = {},
): Promise<CompactedContextState> {
    const keepLastMessages = options.keepLastMessages ?? DEFAULT_MESSAGES_TO_KEEP;
    const splitIndex = Math.max(0, messages.length - keepLastMessages);
    const messagesToCompact = messages.slice(0, splitIndex);
    const preservedMessages = messages.slice(splitIndex);
    const summary = await summarizeMessagesForCompaction(
        client,
        messagesToCompact,
        options.signal,
    );

    const estimatedTokensBefore = estimateMessagesTokens(messages);
    const estimatedTokensAfter = estimateMessagesTokens([
        {
            role: "system",
            content: summary,
        },
        ...preservedMessages,
    ]);

    return {
        boundaryLabel: `Conversation compacted · kept ${preservedMessages.length} recent messages`,
        summary,
        preservedMessages,
        originalMessageCount: messages.length,
        estimatedTokensBefore,
        estimatedTokensAfter,
    };
}

/**
 * Build the message array for the next model turn.
 *
 * If no compaction has happened yet, the caller should just use the normal
 * conversation history. If compaction exists, prepend the compacted summary
 * and keep only the preserved tail verbatim.
 */
export function buildConversationFromCompactedContext(
    compacted: CompactedContextState,
): Message[] {
    return [
        {
            role: "system",
            content: compacted.summary,
        },
        ...compacted.preservedMessages,
    ];
}

export function formatCompactionSystemMessage(
    compacted: CompactedContextState,
    budget: ContextBudgetState,
): string {
    const savedTokens = Math.max(0, compacted.estimatedTokensBefore - compacted.estimatedTokensAfter);

    return [
        compacted.boundaryLabel,
        `Estimated context: ${compacted.estimatedTokensBefore} -> ${compacted.estimatedTokensAfter} tokens`,
        `Saved ~${savedTokens} estimated tokens`,
        `Current auto-compact threshold: ${Math.floor(budget.config.contextWindowTokens * budget.config.autoCompactThresholdPct)} tokens`,
    ].join("\n");
}
