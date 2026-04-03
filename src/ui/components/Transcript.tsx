import React from "react";
import { Box, Text } from "ink";
import { type TranscriptEntry } from "../state";
import { RichText } from "./RichText";

type Props = {
    transcript: TranscriptEntry[];
    showEarlier?: boolean;
    showLater?: boolean;
};

function getToolCallAccent(toolName: string | undefined): {
    marker: string;
    color: "cyan" | "green" | "magenta" | "yellow";
} {
    switch (toolName) {
        case "search_code":
        case "read_file":
        case "read_file_range":
        case "get_file_outline":
            return { marker: "→", color: "green" };
        case "apply_patch":
        case "write_file":
        case "write_plan":
            return { marker: "→", color: "magenta" };
        case "run_typecheck":
        case "run_tests":
        case "run_command":
            return { marker: "▮", color: "green" };
        case "enter_plan_mode":
        case "exit_plan_mode":
            return { marker: "⇄", color: "yellow" };
        default:
            return { marker: "→", color: "cyan" };
    }
}

function getToolResultAccent(toolName: string | undefined): {
    marker: string;
    color: "cyan" | "green" | "magenta" | "yellow";
} {
    switch (toolName) {
        case "search_code":
        case "read_file":
        case "read_file_range":
        case "get_file_outline":
            return { marker: "└", color: "green" };
        case "apply_patch":
        case "write_file":
        case "write_plan":
            return { marker: "└", color: "magenta" };
        case "run_typecheck":
        case "run_tests":
        case "run_command":
            return { marker: "└", color: "green" };
        case "enter_plan_mode":
        case "exit_plan_mode":
            return { marker: "└", color: "yellow" };
        default:
            return { marker: "└", color: "cyan" };
    }
}

export function Transcript({
    transcript,
    showEarlier = false,
    showLater = false,
}: Props): React.ReactElement {
    return (
        <Box flexDirection="column">
            {showEarlier ? <Text dimColor={true}>↑ earlier messages</Text> : null}
            {transcript.length === 0 ? (
                <Text dimColor={true}>What should I help with?</Text>
            ) : (
                transcript.map((entry, index) => {
                    const prevEntry = index > 0 ? transcript[index - 1] : undefined;
                    const nextEntry = index < transcript.length - 1 ? transcript[index + 1] : undefined;
                    const isToolCall = entry.role === "tool_call";
                    const isToolResult = entry.role === "tool_result";
                    const prevIsToolCall = prevEntry?.role === "tool_call";
                    const prevIsToolGroup = prevEntry?.role === "tool_call" || prevEntry?.role === "tool_result";
                    const nextIsToolGroup = nextEntry?.role === "tool_call" || nextEntry?.role === "tool_result";
                    const toolCallAccent = getToolCallAccent(entry.toolName);
                    const toolResultAccent = getToolResultAccent(entry.toolName);

                    return (
                        <Box
                            key={entry.id}
                            flexDirection="column"
                            marginBottom={
                                index === transcript.length - 1
                                    ? 0
                                    : (isToolCall || isToolResult) && nextIsToolGroup
                                        ? 0
                                        : 1
                            }
                        >
                            {entry.role === "user" ? (
                                <Text inverse={true}>
                                    {`› ${entry.content}`}
                                </Text>
                            ) : entry.role === "system" ? (
                                <Text dimColor={true}>
                                    {entry.content}
                                </Text>
                            ) : entry.role === "model_note" ? (
                                <Box paddingLeft={1}>
                                    <Text color="cyan" dimColor={true}>› </Text>
                                    <Box flexDirection="column">
                                        <Text dimColor={true}>{entry.content}</Text>
                                        {entry.isStreaming ? <Text color="cyan" dimColor={true}>›</Text> : null}
                                    </Box>
                                </Box>
                            ) : entry.role === "tool_call" ? (
                                <Box paddingLeft={1}>
                                    <Text color={toolCallAccent.color}>
                                        {prevIsToolCall ? "  " : `${toolCallAccent.marker} `}
                                    </Text>
                                    <Text color={toolCallAccent.color} bold={true}>
                                        {entry.content}
                                    </Text>
                                </Box>
                            ) : entry.role === "tool_result" ? (
                                <Box paddingLeft={3}>
                                    <Text color={toolResultAccent.color} dimColor={true}>
                                        {toolResultAccent.marker}{" "}
                                    </Text>
                                    <Text color={toolResultAccent.color} dimColor={true}>
                                        {entry.content}
                                    </Text>
                                </Box>
                            ) : (
                                <Box>
                                    <Text color={entry.isStreaming ? "magenta" : undefined} dimColor={!entry.isStreaming}>
                                        {entry.isStreaming ? "▌ " : "• "}
                                    </Text>
                                    <Box flexDirection="column">
                                        <RichText content={entry.content} />
                                        {entry.isStreaming ? <Text color="magenta">▌</Text> : null}
                                    </Box>
                                </Box>
                            )}
                        </Box>
                    );
                })
            )}
            {showLater ? <Text dimColor={true}>↓ newer messages</Text> : null}
        </Box>
    );
}
