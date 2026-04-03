import React from "react";
import { Box, Text } from "ink";

export type SlashCommandDef = {
    name: string;
    description: string;
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
    { name: "plan", description: "Switch to plan mode" },
    { name: "execute", description: "Switch to execute mode" },
    { name: "compact", description: "Compact older context" },
    { name: "clear", description: "Clear the transcript" },
    { name: "sessions", description: "List previous sessions" },
    { name: "resume", description: "Resume a previous session" },
    { name: "search", description: "Search across all sessions" },
    { name: "help", description: "Show available commands" },
    { name: "quit", description: "Exit minicode" },
];

export function getMatchingCommands(input: string): SlashCommandDef[] {
    // Input should start with "/" — match against what follows
    const query = input.slice(1).toLowerCase();
    if (query === "") return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query));
}

type Props = {
    matches: SlashCommandDef[];
    selectedIndex: number;
};

export function SlashCommandMenu({ matches, selectedIndex }: Props): React.ReactElement | null {
    if (matches.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
            {matches.map((cmd, i) => {
                const isSelected = i === selectedIndex;
                return (
                    <Box key={cmd.name}>
                        <Text
                            bold={isSelected}
                            color={isSelected ? "cyan" : undefined}
                        >
                            {isSelected ? "❯ " : "  "}
                        </Text>
                        <Text
                            bold={isSelected}
                            color={isSelected ? "cyan" : "white"}
                        >
                            /{cmd.name}
                        </Text>
                        <Text dimColor>  {cmd.description}</Text>
                    </Box>
                );
            })}
        </Box>
    );
}
