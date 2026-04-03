import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { HookConfig, HookEvent } from "../types";

export function loadHookConfig(cwd: string): HookConfig {
  const settingsPath = join(cwd, ".minicode", "settings.json");
  if (existsSync(settingsPath)) {
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  }
  return { hooks: {} };
}

export function getMatchingHooks(
  config: HookConfig,
  event: HookEvent,
  toolName?: string,
): Array<{ type: "command"; command: string; timeout?: number }> {
  const eventHooks = config.hooks[event] ?? [];
  return eventHooks
    .filter((entry) => {
      if (!entry.matcher || !toolName) return true;
      return new RegExp(entry.matcher).test(toolName);
    })
    .flatMap((entry) => entry.hooks);
}

export async function runHooks(
  config: HookConfig,
  event: "PreToolUse" | "PostToolUse",
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  extra?: Record<string, unknown>,
): Promise<{ blocked: boolean; reason?: string; updatedInput?: Record<string, unknown> }> {
  const hooks = getMatchingHooks(config, event, toolName);
  const env = { MINICODE_PROJECT_DIR: cwd };

  for (const hook of hooks) {
    const result = await executeHook(hook.command, {
      hook_event_name: event,
      tool_name: toolName,
      tool_input: toolInput,
      cwd,
      ...extra,
    }, env);

    if (result.blocked) {
      return { blocked: true, reason: result.reason };
    }
    if (result.updatedInput) {
      return { blocked: false, updatedInput: result.updatedInput as Record<string, unknown> };
    }
  }

  return { blocked: false };
}

export async function executeHook(
  hookCommand: string,
  input: object,
  env?: Record<string, string>,
): Promise<{ blocked: boolean; reason?: string; updatedInput?: object }> {

  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", hookCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    // Pipe the event data as JSON to stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (exitCode) => {
      if (exitCode === 2) {
        // Exit code 2 = BLOCK
        resolve({ blocked: true, reason: stderr || "Blocked by hook" });
        return;
      }

      // Try to parse structured JSON output
      if (stdout.trim()) {
        try {
          const json = JSON.parse(stdout);
          const specific = json.hookSpecificOutput;
          if (specific?.permissionDecision === "deny") {
            resolve({ blocked: true, reason: specific.permissionDecisionReason });
            return;
          }
          resolve({ blocked: false, updatedInput: specific?.updatedInput });
          return;
        } catch { /* not JSON, that's fine */ }
      }

      resolve({ blocked: false });
    });
  });
}