import { type AgentStep, type Message, type ToolMetadata } from "../types";

export type ModelStreamEvent =
| { type: "thinking_started" }
| { type: "thinking_completed" }
| { type: "reasoning_summary_delta"; chunk: string }
| { type: "reasoning_summary_completed"; content: string }
| { type: "assistant_text_started" }
| { type: "assistant_text_delta"; chunk: string }
| { type: "assistant_text_completed"; content: string }
| { type: "tool_call_detected"; toolName: string };

export type ModelUsageEvent = {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
};

export interface ModelClient {
    next(input: ClientInput): Promise<AgentStep>;

    /**
     * Returns true if the client has buffered tool calls from a previous
     * multi-tool response that haven't been returned yet.
     *
     * Used by the agent loop to collect a full batch of tool calls before
     * executing them — enabling read/write partitioned concurrency.
     */
    hasPendingToolCalls(): boolean;
}

export type ClientInput = {
    // The runtime sends the full conversation history each turn.
    // The model has no memory unless you pass it in here.
    messages: Message[];
    tools: ToolMetadata[];
    signal?: AbortSignal;
    onStreamEvent?: (event: ModelStreamEvent) => void;
    /**
     * Provider-reported usage for the completed request.
     *
     * This is useful for telemetry and later compaction heuristics, but note that
     * the *next* request size still needs its own estimate.
     */
    onUsage?: (usage: ModelUsageEvent) => void;
};

export { StubClient } from "./stub";
export { OpenAIClient } from "./openai";
