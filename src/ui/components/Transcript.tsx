import React from "react";
import { Box, Text } from "ink";
import { type TranscriptEntry } from "../state";
import { RichText } from "./RichText";

type Props = {
    transcript: TranscriptEntry[];
    hiddenAboveCount?: number;
    hiddenBelowCount?: number;
};

export function Transcript({
    transcript,
    hiddenAboveCount = 0,
    hiddenBelowCount = 0,
}: Props): React.ReactElement {
    return (
        <Box flexDirection="column">
            {hiddenAboveCount > 0 ? (
                <Text dimColor={true}>↑ {hiddenAboveCount} earlier {hiddenAboveCount === 1 ? "message" : "messages"}</Text>
            ) : null}
            {transcript.length === 0 ? (
                <Text dimColor={true}>What should I help with?</Text>
            ) : (
                transcript.map((entry, index) => (
                    <Box
                        key={entry.id}
                        flexDirection="column"
                        marginBottom={index === transcript.length - 1 ? 0 : 1}
                    >
                        {entry.role === "user" ? (
                            <Text inverse={true}>
                                {`› ${entry.content}`}
                            </Text>
                        ) : entry.role === "system" ? (
                            <Text dimColor={true}>
                                {entry.content}
                            </Text>
                        ) : (
                            <Box>
                                <Text dimColor={true}>• </Text>
                                <Box flexDirection="column">
                                    <RichText content={entry.content} />
                                </Box>
                            </Box>
                        )}
                    </Box>
                ))
            )}
            {hiddenBelowCount > 0 ? (
                <Text dimColor={true}>↓ {hiddenBelowCount} newer {hiddenBelowCount === 1 ? "message" : "messages"}</Text>
            ) : null}
        </Box>
    );
}
