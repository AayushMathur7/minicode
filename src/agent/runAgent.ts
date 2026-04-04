import { type ModelClient } from "../llm/client";
import { buildMessages } from "../context/buildMessages";
import { allTools, buildToolMap } from "../tools";
import { applyPreparedPatch, type PreparedPatch, prepareApplyPatch } from "../tools/applyPatch";
import { getPlanArtifact, preparePlanApproval, type PreparedPlanApproval } from "./plans";
import { getSystemPrompt } from "./systemPrompt";
import { type AgentEvent, type AgentStep, type Message, type PlanApprovalDecision, type SessionState, type ToolAccessLevel, type ToolDefinition, type ToolExecutionContext, type ToolMetadata } from "../types";
import { type AgentMode, type ToolPolicyMode, getToolsForRuntime, getPlanModeBlock } from "../tools/policy";
import {
    createSessionState,
    recordFinalMessage,
    recordStepStart,
    recordToolFinished,
    recordToolRequested,
} from "./session";
import type { PermissionDecision } from "../tools/permissions";
import { loadHookConfig, runHooks } from "../utils/hook";
import { drainNotifications, formatNotification } from "./notificationQueue";
export { drainNotifications, formatNotification } from "./notificationQueue";

class RunCancelledError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RunCancelledError";
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) {
        return;
    }

    throw new RunCancelledError(String(signal.reason ?? "cancelled"));
}

function getToolCallSignature(
    toolName: string,
    args: Record<string, unknown>,
): string {
    return `${toolName}:${JSON.stringify(args)}`;
}

// ---------------------------------------------------------------------------
// Path-aware concurrency helpers
// ---------------------------------------------------------------------------

type PendingCall = { toolName: string; args: Record<string, unknown>; tool: ToolDefinition };

/**
 * Extract the file path(s) a tool call will touch.
 * Returns null if we can't determine the path (conservative = serialize).
 */
function getTargetPaths(
    call: PendingCall,
    cwd: string,
): string[] | null {
    const pathArg = call.args.path ?? call.args.file_path;
    if (typeof pathArg === "string") {
        // Tools like read_file, write_file, apply_patch, get_file_outline
        const resolved = pathArg.startsWith("/") ? pathArg : `${cwd}/${pathArg}`;
        return [resolved];
    }

    // search_code, list_files — operate on the whole workspace but are read-only.
    // They don't conflict with anything.
    if (call.tool.accessLevel === "read") {
        return [];  // empty = "no specific file" = never conflicts
    }

    // run_command, agent, etc. — unknown side effects, can't parallelize
    return null;
}

/**
 * Check if two tool calls conflict (touch the same file with at least one write).
 *
 * Rules:
 *   - Two reads on the same file → no conflict (safe)
 *   - Read + write on the same file → conflict
 *   - Write + write on the same file → conflict
 *   - Unknown path (null) on a write → conflicts with everything
 *   - Empty paths (workspace-wide reads) → never conflict
 */
function callsConflict(
    a: PendingCall,
    aPaths: string[] | null,
    b: PendingCall,
    bPaths: string[] | null,
): boolean {
    // Two reads never conflict, even on the same file
    if (a.tool.accessLevel === "read" && b.tool.accessLevel === "read") {
        return false;
    }

    // If either has unknown paths and is a write, conflict conservatively
    if (aPaths === null || bPaths === null) {
        return true;
    }

    // Empty paths (workspace-wide reads like search_code) never conflict
    if (aPaths.length === 0 || bPaths.length === 0) {
        return false;
    }

    // Check for overlapping paths
    const aSet = new Set(aPaths);
    return bPaths.some(p => aSet.has(p));
}

/**
 * Partition a batch of tool calls into sequential groups where calls within
 * each group can safely run in parallel (no path conflicts).
 *
 * Algorithm: greedy coloring. For each call, try to add it to the last group.
 * If it conflicts with anything in that group, start a new group.
 *
 * Example:
 *   [write(a.ts), write(b.ts), write(a.ts), read(c.ts)]
 *   → Group 1: [write(a.ts), write(b.ts), read(c.ts)]  ← no conflicts
 *   → Group 2: [write(a.ts)]                            ← conflicts with group 1's a.ts
 */
function buildParallelGroups(
    batch: PendingCall[],
    cwd: string,
): PendingCall[][] {
    const groups: { calls: PendingCall[]; paths: Array<{ call: PendingCall; paths: string[] | null }> }[] = [];

    for (const call of batch) {
        const paths = getTargetPaths(call, cwd);
        let placed = false;

        // Try to fit into the current (last) group
        if (groups.length > 0) {
            const lastGroup = groups[groups.length - 1]!;
            const conflicts = lastGroup.paths.some(
                existing => callsConflict(existing.call, existing.paths, call, paths),
            );
            if (!conflicts) {
                lastGroup.calls.push(call);
                lastGroup.paths.push({ call, paths });
                placed = true;
            }
        }

        if (!placed) {
            groups.push({
                calls: [call],
                paths: [{ call, paths }],
            });
        }
    }

    return groups.map(g => g.calls);
}

/**
 * Runs the main agent loop until the model returns a final message
 * or the run is cancelled / a loop guard trips.
 *
 * High-level flow:
 * 1. Build the initial conversation and tool list.
 * 2. Ask the model for the next step.
 * 3. If the model responds with a message, finish.
 * 4. If the model requests a tool, optionally ask for permission,
 *    execute the tool, and append the tool result back into the conversation.
 * 5. Repeat until completion.
 */
export async function runAgent(
    client: ModelClient,
    userMessages: Message[],
    options: {
        cwd?: string;
        toolPolicyMode?: ToolPolicyMode;
        signal?: AbortSignal;
        mode?: AgentMode;
        sessionId?: string;
    } = {},
    onEvent?: (event: AgentEvent, state: SessionState) => void,
    requestPermission?: (params: {
        toolName: string;
        accessLevel: ToolAccessLevel;
        args: Record<string, unknown>;
        preview?: string;
    }) => Promise<PermissionDecision>,
    requestPlanApproval?: (params: {
        filePath: string;
        content: string;
    }) => Promise<PlanApprovalDecision>,
): Promise<Message> {
    // Default to the safer tool policy unless the caller explicitly opts into another mode.
    const toolPolicyMode = options.toolPolicyMode ?? "safe";
    const sessionId = options.sessionId ?? `session-${Date.now()}`;
    let agentMode = options.mode ?? "execute";

    // Use the latest user message as the session goal/prompt shown in emitted events.
    const prompt = userMessages[userMessages.length - 1]?.content || "";

    // Tools execute relative to the provided cwd so filesystem operations stay scoped.
    const executionContext: ToolExecutionContext = {
        cwd: options.cwd ?? process.cwd(),
        signal: options.signal,
        sessionId,
        agentMode,
    };

    const hookConfig = loadHookConfig(executionContext.cwd);

    function getVisibleToolState(currentMode: AgentMode): {
        toolMap: Map<string, ToolDefinition>;
        toolMetadata: ToolMetadata[];
    } {
        const allowedTools = getToolsForRuntime(allTools, currentMode, toolPolicyMode);
        return {
            toolMap: buildToolMap(allowedTools),
            toolMetadata: allowedTools.map(({ name, description, inputSchema }) => ({
                name,
                description,
                inputSchema,
            })),
        };
    }

    let { toolMap, toolMetadata } = getVisibleToolState(agentMode);

    function appendModeSystemMessage(currentMode: AgentMode): void {
        messages.push({
            role: "system",
            content: getSystemPrompt({
                cwd: executionContext.cwd,
                toolPolicyMode,
                agentMode: currentMode,
                availableToolNames: toolMetadata.map((tool) => tool.name),
                taskPrompt: prompt,
            }),
        });
    }

    function setAgentMode(nextMode: AgentMode): void {
        agentMode = nextMode;
        executionContext.agentMode = nextMode;
        ({ toolMap, toolMetadata } = getVisibleToolState(nextMode));
        appendModeSystemMessage(nextMode);
    }

    // Start from the caller's messages, then keep appending model/tool outputs as the run progresses.
    const messages: Message[] = buildMessages(userMessages, {
        cwd: executionContext.cwd,
        toolPolicyMode,
        agentMode,
        availableToolNames: toolMetadata.map((tool) => tool.name),
        taskPrompt: prompt,
    });

    // Track the run in a session object so renderers / observers can show progress.
    let sessionState: SessionState = createSessionState({
        goal: prompt,
        toolPolicyMode,
    });

    onEvent?.({ type: "run_started", prompt }, sessionState);

    let steps = 0;
    let successfulWriteCount = 0;
    let postWriteToolCalls = 0;
    let repeatedToolCallStreak = 0;
    let lastToolCallSignature: string | undefined;
    try {
        while (true) {
            steps++;
            sessionState = recordStepStart(sessionState, steps);
            onEvent?.({ type: "step_started", step: steps }, sessionState);

            throwIfAborted(options.signal);

            // --- Drain background agent notifications ---
            // If any background sub-agents have completed since the last turn,
            // inject their results into the conversation so the model can see them.
            for (const notification of drainNotifications()) {
                const notificationText = formatNotification(notification);
                messages.push({
                    role: "user",
                    content: notificationText,
                });
                onEvent?.(
                    {
                        type: "tool_finished",
                        toolName: `agent:${notification.agentType}`,
                        preview: notification.status === "completed"
                            ? `${notification.toolUseCount} tool uses, ${(notification.durationMs / 1000).toFixed(1)}s`
                            : `failed: ${notification.error ?? "unknown"}`,
                    },
                    sessionState,
                );
            }

            // Ask the model what to do next given the current conversation and tool list.
            let step: AgentStep = await client.next({
                messages,
                tools: toolMetadata,
                signal: options.signal,
                onStreamEvent: (event) => {
                    switch (event.type) {
                        case "thinking_started":
                            onEvent?.({ type: "model_thinking_started" }, sessionState);
                            break;
                        case "thinking_completed":
                            onEvent?.({ type: "model_thinking_completed" }, sessionState);
                            break;
                        case "reasoning_summary_delta":
                            onEvent?.({ type: "reasoning_summary_delta", chunk: event.chunk }, sessionState);
                            break;
                        case "reasoning_summary_completed":
                            onEvent?.({ type: "reasoning_summary_completed", content: event.content }, sessionState);
                            break;
                        case "assistant_text_started":
                            onEvent?.({ type: "assistant_text_started" }, sessionState);
                            break;
                        case "assistant_text_delta":
                            onEvent?.({ type: "assistant_text_delta", chunk: event.chunk }, sessionState);
                            break;
                        case "assistant_text_completed":
                            onEvent?.({ type: "assistant_text_completed", content: event.content }, sessionState);
                            break;
                        case "tool_call_detected":
                            onEvent?.({ type: "tool_call_detected", toolName: event.toolName }, sessionState);
                            break;
                    }
                },
                onUsage: (usage) => {
                    onEvent?.(
                        {
                            type: "usage_updated",
                            model: usage.model,
                            inputTokens: usage.inputTokens,
                            outputTokens: usage.outputTokens,
                            totalTokens: usage.totalTokens,
                        },
                        sessionState,
                    );
                },
            });

            throwIfAborted(options.signal);

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

            // ---------------------------------------------------------------
            // Path-Aware Concurrent Tool Execution
            // ---------------------------------------------------------------
            // When the model returns multiple tool calls in one response,
            // we group them by file path conflicts:
            //
            //   - Calls touching DIFFERENT files → run in parallel
            //   - Calls touching the SAME file → run in sequence
            //   - Calls with unknown paths (e.g. bash) → run serially (conservative)
            //   - Reads never conflict with each other (even on same file)
            //
            // This goes beyond Claude Code's approach (which is per-tool-type).
            // It's row-level locking instead of table-level locking.
            // ---------------------------------------------------------------

            const batch: PendingCall[] = [];

            // Collect all buffered tool calls into a batch
            const firstTool = step.type === "tool_call" ? toolMap.get(step.call.toolName) : undefined;
            if (step.type === "tool_call" && firstTool && firstTool.name !== "agent" && client.hasPendingToolCalls()) {
                const seenSignatures = new Set<string>();
                seenSignatures.add(getToolCallSignature(step.call.toolName, step.call.args));
                batch.push({ toolName: step.call.toolName, args: step.call.args, tool: firstTool });

                while (client.hasPendingToolCalls()) {
                    const nextStep = await client.next({ messages, tools: toolMetadata, signal: options.signal });
                    if (nextStep.type !== "tool_call") break;
                    const nextTool = toolMap.get(nextStep.call.toolName);
                    if (!nextTool) break;

                    const sig = getToolCallSignature(nextStep.call.toolName, nextStep.call.args);
                    if (seenSignatures.has(sig)) {
                        batch.push({ toolName: nextStep.call.toolName, args: nextStep.call.args, tool: nextTool });
                        break; // duplicate → stop collecting, let loop detector handle
                    }
                    seenSignatures.add(sig);
                    batch.push({ toolName: nextStep.call.toolName, args: nextStep.call.args, tool: nextTool });
                }
            }

            // If we have 2+ calls, partition into conflict-free parallel groups
            if (batch.length >= 2) {
                const groups = buildParallelGroups(batch, executionContext.cwd);

                for (const group of groups) {
                    if (group.length === 1) {
                        // Single call — if it needs special handling (permissions,
                        // hooks, plan mode), fall through to the serial path.
                        // Only auto-execute simple reads here.
                        const call = group[0]!;
                        if (call.tool.accessLevel === "read") {
                            sessionState = recordToolRequested(sessionState, call.toolName, call.args);
                            onEvent?.({ type: "tool_requested", toolName: call.toolName, args: call.args }, sessionState);
                            try {
                                const result = await call.tool.execute(call.args, executionContext);
                                const preview = result.substring(0, 100);
                                sessionState = recordToolFinished(sessionState, call.toolName, preview);
                                onEvent?.({ type: "tool_finished", toolName: call.toolName, preview }, sessionState);
                                messages.push({ role: "tool", content: result, name: call.toolName });
                                onEvent?.({ type: "tool_output_appended", toolName: call.toolName }, sessionState);
                            } catch (error) {
                                const msg = error instanceof Error ? error.message : String(error);
                                onEvent?.({ type: "tool_failed", toolName: call.toolName, error: msg }, sessionState);
                                messages.push({ role: "tool", content: `Error: ${msg}`, name: call.toolName });
                            }
                        } else {
                            // Write tool — fall through to serial path with full
                            // permission/hook handling
                            step = { type: "tool_call", call: { toolName: call.toolName, args: call.args } };
                            break; // exit group loop, continue to serial path below
                        }
                        continue;
                    }

                    // Multiple non-conflicting calls — run in parallel
                    onEvent?.({ type: "tool_started", toolName: `${group.length} tools in parallel` }, sessionState);

                    const results = await Promise.all(
                        group.map(async (call) => {
                            sessionState = recordToolRequested(sessionState, call.toolName, call.args);
                            onEvent?.({ type: "tool_requested", toolName: call.toolName, args: call.args }, sessionState);
                            try {
                                const result = await call.tool.execute(call.args, executionContext);
                                const preview = result.substring(0, 100);
                                sessionState = recordToolFinished(sessionState, call.toolName, preview);
                                onEvent?.({ type: "tool_finished", toolName: call.toolName, preview }, sessionState);
                                return { toolName: call.toolName, result };
                            } catch (error) {
                                const msg = error instanceof Error ? error.message : String(error);
                                onEvent?.({ type: "tool_failed", toolName: call.toolName, error: msg }, sessionState);
                                return { toolName: call.toolName, result: `Error: ${msg}` };
                            }
                        }),
                    );

                    for (const { toolName, result } of results) {
                        messages.push({ role: "tool", content: result, name: toolName });
                        onEvent?.({ type: "tool_output_appended", toolName }, sessionState);
                    }
                }

                // If all groups were processed (no write fell through), skip serial path
                if (batch.every(c => c.tool.accessLevel === "read")) {
                    continue;
                }
            }

            // ---------------------------------------------------------------
            // Serial execution path (single call, or write after batch)
            // ---------------------------------------------------------------

            const tool: ToolDefinition | undefined = toolMap.get(step.call.toolName);
            sessionState = recordToolRequested(sessionState, step.call.toolName, step.call.args);
            onEvent?.({ type: "tool_requested", toolName: step.call.toolName, args: step.call.args }, sessionState);

            const toolCallSignature = getToolCallSignature(
                step.call.toolName,
                step.call.args,
            );
            if (toolCallSignature === lastToolCallSignature) {
                repeatedToolCallStreak += 1;
            } else {
                repeatedToolCallStreak = 1;
                lastToolCallSignature = toolCallSignature;
            }

            if (repeatedToolCallStreak >= 3) {
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

            // --- Plan mode gate ---
            // All tools are visible to the model, but write tools (except
            // write_plan and exit_plan_mode) are blocked at execution time
            // in plan mode. This matches Claude Code's approach: the model
            // knows what tools exist and can plan around them, but can't
            // use writes until it exits plan mode.
            const planBlock = getPlanModeBlock(tool.name, tool.accessLevel, agentMode);
            if (planBlock) {
                onEvent?.(
                    { type: "tool_failed", toolName: step.call.toolName, error: "blocked by plan mode" },
                    sessionState,
                );
                messages.push({
                    role: "tool",
                    name: tool.name,
                    content: planBlock,
                });
                continue;
            }

            try {
                let preview: string | undefined;
                let preparedPatch: PreparedPatch | undefined;
                let preparedPlanApproval: PreparedPlanApproval | undefined;

                if (tool.name === "apply_patch") {
                    throwIfAborted(options.signal);
                    preparedPatch = await prepareApplyPatch(step.call.args, executionContext);
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

                if (tool.name === "exit_plan_mode") {
                    throwIfAborted(options.signal);
                    preparedPlanApproval = await preparePlanApproval(
                        executionContext.cwd,
                        executionContext.sessionId,
                    );
                    onEvent?.(
                        {
                            type: "plan_approval_requested",
                            filePath: preparedPlanApproval.displayPath,
                            content: preparedPlanApproval.content,
                        },
                        sessionState,
                    );

                    const decision =
                        (await requestPlanApproval?.({
                            filePath: preparedPlanApproval.displayPath,
                            content: preparedPlanApproval.content,
                        })) ?? "reject";

                    throwIfAborted(options.signal);

                    onEvent?.(
                        {
                            type: "plan_approval_resolved",
                            decision,
                        },
                        sessionState,
                    );

                    if (decision === "reject") {
                        messages.push({
                            role: "tool",
                            name: tool.name,
                            content: "Plan approval rejected. Stay in plan mode and revise the plan.",
                        });
                        continue;
                    }
                }

                // Write-capable tools require an explicit permission decision.
                // If no permission callback is provided, the default is to deny.
                if (tool.accessLevel === "write") {
                    throwIfAborted(options.signal);
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

                    throwIfAborted(options.signal);

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

                throwIfAborted(options.signal);
                onEvent?.({ type: "tool_started", toolName: step.call.toolName }, sessionState);

                // --- PreToolUse hooks ---
                const preHookResult = await runHooks(
                    hookConfig, "PreToolUse",
                    step.call.toolName, step.call.args,
                    executionContext.cwd,
                );
                if (preHookResult.blocked) {
                    const reason = preHookResult.reason ?? "Blocked by hook";
                    onEvent?.({ type: "tool_failed", toolName: step.call.toolName, error: reason }, sessionState);
                    messages.push({ role: "tool", name: step.call.toolName, content: reason });
                    continue;
                }
                if (preHookResult.updatedInput) {
                    step.call.args = preHookResult.updatedInput;
                }

                // Execute the tool, store a short preview for UI/session history,
                // then append the full result so the model can use it on the next turn.
                let result: string;

                if (tool.name === "apply_patch" && preparedPatch) {
                    result = await applyPreparedPatch(preparedPatch, executionContext);
                } else if (tool.name === "exit_plan_mode" && preparedPlanApproval) {
                    result = `Exited plan mode. Plan approved in ${preparedPlanApproval.displayPath}`;
                } else {
                    result = await tool.execute(step.call.args, executionContext);
                }
                throwIfAborted(options.signal);
                const resultPreview = result.substring(0, 100);
                sessionState = recordToolFinished(sessionState, step.call.toolName, resultPreview);
                onEvent?.(
                    { type: "tool_finished", toolName: step.call.toolName, preview: resultPreview },
                    sessionState,
                );

                // --- PostToolUse hooks ---
                await runHooks(
                    hookConfig, "PostToolUse",
                    step.call.toolName, step.call.args,
                    executionContext.cwd,
                    { tool_response: result },
                );

                messages.push({
                    role: "tool",
                    content: result,
                    name: step.call.toolName,
                });
                onEvent?.({ type: "tool_output_appended", toolName: step.call.toolName }, sessionState);

                if (tool.name === "enter_plan_mode" && agentMode !== "plan") {
                    const planArtifact = getPlanArtifact(executionContext.cwd, executionContext.sessionId);
                    onEvent?.(
                        {
                            type: "plan_mode_entered",
                            filePath: planArtifact.displayPath,
                        },
                        sessionState,
                    );
                    setAgentMode("plan");
                }

                if (tool.name === "write_plan" && agentMode === "plan") {
                    const planArtifact = getPlanArtifact(executionContext.cwd, executionContext.sessionId);
                    onEvent?.(
                        {
                            type: "plan_written",
                            filePath: planArtifact.displayPath,
                        },
                        sessionState,
                    );
                }

                if (tool.name === "exit_plan_mode" && preparedPlanApproval) {
                    onEvent?.(
                        {
                            type: "plan_mode_exited",
                            filePath: preparedPlanApproval.displayPath,
                        },
                        sessionState,
                    );
                    setAgentMode("execute");
                }

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
                if (error instanceof RunCancelledError) {
                    throw error;
                }

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

    } catch (error) {
        if (error instanceof RunCancelledError) {
            onEvent?.(
                {
                    type: "run_cancelled",
                    reason: error.message,
                },
                sessionState,
            );
        }

        throw error;
    }
}
