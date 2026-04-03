#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "../ui/App";

const ENTER_ALTERNATE_SCREEN = "\u001B[?1049h";
const EXIT_ALTERNATE_SCREEN = "\u001B[?1049l";
const CLEAR_AND_HOME = "\u001B[2J\u001B[H";

export async function main(): Promise<void> {
    const prompt = process.argv.slice(2).join(" ").trim();
    const shouldManageTerminal = Boolean(process.stdout.isTTY);

    if (shouldManageTerminal) {
        // Take over a clean terminal surface so Ink can redraw without leaving
        // the shell prompt or previous output visible behind the app.
        process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_AND_HOME}`);
    }

    const instance = render(<App initialPrompt={prompt || undefined} />);

    try {
        await instance.waitUntilExit();
    } finally {
        instance.cleanup();

        if (shouldManageTerminal) {
            // Restore the user's original terminal screen on exit.
            process.stdout.write(EXIT_ALTERNATE_SCREEN);
        }
    }
}

void main();
