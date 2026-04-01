import { type ModelClient } from "../llm/client";
import { buildMessages } from "../context/buildMessages";
import { buildToolMap, getToolsForPolicy } from "../tools";
import { prepareApplyPatch } from "../tools/applyPatch";
import { type AgentEvent, type AgentStep, type Message, type SessionState, type ToolAccessLevel, type ToolDefinition, type ToolExecutionContext, type ToolMetadata } from "../types";
import { type ToolPolicyMode } from "../tools/policy";
import {
    createSessionState,
    recordFinalMessage,
    recordStepStart,
    recordToolFinished,
    recordToolRequested,
} from "./session";
import type { PermissionDecision } from "../tools/permissions";

function getToolCallSignature(
    toolName: string,
    args: Record<string, unknown>,
): string {
    return `${toolName}:${JSON.stringify(args)}`;
}

/**
 * Runs the main agent loop until the model returns a final message
 * or the step limit is reached.
 *
 * High-level flow:
 * 1. Build the initial conversation and tool list.
 * 2. Ask the model for the next step.
 * 3. If the model responds with a message, finish.
 * 4. If the model requests a tool, optionally ask for permission,
 *    execute the tool, and append the tool result back into the conversation.
 * 5. Repeat until completion or maxSteps.
 */
export async function runAgent(
    client: ModelClient,
    userMessages: Message[],
    options: {
        cwd?: string;
        toolPolicyMode?: ToolPolicyMode;
    } = {},
    onEvent?: (event: AgentEvent, state: SessionState) => void,
    requestPermission?: (params: {
        toolName: string;
        accessLevel: ToolAccessLevel;
        args: Record<string, unknown>;
        preview?: string;
    }) => Promise<PermissionDecision>,
): Promise<Message> {
    // Default to the safer tool policy unless the caller explicitly opts into another mode.
    const toolPolicyMode = options.toolPolicyMode ?? "safe";

    // Use the latest user message as the session goal/prompt shown in emitted events.
    const prompt = userMessages[userMessages.length - 1]?.content || "";

    // Start from the caller's messages, then keep appending model/tool outputs as the run progresses.
    const messages: Message[] = buildMessages(userMessages);

    // Tools execute relative to the provided cwd so filesystem operations stay scoped.
    const executionContext: ToolExecutionContext = {
        cwd: options.cwd ?? process.cwd(),
    };

    // Resolve which tools are available for the current policy mode, and prepare
    // both a fast lookup map for runtime execution and metadata for the model.
    const allowedTools = getToolsForPolicy(toolPolicyMode);
    const toolMap = buildToolMap(allowedTools);
    const toolMetadata: ToolMetadata[] = allowedTools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
    }));

    // Track the run in a session object so renderers / observers can show progress.
    let sessionState: SessionState = createSessionState({
        goal: prompt,
        toolPolicyMode,
    });

    onEvent?.({ type: "run_started", prompt }, sessionState);

    // Safety valve: prevent the model from looping forever if it keeps asking for tools.
    const maxSteps = 10;
    let steps = 0;
    let successfulWriteCount = 0;
    let postWriteToolCalls = 0;
    const toolCallCounts = new Map<string, number>();
    while (steps < maxSteps) {
        steps++;
        sessionState = recordStepStart(sessionState, steps);
        onEvent?.({ type: "step_started", step: steps }, sessionState);

        // Ask the model what to do next given the current conversation and tool list.
        const step: AgentStep = await client.next({ messages, tools: toolMetadata });

        // A plain message means the model is done and has produced the final answer.
        if (step.type === "message") {
            onEvent?.({ type: "model_responded", step: steps, responseType: "message" }, sessionState);
            const message: Message = {
                role: step.message.role,
                content: step.message.content,
            };

            // Keep the final message in the conversation history and session state for observers.
            messages.push(message);
            sessionState = recordFinalMessage(sessionState, message.content);
            onEvent?.({ type: "final_message", content: message.content }, sessionState);
            onEvent?.(
                {
                    type: "run_completed",
                    totalSteps: steps,
                    durationMs: Date.now() - sessionState.startedAt,
                },
                sessionState,
            );
            return message;
        }

        // Otherwise the model wants to call a tool.
        onEvent?.({ type: "model_responded", step: steps, responseType: "tool_call" }, sessionState);

        const tool: ToolDefinition | undefined = toolMap.get(step.call.toolName);
        sessionState = recordToolRequested(sessionState, step.call.toolName, step.call.args);
        onEvent?.({ type: "tool_requested", toolName: step.call.toolName, args: step.call.args }, sessionState);

        const toolCallSignature = getToolCallSignature(
            step.call.toolName,
            step.call.args,
        );
        const nextCallCount = (toolCallCounts.get(toolCallSignature) ?? 0) + 1;
        toolCallCounts.set(toolCallSignature, nextCallCount);

        if (nextCallCount >= 3) {
            const error = `Loop detected: repeated tool call ${step.call.toolName}`;
            onEvent?.({ type: "run_failed", error }, sessionState);
            throw new Error(error);
        }

        // If the model asked for a tool that is not available under the current policy,
        // feed that failure back into the conversation so it can recover on the next step.
        if (!tool) {
            onEvent?.(
                {
                    type: "tool_failed",
                    toolName: step.call.toolName,
                    error: `Tool ${step.call.toolName} not found`,
                },
                sessionState,
            );
            messages.push({
                role: "assistant",
                content: `Tool ${step.call.toolName} not found`,
            });
            continue;
        }

        try {
            let preview: string | undefined;

            if (tool.name === "apply_patch") {
                const preparedPatch = await prepareApplyPatch(step.call.args, executionContext);
                preview = preparedPatch.preview;
                onEvent?.(
                    {
                        type: "diff_preview_ready",
                        toolName: tool.name,
                        path: preparedPatch.displayPath,
                        preview,
                    },
                    sessionState,
                );
            }

            // Write-capable tools require an explicit permission decision.
            // If no permission callback is provided, the default is to deny.
            if (tool.accessLevel === "write") {
                onEvent?.(
                    {
                        type: "permission_requested",
                        toolName: step.call.toolName,
                        accessLevel: tool.accessLevel,
                    },
                    sessionState,
                );

                const decision =
                    (await requestPermission?.({
                        toolName: tool.name,
                        accessLevel: tool.accessLevel,
                        args: step.call.args,
                        preview,
                    })) ?? "deny";

                onEvent?.(
                    {
                        type: "permission_resolved",
                        toolName: step.call.toolName,
                        decision,
                    },
                    sessionState,
                );

                // Permission denials are returned to the model as tool output so it can choose another path.
                if (decision === "deny") {
                    messages.push({
                        role: "tool",
                        name: tool.name,
                        content: "Permission denied by user",
                    });
                    continue;
                }
            }

            onEvent?.({ type: "tool_started", toolName: step.call.toolName }, sessionState);

            // Execute the tool, store a short preview for UI/session history,
            // then append the full result so the model can use it on the next turn.
            const result = await tool.execute(step.call.args, executionContext);
            const resultPreview = result.substring(0, 100);
            sessionState = recordToolFinished(sessionState, step.call.toolName, resultPreview);
            onEvent?.(
                { type: "tool_finished", toolName: step.call.toolName, preview: resultPreview },
                sessionState,
            );
            messages.push({
                role: "tool",
                content: result,
                name: step.call.toolName,
            });
            onEvent?.({ type: "tool_output_appended", toolName: step.call.toolName }, sessionState);

            if (tool.name === "write_file" || tool.name === "apply_patch") {
                successfulWriteCount += 1;
                postWriteToolCalls = 0;
            } else if (successfulWriteCount > 0) {
                postWriteToolCalls += 1;
            }

            if (postWriteToolCalls >= 4) {
                const error = "Loop detected: too many tool calls after a successful write";
                onEvent?.({ type: "run_failed", error }, sessionState);
                throw new Error(error);
            }
        } catch (error) {
            onEvent?.(
                {
                    type: "tool_failed",
                    toolName: step.call.toolName,
                    error: error instanceof Error ? error.message : String(error),
                },
                sessionState,
            );
            throw error;
        }
    }

    // Hitting the step limit is treated as a run failure instead of silently stopping.
    onEvent?.({ type: "run_failed", error: `Max steps reached: ${maxSteps}` }, sessionState);
    throw new Error(`Max steps reached: ${maxSteps}`);
}
