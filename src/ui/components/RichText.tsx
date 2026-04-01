import React from "react";
import { Box, Text } from "ink";
import { highlightCodeLine, renderCodeToken } from "./codeHighlight";

type Segment =
    | { type: "text"; content: string }
    | { type: "code"; language?: string; content: string };

function splitIntoSegments(content: string): Segment[] {
    const segments: Segment[] = [];
    const codeBlockPattern = /```([\w+-]+)?\n([\s\S]*?)```/g;
    let lastIndex = 0;

    for (const match of content.matchAll(codeBlockPattern)) {
        const matchIndex = match.index ?? 0;

        if (matchIndex > lastIndex) {
            segments.push({
                type: "text",
                content: content.slice(lastIndex, matchIndex).trim(),
            });
        }

        segments.push({
            type: "code",
            language: match[1],
            content: match[2]?.trimEnd() ?? "",
        });

        lastIndex = matchIndex + match[0].length;
    }

    if (lastIndex < content.length) {
        segments.push({
            type: "text",
            content: content.slice(lastIndex).trim(),
        });
    }

    return segments.filter((segment) => segment.content.length > 0);
}

function renderTextBlock(content: string): React.ReactElement {
    const lines = content.split("\n").filter((line) => line.trim().length > 0);

    return (
        <Box flexDirection="column">
            {lines.map((line, index) => (
                <Text key={index}>{line}</Text>
            ))}
        </Box>
    );
}

function renderCodeBlock(
    content: string,
    language: string | undefined,
): React.ReactElement {
    const lines = content.split("\n");

    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Text dimColor={true}>{language ? `code ${language}` : "code"}</Text>
            {lines.map((line, index) => (
                    <Text key={index}>
                        <Text dimColor={true}>  </Text>
                        {highlightCodeLine(line).map((token, tokenIndex) =>
                            renderCodeToken(token, tokenIndex),
                        )}
                    </Text>
                ))}
        </Box>
    );
}

type Props = {
    content: string;
};

export function RichText({ content }: Props): React.ReactElement {
    const segments = splitIntoSegments(content);

    if (segments.length === 0) {
        return <Text>{content}</Text>;
    }

    return (
        <Box flexDirection="column">
            {segments.map((segment, index) => (
                <Box key={index} flexDirection="column">
                    {segment.type === "text"
                        ? renderTextBlock(segment.content)
                        : renderCodeBlock(segment.content, segment.language)}
                </Box>
            ))}
        </Box>
    );
}
