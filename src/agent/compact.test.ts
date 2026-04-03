import { describe, expect, test } from "bun:test";
import {
    buildConversationFromCompactedContext,
    compactConversation,
    compactConversationWithSummary,
    formatCompactionSystemMessage,
} from "./compact";
import { createInitialContextBudget } from "./contextBudget";
import { type ModelClient } from "../llm/client";
import { type AgentStep, type Message } from "../types";

function user(content: string): Message {
    return { role: "user", content };
}

function assistant(content: string): Message {
    return { role: "assistant", content };
}

class SummaryClient implements ModelClient {
    constructor(private readonly step: AgentStep) {}

    hasPendingToolCalls(): boolean {
        return false;
    }

    async next(): Promise<AgentStep> {
        return this.step;
    }
}

describe("compactConversation", () => {
    test("keeps a recent tail and summarizes older messages", () => {
        const budget = createInitialContextBudget({ contextWindowTokens: 1000 });
        const messages: Message[] = [
            user("first request"),
            assistant("first answer"),
            user("second request"),
            assistant("second answer"),
            user("third request"),
        ];

        const compacted = compactConversation(messages, budget, {
            keepLastMessages: 2,
        });

        expect(compacted.originalMessageCount).toBe(5);
        expect(compacted.preservedMessages).toHaveLength(2);
        expect(compacted.preservedMessages[0]?.content).toBe("second answer");
        expect(compacted.summary).toContain("Compacted conversation summary:");
        expect(compacted.estimatedTokensAfter).toBeLessThan(compacted.estimatedTokensBefore);
    });

    test("rebuilds model-facing conversation from compacted state", () => {
        const conversation = buildConversationFromCompactedContext({
            boundaryLabel: "Conversation compacted",
            summary: "Older work summary",
            preservedMessages: [
                user("recent user turn"),
                assistant("recent assistant turn"),
            ],
            originalMessageCount: 4,
            estimatedTokensBefore: 100,
            estimatedTokensAfter: 60,
        });

        expect(conversation).toEqual([
            { role: "system", content: "Older work summary" },
            { role: "user", content: "recent user turn" },
            { role: "assistant", content: "recent assistant turn" },
        ]);
    });

    test("formats a readable compaction status message", () => {
        const budget = createInitialContextBudget({
            contextWindowTokens: 200,
            autoCompactThresholdPct: 0.75,
        });

        const message = formatCompactionSystemMessage(
            {
                boundaryLabel: "Conversation compacted",
                summary: "summary",
                preservedMessages: [],
                originalMessageCount: 10,
                estimatedTokensBefore: 150,
                estimatedTokensAfter: 90,
            },
            budget,
        );

        expect(message).toContain("Conversation compacted");
        expect(message).toContain("150 -> 90");
        expect(message).toContain("Current auto-compact threshold: 150 tokens");
    });
});

describe("compactConversationWithSummary", () => {
    test("uses a model-generated summary when the client returns a message", async () => {
        const budget = createInitialContextBudget({ contextWindowTokens: 1000 });
        const client = new SummaryClient({
            type: "message",
            message: {
                role: "assistant",
                content: [
                    "1. Primary Request and Intent",
                    "Fix the parser bug",
                    "",
                    "7. Next Step",
                    "Patch the parser",
                ].join("\n"),
            },
        });

        const compacted = await compactConversationWithSummary(
            client,
            [
                user("find a parser bug"),
                assistant("I found one in parser.ts"),
                user("fix it"),
                assistant("working"),
            ],
            budget,
            { keepLastMessages: 1 },
        );

        expect(compacted.summary).toContain("Primary Request and Intent");
        expect(compacted.preservedMessages).toHaveLength(1);
    });

    test("falls back to a naive summary when the client does not return a useful compaction message", async () => {
        const budget = createInitialContextBudget({ contextWindowTokens: 1000 });
        const client = new SummaryClient({
            type: "message",
            message: {
                role: "assistant",
                content: "No supported tools are available in the current stub setup.",
            },
        });

        const compacted = await compactConversationWithSummary(
            client,
            [
                user("first"),
                assistant("second"),
                user("third"),
            ],
            budget,
            { keepLastMessages: 1 },
        );

        expect(compacted.summary).toContain("Compacted conversation summary:");
    });
});
