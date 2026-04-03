import { type Message } from "../types";

/**
 * Context budgeting in `minicode` is intentionally simple.
 *
 * We keep two kinds of numbers:
 * 1. API-reported usage from the *last* model call
 * 2. a rough estimate for the *next* model call
 *
 * The second number is what should drive compaction decisions.
 * The first number is still useful as telemetry and calibration.
 */

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_WARNING_THRESHOLD_PCT = 0.65;
export const DEFAULT_AUTO_COMPACT_THRESHOLD_PCT = 0.8;

export type TokenUsageSnapshot = {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
};

export type ContextBudgetConfig = {
    contextWindowTokens: number;
    warningThresholdPct: number;
    autoCompactThresholdPct: number;
};

export type ContextBudgetState = {
    config: ContextBudgetConfig;
    /**
     * Estimate of the full message array that would be sent on the next turn.
     * This is intentionally rough for now.
     */
    estimatedContextTokens: number;
    /**
     * Last provider-reported token usage snapshot.
     * Good for UI/debugging, but not enough on its own to make compact decisions.
     */
    lastUsage?: TokenUsageSnapshot;
};

export function createDefaultContextBudgetConfig(): ContextBudgetConfig {
    return {
        contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        warningThresholdPct: DEFAULT_WARNING_THRESHOLD_PCT,
        autoCompactThresholdPct: DEFAULT_AUTO_COMPACT_THRESHOLD_PCT,
    };
}

export function createInitialContextBudget(
    config: Partial<ContextBudgetConfig> = {},
): ContextBudgetState {
    return {
        config: {
            ...createDefaultContextBudgetConfig(),
            ...config,
        },
        estimatedContextTokens: 0,
        lastUsage: undefined,
    };
}

/**
 * Very rough token estimator.
 *
 * This is good enough for a first compaction trigger because we only need a
 * "large enough to worry about" signal, not billing-accurate numbers.
 *
 * Later improvements you can make:
 * - count tool schemas too
 * - count the system prompt separately
 * - switch to a real tokenizer
 */
export function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((sum, message) => {
        const roleOverhead = 8;
        const nameOverhead = message.name ? estimateTextTokens(message.name) : 0;
        return sum + roleOverhead + nameOverhead + estimateTextTokens(message.content);
    }, 0);
}

export function updateEstimatedContextTokens(
    budget: ContextBudgetState,
    messages: Message[],
): ContextBudgetState {
    return {
        ...budget,
        estimatedContextTokens: estimateMessagesTokens(messages),
    };
}

export function recordModelUsage(
    budget: ContextBudgetState,
    usage: TokenUsageSnapshot,
): ContextBudgetState {
    return {
        ...budget,
        lastUsage: usage,
    };
}

export function getWarningThresholdTokens(config: ContextBudgetConfig): number {
    return Math.floor(config.contextWindowTokens * config.warningThresholdPct);
}

export function getAutoCompactThresholdTokens(config: ContextBudgetConfig): number {
    return Math.floor(config.contextWindowTokens * config.autoCompactThresholdPct);
}

export function shouldWarnAboutContext(budget: ContextBudgetState): boolean {
    return budget.estimatedContextTokens >= getWarningThresholdTokens(budget.config);
}

export function shouldAutoCompact(budget: ContextBudgetState): boolean {
    return budget.estimatedContextTokens >= getAutoCompactThresholdTokens(budget.config);
}

