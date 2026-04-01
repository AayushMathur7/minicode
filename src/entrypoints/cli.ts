import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgent } from "../agent/runAgent";
import { OpenAIClient } from "../llm/openai";
import { renderCliEvent } from "../renderers/cli";
import { type Message } from "../types";
import { type PermissionDecision } from "../tools/permissions";

async function requestPermission(params: {
    toolName: string;
    accessLevel: "read" | "write";
    args: Record<string, unknown>;
    preview?: string;
}): Promise<PermissionDecision> {
    const rl = createInterface({ input, output });

    try {
        const answer = await rl.question(
            `Allow ${params.toolName} (${params.accessLevel})? [y/N] `,
        );

        return answer.trim().toLowerCase() === "y" ? "allow" : "deny";
    } finally {
        rl.close();
    }
}

export async function main() {
    const prompt = process.argv.slice(2).join(" ").trim();

    if (!prompt) {
        console.error("Usage: bun run src/index.ts \"<prompt>\"");
        process.exit(1);
    }

    const userMessage: Message[] = [{ role: "user", content: prompt }];
    const client = new OpenAIClient( process.env.OPENAI_API_KEY || "" );
    const result = await runAgent(client, userMessage, 
        {
            cwd: process.cwd(),
            toolPolicyMode: "full",
        }, 
        (event, state) => {
            renderCliEvent(event, state);
        },
        requestPermission,
        
    );

    console.log(result.content);
}
