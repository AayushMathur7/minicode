import { type AgentStep, type Message, type ToolMetadata } from "../types";

export type ClientInput = {
    // The runtime sends the full conversation history each turn.
    // The model has no memory unless you pass it in here.
    messages: Message[];
    tools: ToolMetadata[];
    signal?: AbortSignal;
};

export interface ModelClient {
    next(input: ClientInput): Promise<AgentStep>;
}

export { StubClient } from "./stub";
export { OpenAIClient } from "./openai";
