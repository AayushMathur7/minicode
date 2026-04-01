import { type AgentStep } from "../types";
import { type ClientInput, type ModelClient } from "./client";

export class StubClient implements ModelClient {
    async next(input: ClientInput): Promise<AgentStep> {
        if (input.signal?.aborted) {
            throw input.signal.reason instanceof Error
                ? input.signal.reason
                : new Error(String(input.signal.reason ?? "cancelled"));
        }

        const latestToolMessage = [...input.messages]
            .reverse()
            .find((message) => message.role === "tool");
        const latestUserMessage = [...input.messages]
            .reverse()
            .find((message) => message.role === "user");
        const availableToolNames = new Set(input.tools.map((tool) => tool.name));

        if (!latestToolMessage) {
            const prompt = latestUserMessage?.content.toLowerCase() ?? "";
            const normalizedSearchQuery = prompt
                .replace(/^(find|search|where)\s+/i, "")
                .trim();

            if (
                availableToolNames.has("search_code") &&
                normalizedSearchQuery
            ) {
                return {
                    type: "tool_call",
                    call: {
                        toolName: "search_code",
                        args: {
                            query: normalizedSearchQuery,
                        },
                    },
                };
            }

            if (availableToolNames.has("read_file")) {
                return {
                    type: "tool_call",
                    call: {
                        toolName: "read_file",
                        args: {
                            path: "README.md",
                        },
                    },
                };
            }

            return {
                type: "message",
                message: {
                    role: "assistant",
                    content: "No supported tools are available in the current stub setup.",
                },
            };
        }

        return {
            type: "message",
            message: {
                role: "assistant",
                content: `I used ${latestToolMessage.name ?? "a tool"} successfully. Result preview: ${latestToolMessage.content.slice(0, 120)}`,
            },
        };
    }
}
