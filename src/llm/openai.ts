import OpenAI from "openai";
import type {
    FunctionTool,
    Response,
    ResponseFunctionToolCall,
    ResponseInputItem,
} from "openai/resources/responses/responses";
import { type AgentStep, type Message, type ToolMetadata } from "../types";
import { type ClientInput, type ModelClient } from "./client";

function mapMessageToResponseInput(message: Message): ResponseInputItem {
    // We already build a system message in the runtime, so we replay it directly
    // as part of the Responses API input instead of using `instructions`.
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
        // The simple runtime currently only stores assistant text, not full
        // provider-native output items. Replaying it as a developer message keeps
        // the context visible to the model without requiring provider-specific
        // message history types in the runtime.
        return {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: `Previous assistant message:\n${message.content}` }],
        };
    }

    // The runtime also stores tool results as generic messages. Because we do not
    // yet persist provider-native `call_id`s, we replay tool outputs as developer
    // context rather than `function_call_output` items. This keeps the provider
    // adapter compatible with the current internal message model.
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

function parseAssistantMessage(response: Response): AgentStep {
    const content = response.output_text.trim();

    return {
        type: "message",
        message: {
            role: "assistant",
            content: content || "I do not have a final answer yet.",
        },
    };
}

export class OpenAIClient implements ModelClient {
    private readonly client: OpenAI;
    private previousResponseId?: string;
    private pendingFunctionCall?: {
        callId: string;
        toolName: string;
    };

    constructor(private readonly apiKey: string) {
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is required to use OpenAIClient");
        }

        this.client = new OpenAI({ apiKey });
    }

    async next(input: ClientInput): Promise<AgentStep> {
        const latestMessage = input.messages[input.messages.length - 1];
        const isContinuingToolLoop =
            this.previousResponseId !== undefined &&
            this.pendingFunctionCall !== undefined &&
            latestMessage?.role === "tool" &&
            latestMessage.name === this.pendingFunctionCall.toolName;
        const functionCallOutput = isContinuingToolLoop
            ? [
                {
                    type: "function_call_output",
                    call_id: this.pendingFunctionCall!.callId,
                    output: latestMessage!.content,
                } as ResponseInputItem,
            ]
            : undefined;

        const response = await this.client.responses.create({
            model: "gpt-5",
            reasoning: { effort: "high" },
            text: { verbosity: "medium" },
            stream: false,
            // We use previous_response_id for native tool-call continuity, so the
            // response needs to remain available to the Responses API between turns.
            store: true,
            // The runtime owns the canonical message history. This adapter only maps
            // that history into the provider-specific input format.
            input: functionCallOutput ?? input.messages.map(mapMessageToResponseInput),
            // We expose the runtime's tool metadata through OpenAI's native function
            // tool declarations. The model chooses a tool, but the runtime executes it.
            tools: input.tools.map(mapToolToOpenAIFunction),
            tool_choice: "auto",
            previous_response_id: isContinuingToolLoop ? this.previousResponseId : undefined,
        }) as Response;

        this.previousResponseId = response.id;

        const functionCall = response.output.find(
            (item): item is ResponseFunctionToolCall => item.type === "function_call",
        );

        if (functionCall) {
            this.pendingFunctionCall = {
                callId: functionCall.call_id,
                toolName: functionCall.name,
            };
            return parseFunctionToolCall(functionCall);
        }

        this.pendingFunctionCall = undefined;

        return parseAssistantMessage(response);
    }
}
