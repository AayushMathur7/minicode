// ---------------------------------------------------------------------------
// Notification Queue
// ---------------------------------------------------------------------------
// A simple in-memory queue that background sub-agents push results into.
// The parent's agent loop drains it between turns so the model sees
// completed agent results as new messages.
//
// This is the minicode equivalent of Claude Code's
// enqueuePendingNotification / enqueueAgentNotification
// (see claude-code/src/tasks/LocalAgentTask/LocalAgentTask.tsx).
//
// Why not just use an EventEmitter / callback?
// Because the parent loop is sequential: model thinks → tool executes → repeat.
// We need a *pull*-based mechanism that the loop checks at a natural seam
// (between turns), not a push that could arrive mid-tool-execution.
// ---------------------------------------------------------------------------

export type AgentNotification = {
    agentId: string;
    agentType: string;
    status: "completed" | "failed";
    result: string;
    toolUseCount: number;
    durationMs: number;
    error?: string;
};

const pending: AgentNotification[] = [];

/** Called by the background agent when it finishes (or fails). */
export function enqueueNotification(notification: AgentNotification): void {
    pending.push(notification);
}

/**
 * Drain all pending notifications and return them.
 * Called by the parent agent loop between turns.
 * Returns an empty array if nothing is pending (cheap — no allocations).
 */
export function drainNotifications(): AgentNotification[] {
    if (pending.length === 0) return [];
    // splice(0) empties the array and returns the removed items in one shot.
    return pending.splice(0);
}

/** Format a notification into a message the model can understand. */
export function formatNotification(n: AgentNotification): string {
    const header =
        n.status === "completed"
            ? `[Background agent "${n.agentType}" (${n.agentId}) completed — ${n.toolUseCount} tool uses, ${(n.durationMs / 1000).toFixed(1)}s]`
            : `[Background agent "${n.agentType}" (${n.agentId}) failed — ${n.error ?? "unknown error"}]`;

    return [header, "", n.result].join("\n");
}
