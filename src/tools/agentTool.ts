// Tool: agent — Spawns a sub-agent that runs the same agent loop with a
// different system prompt and filtered tool set.
//
// Two modes:
//   run_in_background: false (default) → blocks until sub-agent finishes
//   run_in_background: true            → returns immediately, result arrives
//                                        later via the notification queue
//
// In BOTH modes the sub-agent runs in the same process and event loop.
// "Background" just means: the tool.execute() returns a placeholder string
// immediately, and the actual LLM loop runs as an un-awaited Promise that
// pushes its result into notificationQueue when done. The parent's agent
// loop drains that queue between turns.

import {
    getAgentDefinition,
    getAvailableAgentNames,
} from "../agent/agents";
import { enqueueNotification } from "../agent/notificationQueue";
import type { ToolDefinition, Message, ToolMetadata } from "../types";
import type { ModelClient } from "../llm/client";
import { filterToolsForSubagent } from "./policy";

// ---------------------------------------------------------------------------
// Module-level state set once at startup via initAgentTool().
// ---------------------------------------------------------------------------

let _client: ModelClient | null = null;
let _allTools: ToolDefinition[] = [];
let _onSubagentEvent: ((event: SubagentEvent) => void) | null = null;
let _nextAgentId = 1;

export type SubagentEvent =
    | { type: "subagent_started"; agentId: string; agentType: string; prompt: string; background: boolean }
    | { type: "subagent_tool_used"; agentId: string; agentType: string; toolName: string }
    | { type: "subagent_finished"; agentId: string; agentType: string; result: string; toolUseCount: number };

/**
 * Call once at startup to give the agent tool access to shared resources.
 */
export function initAgentTool(
    client: ModelClient,
    allTools: ToolDefinition[],
    onEvent?: (event: SubagentEvent) => void,
): void {
    _client = client;
    _allTools = allTools;
    _onSubagentEvent = onEvent ?? null;
}

// ---------------------------------------------------------------------------
// The inner loop that both sync and async paths share.
// ---------------------------------------------------------------------------

async function runSubagentLoop(opts: {
    agentId: string;
    agentType: string;
    prompt: string;
    client: ModelClient;
    toolMap: Map<string, ToolDefinition>;
    toolMetadata: ToolMetadata[];
    systemPrompt: string;
    cwd: string;
    signal?: AbortSignal;
    sessionId?: string;
    agentMode: "execute" | "plan";
}): Promise<{ result: string; toolUseCount: number }> {
    const { agentId, agentType, client, toolMap, toolMetadata, signal } = opts;

    const messages: Message[] = [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.prompt },
    ];

    let toolUseCount = 0;
    const MAX_TURNS = 30;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        if (signal?.aborted) {
            throw new Error(String(signal.reason ?? "cancelled"));
        }

        const step = await client.next({
            messages,
            tools: toolMetadata,
            signal,
        });

        // Final answer — return it.
        if (step.type === "message") {
            return { result: step.message.content, toolUseCount };
        }

        // Tool call.
        const tool = toolMap.get(step.call.toolName);
        if (!tool) {
            messages.push({
                role: "tool",
                name: step.call.toolName,
                content: `Tool "${step.call.toolName}" is not available to this agent.`,
            });
            continue;
        }

        toolUseCount++;
        _onSubagentEvent?.({
            type: "subagent_tool_used",
            agentId,
            agentType,
            toolName: step.call.toolName,
        });

        try {
            const result = await tool.execute(step.call.args, {
                cwd: opts.cwd,
                signal,
                sessionId: opts.sessionId,
                agentMode: opts.agentMode,
            });
            messages.push({ role: "tool", name: step.call.toolName, content: result });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            messages.push({ role: "tool", name: step.call.toolName, content: `Error: ${msg}` });
        }
    }

    return {
        result: "The sub-agent did not produce a final answer within the turn limit. Consider breaking the task into smaller pieces.",
        toolUseCount,
    };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const agentTool: ToolDefinition = {
    name: "agent",
    description: [
        "Launch a sub-agent to handle a task independently.",
        "Available agent types:",
        '  - "explore": Fast, read-only codebase search. Use for finding files, understanding code, answering questions about the repo.',
        '  - "general": Full-access agent for complex tasks requiring code changes, running tests, or multi-step work.',
        "The sub-agent runs with its own conversation context (it cannot see your history) and returns a summary of its findings.",
        "Use this when a task is self-contained and can be delegated without back-and-forth.",
        "By default, agents run in the background (concurrently). When launching multiple agents, they all run in parallel and you receive notifications as each completes.",
        "Set run_in_background to false ONLY when you need the result immediately before deciding your next step.",
    ].join("\n"),
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            prompt: {
                type: "string",
                description: "The task for the sub-agent to perform",
            },
            agent_type: {
                type: "string",
                description:
                    'Which agent to use: "explore" (read-only search) or "general" (full access). Defaults to "explore".',
            },
            run_in_background: {
                type: "boolean",
                description:
                    "Defaults to true (background). The agent runs concurrently and you receive a notification when it completes. Set to false ONLY if you need the result immediately before your next step. When launching multiple agents, ALWAYS use true so they run in parallel.",
            },
        },
        required: ["prompt", "agent_type", "run_in_background"],
        additionalProperties: false,
    },

    execute: async (
        args: Record<string, unknown>,
        context,
    ): Promise<string> => {
        if (context.signal?.aborted) {
            throw new Error(String(context.signal.reason ?? "cancelled"));
        }
        if (!_client) {
            throw new Error(
                "Agent tool not initialised — call initAgentTool() at startup",
            );
        }

        const prompt = args.prompt as string;
        const agentType = (args.agent_type as string | undefined) ?? "explore";
        // Default to background=true so multiple agent calls run concurrently.
        // The model can explicitly set false if it needs the result inline.
        const background = (args.run_in_background as boolean | undefined) ?? true;
        const agentDef = getAgentDefinition(agentType);

        if (!agentDef) {
            const available = getAvailableAgentNames().join(", ");
            return `Unknown agent type "${agentType}". Available: ${available}`;
        }

        const agentId = `agent-${_nextAgentId++}`;

        // Build filtered tool set.
        const parentPolicyMode = context.agentMode === "plan" ? "safe" : "full";
        const subagentTools = filterToolsForSubagent(_allTools, agentDef, parentPolicyMode);
        const toolMap = new Map(subagentTools.map((t) => [t.name, t]));
        const toolMetadata: ToolMetadata[] = subagentTools.map(
            ({ name, description, inputSchema }) => ({ name, description, inputSchema }),
        );
        const systemPrompt = agentDef.getSystemPrompt(context.cwd);

        const loopOpts = {
            agentId,
            agentType,
            prompt,
            client: _client,
            toolMap,
            toolMetadata,
            systemPrompt,
            cwd: context.cwd,
            signal: context.signal,
            sessionId: context.sessionId,
            agentMode: agentDef.agentMode ?? ("execute" as const),
        };

        _onSubagentEvent?.({
            type: "subagent_started",
            agentId,
            agentType,
            prompt,
            background,
        });

        // -----------------------------------------------------------------
        // SYNC path — block until done, return result directly.
        // -----------------------------------------------------------------
        if (!background) {
            const { result, toolUseCount } = await runSubagentLoop(loopOpts);

            _onSubagentEvent?.({
                type: "subagent_finished",
                agentId,
                agentType,
                result: result.substring(0, 200),
                toolUseCount,
            });

            return [
                `[Agent "${agentType}" completed — ${toolUseCount} tool uses]`,
                "",
                result,
            ].join("\n");
        }

        // -----------------------------------------------------------------
        // ASYNC path — fire and forget, push result to notification queue.
        // -----------------------------------------------------------------
        const startTime = Date.now();

        // This Promise is intentionally NOT awaited. It runs concurrently
        // on the same event loop. While it's waiting on an LLM response
        // (network I/O), the parent's loop is free to proceed.
        runSubagentLoop(loopOpts)
            .then(({ result, toolUseCount }) => {
                _onSubagentEvent?.({
                    type: "subagent_finished",
                    agentId,
                    agentType,
                    result: result.substring(0, 200),
                    toolUseCount,
                });
                enqueueNotification({
                    agentId,
                    agentType,
                    status: "completed",
                    result,
                    toolUseCount,
                    durationMs: Date.now() - startTime,
                });
            })
            .catch((error: unknown) => {
                const msg = error instanceof Error ? error.message : String(error);
                enqueueNotification({
                    agentId,
                    agentType,
                    status: "failed",
                    result: "",
                    toolUseCount: 0,
                    durationMs: Date.now() - startTime,
                    error: msg,
                });
            });

        // Return immediately — the parent model sees this and can keep working.
        return [
            `[Agent "${agentType}" launched in background — ID: ${agentId}]`,
            "",
            "You will receive a notification when it completes.",
            "Continue with other work in the meantime.",
        ].join("\n");
    },
};
