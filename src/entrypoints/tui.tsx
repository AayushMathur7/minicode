#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "../ui/App";

const ENTER_ALTERNATE_SCREEN = "\u001B[?1049h";
const EXIT_ALTERNATE_SCREEN = "\u001B[?1049l";
const CLEAR_AND_HOME = "\u001B[2J\u001B[H";

function parseArgs(argv: string[]): { prompt?: string; resumeSessionId?: string } {
    const args = argv.slice(2);

    // --resume or --resume <id>
    const resumeIdx = args.indexOf("--resume");
    if (resumeIdx !== -1) {
        const nextArg = args[resumeIdx + 1];
        // If there's a next arg and it doesn't look like a flag, use it as session ID
        const sessionId = nextArg && !nextArg.startsWith("--") ? nextArg : "last";
        return { resumeSessionId: sessionId };
    }

    // --continue (alias for --resume last)
    if (args.includes("--continue")) {
        return { resumeSessionId: "last" };
    }

    const prompt = args.join(" ").trim();
    return { prompt: prompt || undefined };
}

export async function main(): Promise<void> {
    const { prompt, resumeSessionId } = parseArgs(process.argv);
    const shouldManageTerminal = Boolean(process.stdout.isTTY);

    if (shouldManageTerminal) {
        process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_AND_HOME}`);
    }

    const instance = render(
        <App initialPrompt={prompt} resumeSessionId={resumeSessionId} />,
    );

    try {
        await instance.waitUntilExit();
    } finally {
        instance.cleanup();

        if (shouldManageTerminal) {
            process.stdout.write(EXIT_ALTERNATE_SCREEN);
        }
    }
}

void main();
