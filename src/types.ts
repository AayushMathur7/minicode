import { z } from "zod";
import type { ToolPolicyMode } from "./tools/policy";
import type { PermissionDecision } from "./tools/permissions";

// Runtime roles for the conversation loop.
export const Role = z.enum(["system", "user", "assistant", "tool"]);
export type Role = z.infer<typeof Role>;

// Runtime-only message shape.
// Later, if you add persistence, make a separate stored event type instead of
// overloading this one.
export const Message = z.object({
    role: Role,
    content: z.string(),
    // Useful mainly for tool-result messages, e.g.:
    // { role: "tool", name: "read_file", content: "..." }
    name: z.string().optional(),
});

export type Message = z.infer<typeof Message>;

export const ToolInputSchema = z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).default([]),
    additionalProperties: z.boolean().optional(),
});

export type ToolInputSchema = z.infer<typeof ToolInputSchema>;

// Tool metadata is the part the model sees when choosing tools.
export const ToolMetadata = z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: ToolInputSchema,
});

export type ToolMetadata = z.infer<typeof ToolMetadata>;

export type ToolAccessLevel = "read" | "write";

export type ToolExecutionContext = {
    cwd: string;
    signal?: AbortSignal;
};

// ToolDefinition is owned by the runtime, not the model.
// The model can request a tool call, but only your runtime should know how
// to validate args and execute the actual implementation.
export type ToolDefinition = ToolMetadata & {
    accessLevel: ToolAccessLevel;
    execute: (
        args: Record<string, unknown>,
        context: ToolExecutionContext,
    ) => Promise<string>;
};

// Structured request returned by the model when it wants the runtime to use a tool.
export const ToolCall = z.object({
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
    callId: z.string().optional(),
});

export type ToolCall = z.infer<typeof ToolCall>;

// Next action returned by the model.
// This is intentionally not a full message-history item. It models only what
// the model wants the runtime to do on this turn.
export const AgentStep = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("message"),
        message: Message,
    }),
    z.object({
        type: z.literal("tool_call"),
        call: ToolCall,
    }),
]);

export type AgentStep = z.infer<typeof AgentStep>;

export type SessionState = {
    goal: string;
    startedAt: number;
    stepCount: number;
    toolPolicyMode: ToolPolicyMode;
    toolsUsed: string[];
    filesRead: string[];
    lastToolName?: string;
    lastToolPreview?: string;
    finalMessage?: string;
};

export type AgentEvent =
| { type: "run_started"; prompt: string }
| { type: "step_started"; step: number }
| { type: "model_responded"; step: number; responseType: "message" | "tool_call" }
| { type: "tool_requested"; toolName: string; args: Record<string, unknown> }
| { type: "diff_preview_ready"; toolName: string; path: string; preview: string }
| { type: "tool_started"; toolName: string }
| { type: "tool_finished"; toolName: string; preview: string }
| { type: "tool_output_appended"; toolName: string }
| { type: "tool_failed"; toolName: string; error: string }
| { type: "final_message"; content: string }
| { type: "run_completed"; totalSteps: number; durationMs: number }
| { type: "run_cancelled"; reason?: string }
| { type: "run_failed"; error: string }
| { type: "permission_requested"; toolName: string; accessLevel: ToolAccessLevel }
| { type: "permission_resolved"; toolName: string; decision: PermissionDecision };
