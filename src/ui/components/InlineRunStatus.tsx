import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { type ActiveRunState } from "../state";

type Props = {
    state: ActiveRunState;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠸", "⠴", "⠦", "⠇"];

function formatElapsed(startedAt: number): string {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

    if (elapsedSeconds < 60) {
        return `${elapsedSeconds}s`;
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${minutes}m ${seconds}s`;
}

export function InlineRunStatus({ state }: Props): React.ReactElement | null {
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
        if (state.status !== "running") {
            return;
        }

        const interval = setInterval(() => {
            setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
        }, 120);

        return () => {
            clearInterval(interval);
        };
    }, [state.status]);

    if (
        state.status === "idle" ||
        state.status === "completed" ||
        state.status === "cancelled" ||
        state.status === "failed"
    ) {
        return null;
    }

    if (state.status === "awaiting_permission") {
        return (
            <Text color="yellow">
                • {state.inlineStatus ?? "waiting for permission"}
            </Text>
        );
    }

    const elapsed = state.startedAt ? formatElapsed(state.startedAt) : undefined;

    return (
        <Text color="yellow">
            {SPINNER_FRAMES[frameIndex]} {state.inlineStatus ?? "working"}
            {elapsed ? <Text dimColor={true}> ({elapsed})</Text> : null}
        </Text>
    );
}
