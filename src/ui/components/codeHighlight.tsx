import React from "react";
import { Text } from "ink";

type CodeColor = "white" | "red" | "green" | "cyan" | "magenta";

export type CodeToken =
    | { type: "plain"; value: string }
    | { type: "keyword"; value: string }
    | { type: "string"; value: string }
    | { type: "number"; value: string }
    | { type: "comment"; value: string };

const KEYWORDS = new Set([
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "else",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "interface",
    "let",
    "new",
    "null",
    "return",
    "switch",
    "throw",
    "true",
    "try",
    "type",
    "undefined",
    "var",
    "while",
]);

export function highlightCodeLine(line: string): CodeToken[] {
    const trimmedLine = line.trimStart();

    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("#")) {
        return [{ type: "comment", value: line }];
    }

    const tokens: CodeToken[] = [];
    const tokenPattern =
        /\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b/g;

    let lastIndex = 0;

    for (const match of line.matchAll(tokenPattern)) {
        const index = match.index ?? 0;
        const value = match[0];

        if (index > lastIndex) {
            tokens.push({
                type: "plain",
                value: line.slice(lastIndex, index),
            });
        }

        if (value.startsWith("//")) {
            tokens.push({ type: "comment", value });
        } else if (
            value.startsWith("\"") ||
            value.startsWith("'") ||
            value.startsWith("`")
        ) {
            tokens.push({ type: "string", value });
        } else if (/^\d/.test(value)) {
            tokens.push({ type: "number", value });
        } else if (KEYWORDS.has(value)) {
            tokens.push({ type: "keyword", value });
        } else {
            tokens.push({ type: "plain", value });
        }

        lastIndex = index + value.length;
    }

    if (lastIndex < line.length) {
        tokens.push({
            type: "plain",
            value: line.slice(lastIndex),
        });
    }

    return tokens;
}

export function renderCodeToken(
    token: CodeToken,
    index: number,
    options: {
        dimPlain?: boolean;
        plainColor?: CodeColor;
        inverse?: boolean;
        bold?: boolean;
    } = {},
): React.ReactElement {
    const {
        dimPlain = false,
        plainColor,
        inverse = false,
        bold = false,
    } = options;

    switch (token.type) {
        case "keyword":
            return (
                <Text key={index} color="cyan" bold={true} inverse={inverse}>
                    {token.value}
                </Text>
            );
        case "string":
            return (
                <Text key={index} color="green" inverse={inverse} bold={bold}>
                    {token.value}
                </Text>
            );
        case "number":
            return (
                <Text key={index} color="magenta" inverse={inverse} bold={bold}>
                    {token.value}
                </Text>
            );
        case "comment":
            return (
                <Text key={index} dimColor={true} inverse={inverse}>
                    {token.value}
                </Text>
            );
        default:
            return dimPlain
                ? (
                    <Text key={index} dimColor={true} inverse={inverse} bold={bold}>
                        {token.value}
                    </Text>
                )
                : (
                    <Text key={index} color={plainColor} inverse={inverse} bold={bold}>
                        {token.value}
                    </Text>
                );
    }
}
