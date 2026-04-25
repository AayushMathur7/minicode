import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { type ActiveRunState } from "../../runtime/sessionTypes";

type Props = {
    state: ActiveRunState;
};

function formatElapsed(startedAt: number): string {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

    if (elapsedSeconds < 60) {
        return `${elapsedSeconds}s`;
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${minutes}m ${seconds}s`;
}

function getAnimationFrames(inlineStatus: string | undefined): string[] {
    if (!inlineStatus) {
        return ["•"];
    }

    if (inlineStatus.startsWith("thinking")) {
        return ["⠋", "⠙", "⠸", "⠴", "⠦", "⠇"];
    }

    if (inlineStatus.startsWith("writing")) {
        return ["▌", "▐"];
    }

    if (inlineStatus.startsWith("preparing")) {
        return ["→··", "·→·", "··→", "·→·"];
    }

    if (
        inlineStatus.startsWith("running")
        || inlineStatus.startsWith("reading")
        || inlineStatus.startsWith("searching")
        || inlineStatus.startsWith("reviewing")
    ) {
        return ["▮▯▯", "▯▮▯", "▯▯▮", "▯▮▯"];
    }

    return ["•"];
}

function getStatusColor(inlineStatus: string | undefined): "yellow" | "cyan" | "green" | "magenta" {
    if (!inlineStatus) {
        return "yellow";
    }

    if (inlineStatus.startsWith("thinking")) {
        return "cyan";
    }

    if (inlineStatus.startsWith("writing")) {
        return "magenta";
    }

    if (
        inlineStatus.startsWith("running")
        || inlineStatus.startsWith("reading")
        || inlineStatus.startsWith("searching")
        || inlineStatus.startsWith("preparing")
        || inlineStatus.startsWith("reviewing")
    ) {
        return "green";
    }

    return "yellow";
}

export function InlineRunStatus({ state }: Props): React.ReactElement | null {
    const [frameIndex, setFrameIndex] = useState(0);
    const frames = getAnimationFrames(state.inlineStatus);

    useEffect(() => {
        if (state.status !== "running") {
            return;
        }

        const interval = setInterval(() => {
            setFrameIndex((current) => (current + 1) % frames.length);
        }, 120);

        return () => {
            clearInterval(interval);
        };
    }, [frames.length, state.status]);

    if (
        state.status === "idle" ||
        state.status === "completed" ||
        state.status === "cancelled" ||
        state.status === "failed"
    ) {
        return null;
    }

    if (state.status === "awaiting_permission" || state.status === "awaiting_plan_approval") {
        return (
            <Text color="yellow">
                • {state.inlineStatus ?? "waiting for input"}
            </Text>
        );
    }

    const elapsed = state.startedAt ? formatElapsed(state.startedAt) : undefined;
    const color = getStatusColor(state.inlineStatus);
    const frame = frames[frameIndex % frames.length] ?? "•";

    return (
        <Text color={color}>
            {frame} {state.inlineStatus ?? "working"}
            {elapsed ? <Text dimColor={true}> ({elapsed})</Text> : null}
        </Text>
    );
}
