import { type ToolPolicyMode, type AgentMode } from "../tools/policy";
import {
    dynamicSystemPromptSection,
    resolveSystemPromptSections,
    systemPromptSection,
} from "./systemPromptSections";

type SystemPromptOptions = {
    cwd?: string;
    toolPolicyMode?: ToolPolicyMode;
    agentMode?: AgentMode;
    availableToolNames?: string[];
    taskPrompt?: string;
};

function getCoreIdentitySection(): string {
    return "You are Minicode, a coding agent working inside a local repository.";
}

function getToolUsageSection(): string {
    return [
        "Use tools instead of guessing about files, code, or command output.",
        "Use list_files for broad discovery, search_code to locate relevant code, and get_file_outline before reading a full source file when structure is enough.",
        "Use read_file only when you need a full file. Prefer read_file_range when you only need a specific section.",
    ].join(" ");
}

function getEditingSection(): string {
    return [
        "Prefer apply_patch for targeted edits. Use write_file only when replacing or creating a full file is truly necessary.",
        "If you successfully edit a file, provide a final assistant message summarizing what changed and stop.",
        "After a successful write_file or apply_patch call, only read again if you need one quick verification read.",
    ].join(" ");
}

function getVerificationSection(): string {
    return "After code edits, prefer run_typecheck and run_tests to verify the result when those checks are relevant.";
}

function getPlanWorkflowSection(): string {
    return [
        "In plan mode, do not edit repository files or propose direct implementation changes yet.",
        "Explore the codebase, identify the relevant files and patterns, then save the plan with write_plan.",
        "Once the plan file is ready, call exit_plan_mode to present it for approval before any implementation work begins.",
    ].join(" ");
}

function getEfficiencySection(): string {
    return [
        "Do not repeat the same tool call unless the context has changed or the previous result was incomplete.",
        "Avoid rereading the same file multiple times without a clear reason.",
        "Be concise in the final answer and explain what changed.",
    ].join(" ");
}

function isBroadBugFixPrompt(prompt: string): boolean {
    return /\b(fix|find|debug)\b.*\b(any bug|a bug|bugs?)\b|\bfix any bug\b/i.test(prompt);
}

function isBroadPerformancePrompt(prompt: string): boolean {
    return /\b(optimi[sz]e|speed up|make .*faster|improve performance|performance)\b/i.test(prompt);
}

function getDynamicSessionContext({
    cwd,
    toolPolicyMode,
    availableToolNames,
}: SystemPromptOptions): string {
    const parts = [
        cwd ? `Current working directory: ${cwd}` : null,
        toolPolicyMode ? `Tool policy mode: ${toolPolicyMode}` : null,
        availableToolNames && availableToolNames.length > 0
            ? `Visible tools: ${availableToolNames.join(", ")}`
            : null,
    ].filter((part): part is string => part !== null);

    return parts.join("\n");
}

function getModeSection(mode: AgentMode): string {
    if (mode === "plan") {
        return "Investigate and propose a plan. Do not edit files.";
    }
    return "Execute the task using tools, edits, and verification when needed.";
}

function getTaskStrategySection(taskPrompt: string | undefined): string | null {
    if (!taskPrompt) {
        return null;
    }

    if (isBroadBugFixPrompt(taskPrompt)) {
        return [
            "For broad bug-fix requests, first identify one concrete issue before editing anything.",
            "Prefer run_typecheck and run_tests to find a real failing problem, then fix only the single highest-signal issue you found in this run.",
            "If no concrete failing issue is found, explain the best candidate issue you investigated and stop instead of wandering across the repo.",
        ].join(" ");
    }

    if (isBroadPerformancePrompt(taskPrompt)) {
        return [
            "For broad performance requests, first identify one concrete bottleneck or hot path before editing anything.",
            "Inspect structure with get_file_outline and targeted slices with read_file_range, then optimize only one clear issue in this run and verify it if possible.",
            "If you cannot identify a concrete bottleneck, report the best candidate and stop instead of making speculative edits.",
        ].join(" ");
    }

    return null;
}

export function getSystemPrompt(options: SystemPromptOptions = {}): string {
    const agentMode = options.agentMode ?? "execute";
    return resolveSystemPromptSections([
        systemPromptSection("core_identity", getCoreIdentitySection),
        dynamicSystemPromptSection("agent_mode", () => getModeSection(agentMode)),
        dynamicSystemPromptSection("task_strategy", () =>
            getTaskStrategySection(options.taskPrompt),
        ),
        systemPromptSection("tool_usage", getToolUsageSection),
        dynamicSystemPromptSection("plan_workflow", () =>
            agentMode === "plan" ? getPlanWorkflowSection() : null,
        ),
        dynamicSystemPromptSection("editing", () =>
            agentMode === "execute" ? getEditingSection() : null,
        ),
        dynamicSystemPromptSection("verification", () =>
            agentMode === "execute" ? getVerificationSection() : null,
        ),
        systemPromptSection("efficiency", getEfficiencySection),
        dynamicSystemPromptSection("session_context", () =>
            getDynamicSessionContext(options),
        ),
    ]).join("\n\n");
}

export const SYSTEM_PROMPT = getSystemPrompt();
