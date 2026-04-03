import React from "react";
import { Box, Text } from "ink";

export type SessionPickerItem = {
    id: string;
    title: string;
    firstPrompt: string;
    modified: Date;
};

type Props = {
    sessions: SessionPickerItem[];
    selectedIndex: number;
    formatTimeAgo: (date: Date) => string;
};

export function SessionPicker({ sessions, selectedIndex, formatTimeAgo }: Props): React.ReactElement | null {
    if (sessions.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
            <Box marginBottom={1}>
                <Text bold color="cyan">Resume a session</Text>
                <Text dimColor>  (Up/Down to navigate, Enter to select, Esc to cancel)</Text>
            </Box>
            {sessions.slice(0, 15).map((session, i) => {
                const isSelected = i === selectedIndex;
                const ago = formatTimeAgo(session.modified);
                const displayName = session.title || session.firstPrompt;
                const truncated = displayName.length > 55
                    ? displayName.slice(0, 52) + "..."
                    : displayName;
                return (
                    <Box key={session.id}>
                        <Text bold={isSelected} color={isSelected ? "cyan" : undefined}>
                            {isSelected ? "❯ " : "  "}
                        </Text>
                        <Text bold={isSelected} color={isSelected ? "cyan" : "white"}>
                            {truncated}
                        </Text>
                        <Text dimColor>  {ago}</Text>
                    </Box>
                );
            })}
        </Box>
    );
}
