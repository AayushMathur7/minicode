import { describe, expect, test } from "bun:test";
import { createInitialSessionState, sessionReducer } from "./state";

describe("sessionReducer", () => {
    test("replaces a streamed assistant response instead of appending a duplicate", () => {
        let state = createInitialSessionState();

        state = sessionReducer(state, {
            type: "prompt_submitted",
            prompt: "who are you",
        });

        state = sessionReducer(state, {
            type: "agent_event",
            event: { type: "assistant_text_started" },
        });

        state = sessionReducer(state, {
            type: "agent_event",
            event: {
                type: "assistant_text_delta",
                chunk: "I’m Minicode",
            },
        });

        state = sessionReducer(state, {
            type: "agent_event",
            event: {
                type: "assistant_text_completed",
                content: "I’m Minicode",
            },
        });

        state = sessionReducer(state, {
            type: "assistant_message_added",
            content: "I’m Minicode",
        });

        expect(state.transcript).toHaveLength(2);
        expect(state.transcript[1]).toMatchObject({
            role: "assistant",
            content: "I’m Minicode",
            isStreaming: false,
        });
        expect(state.streamingAssistantEntryId).toBeUndefined();
        expect(state.conversationMessages).toHaveLength(2);
        expect(state.conversationMessages[1]).toMatchObject({
            role: "assistant",
            content: "I’m Minicode",
        });
    });
});
