import { describe, expect, test } from "bun:test";
import {
    createInitialContextBudget,
    estimateMessagesTokens,
    estimateTextTokens,
    getAutoCompactThresholdTokens,
    getWarningThresholdTokens,
    recordModelUsage,
    shouldAutoCompact,
    shouldWarnAboutContext,
    updateEstimatedContextTokens,
} from "./contextBudget";
import { type Message } from "../types";

function message(role: Message["role"], content: string): Message {
    return { role, content };
}

describe("contextBudget", () => {
    test("estimates text tokens with a simple length heuristic", () => {
        expect(estimateTextTokens("")).toBe(0);
        expect(estimateTextTokens("abcd")).toBe(1);
        expect(estimateTextTokens("abcdefgh")).toBe(2);
    });

    test("estimates message tokens including small per-message overhead", () => {
        const messages: Message[] = [
            message("user", "hello there"),
            message("assistant", "working on it"),
        ];

        expect(estimateMessagesTokens(messages)).toBeGreaterThan(estimateTextTokens("hello thereworking on it"));
    });

    test("tracks estimated context size and provider usage separately", () => {
        let budget = createInitialContextBudget({
            contextWindowTokens: 100,
            warningThresholdPct: 0.5,
            autoCompactThresholdPct: 0.8,
        });

        budget = updateEstimatedContextTokens(budget, [
            message("user", "a".repeat(120)),
        ]);

        expect(budget.estimatedContextTokens).toBeGreaterThan(0);
        expect(budget.lastUsage).toBeUndefined();

        budget = recordModelUsage(budget, {
            model: "gpt-test",
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
        });

        expect(budget.lastUsage?.totalTokens).toBe(20);
        expect(budget.estimatedContextTokens).toBeGreaterThan(0);
    });

    test("computes warning and auto-compact thresholds from config", () => {
        const budget = createInitialContextBudget({
            contextWindowTokens: 200,
            warningThresholdPct: 0.65,
            autoCompactThresholdPct: 0.8,
        });

        expect(getWarningThresholdTokens(budget.config)).toBe(130);
        expect(getAutoCompactThresholdTokens(budget.config)).toBe(160);
    });

    test("detects warning and auto-compact states based on estimated context", () => {
        let budget = createInitialContextBudget({
            contextWindowTokens: 100,
            warningThresholdPct: 0.4,
            autoCompactThresholdPct: 0.6,
        });

        budget = updateEstimatedContextTokens(budget, [
            message("user", "a".repeat(140)),
        ]);

        expect(shouldWarnAboutContext(budget)).toBe(true);
        expect(shouldAutoCompact(budget)).toBe(false);

        budget = updateEstimatedContextTokens(budget, [
            message("user", "a".repeat(220)),
        ]);

        expect(shouldAutoCompact(budget)).toBe(true);
    });
});
