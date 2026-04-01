import { type AgentEvent, type SessionState } from "../types";

function formatDuration(durationMs: number): string {
    if (durationMs < 1000) {
        return `${durationMs}ms`;
    }

    return `${(durationMs / 1000).toFixed(1)}s`;
}

export function renderCliEvent(event: AgentEvent, state: SessionState): void {
    switch (event.type) {
        case "run_started":
            console.log(`Starting run: ${event.prompt}`);
            break;
        case "step_started":
            console.log(`Step ${event.step}`);
            break;
        case "model_responded":
            console.log(`Model chose: ${event.responseType}`);
            break;
        case "tool_requested":
            console.log(`Tool requested: ${event.toolName}`);
            break;
        case "diff_preview_ready":
            console.log(`Patch preview for ${event.path}:\n${event.preview}`);
            break;
        case "tool_started":
            console.log(`Running ${event.toolName}...`);
            break;
        case "tool_finished":
            console.log(`Finished ${event.toolName}: ${event.preview}`);
            break;
        case "tool_output_appended":
            console.log(`Added ${event.toolName} output back into history`);
            break;
        case "tool_failed":
            console.log(`Tool failed: ${event.toolName}: ${event.error}`);
            break;
        case "permission_requested":
            console.log(`Permission required for ${event.toolName} (${event.accessLevel})`);
            break;
        case "permission_resolved":
            console.log(`Permission ${event.decision} for ${event.toolName}`);
            break;
        case "final_message":
            console.log(`Final answer ready after ${state.stepCount} step(s)`);
            break;
        case "run_completed":
            console.log(
                `Run completed in ${formatDuration(event.durationMs)} using ${state.toolsUsed.length} tool call(s)`,
            );
            break;
        case "run_failed":
            console.log(`Run failed: ${event.error}`);
            break;
    }
}
