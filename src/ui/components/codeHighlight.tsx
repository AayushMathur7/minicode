import React from "react";
import { Text } from "ink";

type CodeColor = "white" | "red" | "green" | "cyan" | "magenta" | "yellow" | "blue";

export type CodeToken =
    | { type: "plain"; value: string }
    | { type: "keyword"; value: string }
    | { type: "string"; value: string }
    | { type: "number"; value: string }
    | { type: "comment"; value: string }
    | { type: "function"; value: string }
    | { type: "type"; value: string }
    | { type: "builtin"; value: string }
    | { type: "property"; value: string }
    | { type: "operator"; value: string }
    | { type: "decorator"; value: string }
    | { type: "literal"; value: string };

const KEYWORDS = new Set([
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "default",
    "delete",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "interface",
    "let",
    "new",
    "of",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "static",
    "switch",
    "throw",
    "try",
    "type",
    "typeof",
    "var",
    "while",
]);

const LITERALS = new Set([
    "false",
    "null",
    "true",
    "undefined",
]);

const BUILTINS = new Set([
    "Array",
    "Boolean",
    "Date",
    "Error",
    "JSON",
    "Map",
    "Math",
    "Number",
    "Object",
    "Promise",
    "RegExp",
    "Set",
    "String",
    "console",
    "process",
]);

const OPERATORS = [
    "=>",
    "===",
    "!==",
    "==",
    "!=",
    ">=",
    "<=",
    "&&",
    "||",
    "??",
    "?.",
    "++",
    "--",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "=",
    "+",
    "-",
    "*",
    "/",
    "%",
    ">",
    "<",
    "!",
    "?",
    ":",
];

function isIdentifierStart(char: string): boolean {
    return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
    return /[A-Za-z0-9_$]/.test(char);
}

function isDigit(char: string): boolean {
    return /\d/.test(char);
}

function readWhile(line: string, start: number, predicate: (char: string) => boolean): number {
    let index = start;

    while (index < line.length && predicate(line[index]!)) {
        index += 1;
    }

    return index;
}

function findPreviousMeaningfulCharacter(line: string, start: number): string | undefined {
    for (let index = start - 1; index >= 0; index -= 1) {
        const char = line[index]!;
        if (!/\s/.test(char)) {
            return char;
        }
    }

    return undefined;
}

function findNextMeaningfulCharacter(line: string, start: number): string | undefined {
    for (let index = start; index < line.length; index += 1) {
        const char = line[index]!;
        if (!/\s/.test(char)) {
            return char;
        }
    }

    return undefined;
}

function pushToken(tokens: CodeToken[], nextToken: CodeToken): void {
    const previousToken = tokens[tokens.length - 1];

    if (previousToken?.type === "plain" && nextToken.type === "plain") {
        previousToken.value += nextToken.value;
        return;
    }

    tokens.push(nextToken);
}

function readString(line: string, start: number, quote: string): number {
    let index = start + 1;
    let escaped = false;

    while (index < line.length) {
        const char = line[index]!;

        if (escaped) {
            escaped = false;
            index += 1;
            continue;
        }

        if (char === "\\") {
            escaped = true;
            index += 1;
            continue;
        }

        if (char === quote) {
            return index + 1;
        }

        index += 1;
    }

    return line.length;
}

function readNumber(line: string, start: number): number {
    if (line[start] === "0" && /[xXbBoO]/.test(line[start + 1] ?? "")) {
        return readWhile(line, start + 2, (char) => /[A-Fa-f0-9_]/.test(char));
    }

    let index = readWhile(line, start, (char) => /[\d_]/.test(char));

    if (line[index] === "." && isDigit(line[index + 1] ?? "")) {
        index += 1;
        index = readWhile(line, index, (char) => /[\d_]/.test(char));
    }

    return index;
}

function classifyIdentifier(
    line: string,
    value: string,
    start: number,
    end: number,
): CodeToken["type"] {
    if (KEYWORDS.has(value)) {
        return "keyword";
    }

    if (LITERALS.has(value)) {
        return "literal";
    }

    if (BUILTINS.has(value)) {
        return "builtin";
    }

    const previousCharacter = findPreviousMeaningfulCharacter(line, start);
    const nextCharacter = findNextMeaningfulCharacter(line, end);

    if (previousCharacter === "@" || line[start - 1] === "@") {
        return "decorator";
    }

    if (previousCharacter === ".") {
        return nextCharacter === "(" ? "function" : "property";
    }

    if (nextCharacter === "(") {
        return "function";
    }

    if (/^[A-Z]/.test(value)) {
        return "type";
    }

    return "plain";
}

function readOperator(line: string, start: number): string | undefined {
    return OPERATORS.find((operator) => line.startsWith(operator, start));
}

export function highlightCodeLine(line: string): CodeToken[] {
    const trimmedLine = line.trimStart();

    if (trimmedLine.startsWith("#")) {
        return [{ type: "comment", value: line }];
    }

    const tokens: CodeToken[] = [];
    let index = 0;

    while (index < line.length) {
        const char = line[index]!;

        if (char === "/" && line[index + 1] === "/") {
            pushToken(tokens, {
                type: "comment",
                value: line.slice(index),
            });
            break;
        }

        if (char === "\"" || char === "'" || char === "`") {
            const end = readString(line, index, char);
            pushToken(tokens, {
                type: "string",
                value: line.slice(index, end),
            });
            index = end;
            continue;
        }

        if (char === "@" && isIdentifierStart(line[index + 1] ?? "")) {
            const end = readWhile(line, index + 1, isIdentifierPart);
            pushToken(tokens, {
                type: "decorator",
                value: line.slice(index, end),
            });
            index = end;
            continue;
        }

        if (isDigit(char)) {
            const end = readNumber(line, index);
            pushToken(tokens, {
                type: "number",
                value: line.slice(index, end),
            });
            index = end;
            continue;
        }

        if (isIdentifierStart(char)) {
            const end = readWhile(line, index, isIdentifierPart);
            const value = line.slice(index, end);
            pushToken(tokens, {
                type: classifyIdentifier(line, value, index, end),
                value,
            });
            index = end;
            continue;
        }

        const operator = readOperator(line, index);
        if (operator) {
            pushToken(tokens, {
                type: "operator",
                value: operator,
            });
            index += operator.length;
            continue;
        }

        pushToken(tokens, {
            type: "plain",
            value: char,
        });
        index += 1;
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
        case "function":
            return (
                <Text key={index} color="yellow" inverse={inverse} bold={true}>
                    {token.value}
                </Text>
            );
        case "type":
            return (
                <Text key={index} color="blue" inverse={inverse} bold={true}>
                    {token.value}
                </Text>
            );
        case "builtin":
            return (
                <Text key={index} color="magenta" inverse={inverse}>
                    {token.value}
                </Text>
            );
        case "property":
            return (
                <Text key={index} color="yellow" inverse={inverse}>
                    {token.value}
                </Text>
            );
        case "operator":
            return (
                <Text key={index} color="cyan" inverse={inverse} bold={bold}>
                    {token.value}
                </Text>
            );
        case "decorator":
            return (
                <Text key={index} color="red" inverse={inverse} bold={true}>
                    {token.value}
                </Text>
            );
        case "literal":
            return (
                <Text key={index} color="magenta" inverse={inverse} bold={true}>
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
