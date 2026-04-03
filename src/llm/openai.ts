import OpenAI from "openai";
import type {
    FunctionTool,
    ResponseFunctionToolCall,
    ResponseInputItem,
    ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { type AgentStep, type Message, type ToolCall, type ToolMetadata } from "../types";
import { type ClientInput, type ModelClient, type ModelStreamEvent, type ModelUsageEvent } from "./client";

type StreamedOpenAIResult = {
    responseId: string;
    text: string;
    functionCalls: ResponseFunctionToolCall[];
    usage?: ModelUsageEvent;
};

type PendingToolLoopState = {
    expectedPendingCall?: ToolCall;
    isContinuingToolLoop: boolean;
};

const MAX_RETRIES = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

function isGpt5Model(model: string): boolean {
    return /^gpt-5([.-]|$)/.test(model);
}

function buildModelOptions(model: string): Record<string, unknown> {
    if (!isGpt5Model(model)) {
        return {};
    }

    return {
        reasoning: { effort: "medium" },
        text: { verbosity: "low" },
    };
}

/**
 * Convert the runtime's generic `Message[]` into Responses API input items.
 *
 * Important limitation:
 * The runtime currently stores assistant/tool history in a provider-agnostic
 * format. That means we replay older assistant/tool turns as developer context
 * instead of native OpenAI output items. The only provider-native continuity we
 * preserve is the current tool loop via `previous_response_id` and
 * `function_call_output`.
 */
function mapMessageToResponseInput(message: Message): ResponseInputItem {
    if (message.role === "system") {
        return {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: message.content }],
        };
    }

    if (message.role === "user") {
        return {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: message.content }],
        };
    }

    if (message.role === "assistant") {
        return {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: `Previous assistant message:\n${message.content}` }],
        };
    }

    return {
        type: "message",
        role: "developer",
        content: [
            {
                type: "input_text",
                text: `Tool ${message.name ?? "unknown_tool"} output:\n${message.content}`,
            },
        ],
    };
}

function mapToolToOpenAIFunction(tool: ToolMetadata): FunctionTool {
    return {
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        strict: true,
    };
}

function parseFunctionToolCall(toolCall: ResponseFunctionToolCall): AgentStep {
    let args: Record<string, unknown>;

    try {
        args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
    } catch (error) {
        throw new Error(
            `OpenAI returned invalid JSON arguments for tool ${toolCall.name}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }

    return {
        type: "tool_call",
        call: {
            toolName: toolCall.name,
            args,
            callId: toolCall.call_id,
        },
    };
}

function buildFunctionCallOutputItem(
    callId: string,
    output: string,
): ResponseInputItem {
    return {
        type: "function_call_output",
        call_id: callId,
        output,
    } as ResponseInputItem;
}

/**
 * Small helper around streamed progress events so the rest of the adapter reads
 * like a state machine instead of a pile of booleans.
 */
class StreamProgressEmitter {
    private thinkingActive = false;
    private assistantTextStarted = false;
    private reasoningSummary = "";

    constructor(
        private readonly emit?: (event: ModelStreamEvent) => void,
    ) {}

    startThinking(): void {
        if (this.thinkingActive) {
            return;
        }

        this.emit?.({ type: "thinking_started" });
        this.thinkingActive = true;
    }

    finishThinking(): void {
        if (!this.thinkingActive) {
            return;
        }

        this.emit?.({ type: "thinking_completed" });
        this.thinkingActive = false;
    }

    startAssistantText(): void {
        this.finishThinking();

        if (this.assistantTextStarted) {
            return;
        }

        this.emit?.({ type: "assistant_text_started" });
        this.assistantTextStarted = true;
    }

    appendAssistantText(chunk: string): void {
        this.startAssistantText();
        this.emit?.({ type: "assistant_text_delta", chunk });
    }

    appendReasoningSummary(chunk: string): void {
        this.reasoningSummary += chunk;
        this.emit?.({ type: "reasoning_summary_delta", chunk });
    }

    completeAssistantText(content: string): void {
        if (!this.assistantTextStarted) {
            return;
        }

        this.emit?.({ type: "assistant_text_completed", content });
    }

    completeReasoningSummary(): void {
        const content = this.reasoningSummary.trim();

        if (!content) {
            return;
        }

        this.emit?.({ type: "reasoning_summary_completed", content });
    }

    detectToolCall(toolName: string): void {
        this.finishThinking();
        this.emit?.({ type: "tool_call_detected", toolName });
    }
}

export class OpenAIClient implements ModelClient {
    private readonly client: OpenAI;
    private readonly model: string;
    private previousResponseId?: string;
    private pendingFunctionCalls: AgentStep[] = [];
    private pendingFunctionOutputs: ResponseInputItem[] = [];

    constructor(private readonly apiKey: string) {
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is required to use OpenAIClient");
        }

        this.model = process.env.OPENAI_MODEL || "gpt-5-nano-2025-08-07";
        this.client = new OpenAI({ apiKey });
    }

    /**
     * Figure out whether the latest runtime message is a tool result that should
     * be fed back into the active OpenAI tool loop using `function_call_output`.
     */
    private getPendingToolLoopState(input: ClientInput): PendingToolLoopState {
        const latestMessage = input.messages[input.messages.length - 1];
        const expectedPendingCall =
            this.pendingFunctionCalls.length > 0 && this.pendingFunctionCalls[0]?.type === "tool_call"
                ? this.pendingFunctionCalls[0].call
                : undefined;

        const isContinuingToolLoop =
            this.previousResponseId !== undefined &&
            expectedPendingCall !== undefined &&
            latestMessage?.role === "tool" &&
            latestMessage.name === expectedPendingCall.toolName;

        return {
            expectedPendingCall,
            isContinuingToolLoop,
        };
    }

    /**
     * When OpenAI previously returned multiple function calls in one turn, we
     * execute them one at a time in the runtime but have to send *all* matching
     * `function_call_output` items back before asking the model to think again.
     */
    private consumeLatestToolOutput(
        input: ClientInput,
        pendingState: PendingToolLoopState,
    ): AgentStep | undefined {
        if (!pendingState.isContinuingToolLoop || !pendingState.expectedPendingCall) {
            return undefined;
        }

        const latestToolMessage = input.messages[input.messages.length - 1];

        this.pendingFunctionOutputs.push(
            buildFunctionCallOutputItem(
                pendingState.expectedPendingCall.callId!,
                latestToolMessage!.content,
            ),
        );
        this.pendingFunctionCalls.shift();

        if (this.pendingFunctionCalls.length > 0) {
            return this.pendingFunctionCalls[0]!;
        }

        return undefined;
    }

    /**
     * Open a streamed Responses request.
     *
     * Retry policy:
     * - only retry the initial request creation
     * - once a stream starts, do not retry automatically because duplicated
     *   streamed deltas would corrupt the UI and tool loop
     */
    private async streamWithRetry(
        input: ClientInput,
        functionCallOutputs: ResponseInputItem[] | undefined,
        isContinuingToolLoop: boolean,
    ): Promise<AsyncIterable<ResponseStreamEvent>> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.client.responses.create(
                    {
                        model: this.model,
                        ...buildModelOptions(this.model),
                        stream: true,
                        store: true,
                        input: functionCallOutputs ?? input.messages.map(mapMessageToResponseInput),
                        tools: input.tools.map(mapToolToOpenAIFunction),
                        tool_choice: "auto",
                        previous_response_id: isContinuingToolLoop ? this.previousResponseId : undefined,
                    },
                    { signal: input.signal },
                ) as AsyncIterable<ResponseStreamEvent>;
            } catch (error: unknown) {
                const status = (error as { status?: number }).status;

                if (!RETRYABLE_STATUS_CODES.has(status ?? -1) || attempt >= MAX_RETRIES) {
                    throw error;
                }

                const delayMs = Math.min(1000 * 2 ** attempt, 8000);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    /**
     * Consume the provider stream and collapse it into:
     * - one final text buffer
     * - zero or more completed function calls
     * - a response id for future `previous_response_id` continuation
     *
     * The runtime still works in terms of one `AgentStep` at a time, so the
     * adapter is responsible for translating the provider's event stream into one
     * normalized result.
     */
    private async consumeStream(
        stream: AsyncIterable<ResponseStreamEvent>,
        onStreamEvent?: (event: ModelStreamEvent) => void,
    ): Promise<StreamedOpenAIResult> {
        const progress = new StreamProgressEmitter(onStreamEvent);
        let responseId: string | undefined;
        let textBuffer = "";
        let usage: ModelUsageEvent | undefined;
        const functionCallsByIndex = new Map<number, ResponseFunctionToolCall>();

        progress.startThinking();

        for await (const event of stream) {
            switch (event.type) {
                case "response.created":
                    responseId = event.response.id;
                    break;
                case "response.completed": {
                    responseId = event.response.id;
                    const responseUsage = (event.response as {
                        usage?: {
                            input_tokens?: number;
                            output_tokens?: number;
                            total_tokens?: number;
                        };
                    }).usage;

                    if (responseUsage) {
                        usage = {
                            model: this.model,
                            inputTokens: responseUsage.input_tokens,
                            outputTokens: responseUsage.output_tokens,
                            totalTokens: responseUsage.total_tokens,
                        };
                    }
                    break;
                }
                case "response.output_text.delta":
                    textBuffer += event.delta;
                    progress.appendAssistantText(event.delta);
                    break;
                case "response.output_text.done":
                    // Most turns produce deltas, but this preserves correctness if a
                    // tiny response arrives as a finalized chunk only.
                    if (!textBuffer && event.text) {
                        textBuffer = event.text;
                        progress.appendAssistantText(event.text);
                    }
                    break;
                case "response.reasoning_summary_text.delta":
                    progress.appendReasoningSummary(event.delta);
                    break;
                case "response.output_item.done":
                    if (event.item.type === "function_call") {
                        functionCallsByIndex.set(event.output_index, event.item);
                        progress.detectToolCall(event.item.name);
                    }
                    break;
                default:
                    break;
            }
        }

        progress.finishThinking();
        progress.completeReasoningSummary();

        const finalText = textBuffer.trim();
        progress.completeAssistantText(finalText);

        if (!responseId) {
            throw new Error("OpenAI stream ended without a response id");
        }

        return {
            responseId,
            text: finalText,
            functionCalls: [...functionCallsByIndex.entries()]
                .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
                .map(([, functionCall]) => functionCall),
            usage,
        };
    }

    hasPendingToolCalls(): boolean {
        return this.pendingFunctionCalls.length > 0;
    }

    async next(input: ClientInput): Promise<AgentStep> {
        const pendingState = this.getPendingToolLoopState(input);
        const nextPendingToolCall = this.consumeLatestToolOutput(input, pendingState);

        if (nextPendingToolCall) {
            return nextPendingToolCall;
        }

        const stream = await this.streamWithRetry(
            input,
            pendingState.isContinuingToolLoop ? this.pendingFunctionOutputs : undefined,
            pendingState.isContinuingToolLoop,
        );
        const result = await this.consumeStream(stream, input.onStreamEvent);
        if (result.usage) {
            input.onUsage?.(result.usage);
        }

        this.previousResponseId = result.responseId;
        this.pendingFunctionOutputs = [];

        if (result.functionCalls.length > 0) {
            this.pendingFunctionCalls = result.functionCalls.map(parseFunctionToolCall);
            return this.pendingFunctionCalls[0]!;
        }

        this.pendingFunctionCalls = [];

        return {
            type: "message",
            message: {
                role: "assistant",
                content: result.text || "I do not have a final answer yet.",
            },
        };
    }
}
