import { type Message } from "../types";
import { SYSTEM_PROMPT } from "../agent/systemPrompt";

export function buildMessages(userMessages: Message[]): Message[] {
    return [
        { role: "system", content: SYSTEM_PROMPT },
        ...userMessages,
    ];
}
