import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgent } from "./runAgent";
import type { ModelClient } from "../llm/client";
import type { AgentStep, Message } from "../types";

class ScriptedClient implements ModelClient {
    constructor(private readonly steps: AgentStep[]) {}

    async next(): Promise<AgentStep> {
        const step = this.steps.shift();

        if (!step) {
            throw new Error("No scripted step available");
        }

        return step;
    }
}

const createdTempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(
        createdTempDirs.splice(0).map((tempDir) =>
            fs.rm(tempDir, { recursive: true, force: true })),
    );
});

async function createWorkspace(): Promise<string> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "minicode-runagent-"));
    createdTempDirs.push(tempDir);
    await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(
            {
                name: "fixture",
                private: true,
                scripts: {
                    check: "echo ok",
                },
            },
            null,
            2,
        ),
        "utf8",
    );
    return tempDir;
}

function userMessage(content: string): Message {
    return {
        role: "user",
        content,
    };
}

function toolCall(toolName: string, args: Record<string, unknown> = {}): AgentStep {
    return {
        type: "tool_call",
        call: {
            toolName,
            args,
        },
    };
}

function finalMessage(content: string): AgentStep {
    return {
        type: "message",
        message: {
            role: "assistant",
            content,
        },
    };
}

describe("runAgent loop detection", () => {
    test("allows a longer inspect-fix-verify run to finish with a final answer", async () => {
        const cwd = await createWorkspace();
        const client = new ScriptedClient([
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "1" }),
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "2" }),
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "3" }),
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "4" }),
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "5" }),
            finalMessage("completed after verification"),
        ]);

        const result = await runAgent(
            client,
            [userMessage("find any bug with this codebase")],
            {
                cwd,
                toolPolicyMode: "full",
            },
            undefined,
            async () => "allow",
        );

        expect(result.content).toBe("completed after verification");
        expect(await fs.readFile(path.join(cwd, "note.txt"), "utf8")).toBe("5");
    });

    test("allows run_typecheck to repeat after intervening writes", async () => {
        const cwd = await createWorkspace();
        const client = new ScriptedClient([
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "first" }),
            toolCall("run_typecheck"),
            toolCall("write_file", { path: "note.txt", content: "second" }),
            toolCall("run_typecheck"),
            finalMessage("done"),
        ]);

        const result = await runAgent(
            client,
            [userMessage("find any bug with this codebase")],
            {
                cwd,
                toolPolicyMode: "full",
            },
            undefined,
            async () => "allow",
        );

        expect(result.content).toBe("done");
        expect(await fs.readFile(path.join(cwd, "note.txt"), "utf8")).toBe("second");
    });

    test("fails after three consecutive identical tool calls", async () => {
        const cwd = await createWorkspace();
        const client = new ScriptedClient([
            toolCall("run_typecheck"),
            toolCall("run_typecheck"),
            toolCall("run_typecheck"),
        ]);

        await expect(
            runAgent(
                client,
                [userMessage("find any bug with this codebase")],
                {
                    cwd,
                    toolPolicyMode: "full",
                },
            ),
        ).rejects.toThrow("Loop detected: repeated tool call run_typecheck");
    });

    test("supports entering plan mode, writing a plan, and exiting after approval", async () => {
        const cwd = await createWorkspace();
        const client = new ScriptedClient([
            toolCall("enter_plan_mode"),
            toolCall("write_plan", {
                content: "# Plan\n\n- Inspect the failing area\n- Apply the fix\n- Run verification",
            }),
            toolCall("exit_plan_mode"),
            finalMessage("plan approved, ready to implement"),
        ]);

        const result = await runAgent(
            client,
            [userMessage("plan the fix before making changes")],
            {
                cwd,
                toolPolicyMode: "full",
                sessionId: "test-session",
            },
            undefined,
            async () => "allow",
            async () => "approve",
        );

        expect(result.content).toBe("plan approved, ready to implement");
        expect(
            await fs.readFile(
                path.join(cwd, ".minicode", "plans", "plan-test-session.md"),
                "utf8",
            ),
        ).toContain("# Plan");
    });
});
