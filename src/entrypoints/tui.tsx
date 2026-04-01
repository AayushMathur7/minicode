#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "../ui/App";

const ENTER_ALTERNATE_SCREEN = "\u001B[?1049h";
const EXIT_ALTERNATE_SCREEN = "\u001B[?1049l";
const CLEAR_SCREEN_AND_HOME = "\u001B[2J\u001B[H";

function enterAlternateScreen(): (() => void) | undefined {
    if (!process.stdout.isTTY) {
        return undefined;
    }

    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    process.stdout.write(CLEAR_SCREEN_AND_HOME);

    let restored = false;

    return () => {
        if (restored) {
            return;
        }

        restored = true;
        process.stdout.write(CLEAR_SCREEN_AND_HOME);
        process.stdout.write(EXIT_ALTERNATE_SCREEN);
    };
}

export async function main(): Promise<void> {
    const prompt = process.argv.slice(2).join(" ").trim();
    const restoreScreen = enterAlternateScreen();
    const instance = render(<App initialPrompt={prompt || undefined} />);

    try {
        await instance.waitUntilExit();
    } finally {
        restoreScreen?.();
        instance.cleanup();
    }
}

void main();
