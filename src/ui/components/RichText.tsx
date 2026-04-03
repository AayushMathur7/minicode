import React from "react";
import { marked, type Token, type Tokens } from "marked";
import { Box, Text } from "ink";
import { highlightCodeLine, renderCodeToken } from "./codeHighlight";

const TOKEN_CACHE_MAX = 200;
const tokenCache = new Map<string, Token[]>();
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
const PATH_LIKE_PATTERN =
    /(?:^|[\s(])((?:\.{1,2}\/)?(?:[\w@-]+\/)+[\w@.-]+(?:\.[A-Za-z0-9_-]+)?|[\w@.-]+\.(?:ts|tsx|js|jsx|json|md|css|html|py|sh|yml|yaml))(?=$|[\s),.:;!?])/g;

let markedConfigured = false;

/**
 * Claude Code configures `marked` once up front and keeps the markdown parser
 * as a stable shared utility. We do the same here so every transcript row
 * doesn't rebuild parser behavior from scratch.
 */
function configureMarked(): void {
    if (markedConfigured) {
        return;
    }

    markedConfigured = true;

    marked.use({
        tokenizer: {
            // Claude Code disables strikethrough parsing because models often
            // use `~` as "approximately", not as an actual formatting marker.
            del() {
                return undefined;
            },
        },
    });
}

function hasMarkdownSyntax(content: string): boolean {
    return MD_SYNTAX_RE.test(content.length > 500 ? content.slice(0, 500) : content);
}

/**
 * Tokenization is the hot path for message rendering. Claude Code keeps a
 * module-level token cache because transcript rows can remount frequently
 * during scrolling. This smaller cache gives us the same basic win.
 */
function cachedLexer(content: string): Token[] {
    configureMarked();

    if (!hasMarkdownSyntax(content)) {
        return [
            {
                type: "paragraph",
                raw: content,
                text: content,
                tokens: [
                    {
                        type: "text",
                        raw: content,
                        text: content,
                    },
                ],
            } as Token,
        ];
    }

    const cached = tokenCache.get(content);
    if (cached) {
        tokenCache.delete(content);
        tokenCache.set(content, cached);
        return cached;
    }

    const tokens = marked.lexer(content);
    if (tokenCache.size >= TOKEN_CACHE_MAX) {
        const oldestKey = tokenCache.keys().next().value;
        if (oldestKey !== undefined) {
            tokenCache.delete(oldestKey);
        }
    }

    tokenCache.set(content, tokens);
    return tokens;
}

function renderTextWithPathHighlight(content: string, keyPrefix: string): React.ReactElement[] {
    const elements: React.ReactElement[] = [];
    let lastIndex = 0;
    let matchIndex = 0;

    for (const match of content.matchAll(PATH_LIKE_PATTERN)) {
        const matchedValue = match[1];

        if (!matchedValue) {
            continue;
        }

        const fullMatch = match[0] ?? matchedValue;
        const fullMatchIndex = match.index ?? 0;
        const valueIndex = fullMatch.lastIndexOf(matchedValue);
        const startIndex = fullMatchIndex + Math.max(0, valueIndex);

        if (startIndex > lastIndex) {
            elements.push(
                <Text key={`${keyPrefix}-text-${matchIndex}`}>
                    {content.slice(lastIndex, startIndex)}
                </Text>,
            );
        }

        elements.push(
            <Text key={`${keyPrefix}-path-${matchIndex}`} color="cyan" inverse={true}>
                {matchedValue}
            </Text>,
        );

        lastIndex = startIndex + matchedValue.length;
        matchIndex += 1;
    }

    if (lastIndex < content.length) {
        elements.push(
            <Text key={`${keyPrefix}-tail`}>
                {content.slice(lastIndex)}
            </Text>,
        );
    }

    return elements.length > 0
        ? elements
        : [<Text key={`${keyPrefix}-plain`}>{content}</Text>];
}

function renderInlineCode(content: string, key: string): React.ReactElement {
    return (
        <Text key={key} color="cyan" inverse={true}>
            {highlightCodeLine(content).map((token, tokenIndex) =>
                renderCodeToken(token, tokenIndex, {
                    inverse: true,
                }),
            )}
        </Text>
    );
}

function renderInlineTokens(tokens: Token[] | undefined, keyPrefix: string): React.ReactNode[] {
    if (!tokens || tokens.length === 0) {
        return [];
    }

    return tokens.flatMap((token, index) => {
        const key = `${keyPrefix}-${index}`;

        switch (token.type) {
            case "text":
                return renderTextWithPathHighlight(token.text, key);
            case "codespan":
                return [renderInlineCode(token.text, key)];
            case "strong":
                return [
                    <Text key={key} bold={true}>
                        {renderInlineTokens(token.tokens, `${key}-strong`)}
                    </Text>,
                ];
            case "em":
                return [
                    <Text key={key} dimColor={true}>
                        {renderInlineTokens(token.tokens, `${key}-em`)}
                    </Text>,
                ];
            case "link":
                return [
                    <Text key={key} color="blue" underline={true}>
                        {renderInlineTokens(token.tokens, `${key}-link`)}
                    </Text>,
                ];
            case "br":
                return [<Text key={key}>{"\n"}</Text>];
            case "escape":
                return [<Text key={key}>{token.text}</Text>];
            default:
                if ("tokens" in token && Array.isArray(token.tokens)) {
                    return [
                        <Text key={key}>
                            {renderInlineTokens(token.tokens, `${key}-nested`)}
                        </Text>,
                    ];
                }

                if ("text" in token && typeof token.text === "string") {
                    return renderTextWithPathHighlight(token.text, key);
                }

                return [];
        }
    });
}

function renderCodeBlock(content: string, language: string | undefined): React.ReactElement {
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

function renderParagraph(token: Tokens.Paragraph, key: string): React.ReactElement {
    return (
        <Text key={key}>
            {renderInlineTokens(token.tokens, `${key}-inline`)}
        </Text>
    );
}

function renderHeading(token: Tokens.Heading, key: string): React.ReactElement {
    return (
        <Text key={key} bold={true} color={token.depth <= 2 ? "cyan" : undefined}>
            {renderInlineTokens(token.tokens, `${key}-heading`)}
        </Text>
    );
}

function renderList(token: Tokens.List, key: string): React.ReactElement {
    return (
        <Box key={key} flexDirection="column">
            {token.items.map((item, index) => {
                const start = typeof token.start === "number" ? token.start : 1;
                const marker = token.ordered ? `${start + index}.` : "-";
                return (
                    <Box key={`${key}-item-${index}`} paddingLeft={1}>
                        <Text dimColor={true}>{`${marker} `}</Text>
                        <Box flexDirection="column">
                            {renderBlockTokens(item.tokens, `${key}-item-${index}`)}
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}

function renderBlockquote(token: Tokens.Blockquote, key: string): React.ReactElement {
    return (
        <Box key={key} flexDirection="column" paddingLeft={1}>
            {renderBlockTokens(token.tokens, `${key}-blockquote`).map((node, index) => (
                <Box key={`${key}-line-${index}`}>
                    <Text dimColor={true}>│ </Text>
                    <Box flexDirection="column">{node}</Box>
                </Box>
            ))}
        </Box>
    );
}

function renderBlockTokens(tokens: Token[] | undefined, keyPrefix: string): React.ReactElement[] {
    if (!tokens || tokens.length === 0) {
        return [];
    }

    return tokens.flatMap((token, index) => {
        const key = `${keyPrefix}-${index}`;

        switch (token.type) {
            case "paragraph":
                return [renderParagraph(token as Tokens.Paragraph, key)];
            case "heading":
                return [renderHeading(token as Tokens.Heading, key)];
            case "code":
                return [renderCodeBlock(token.text, token.lang)];
            case "list":
                return [renderList(token as Tokens.List, key)];
            case "blockquote":
                return [renderBlockquote(token as Tokens.Blockquote, key)];
            case "hr":
                return [<Text key={key} dimColor={true}>---</Text>];
            case "space":
                return [];
            case "text":
                return [
                    <Text key={key}>
                        {renderInlineTokens([token], `${key}-text`)}
                    </Text>,
                ];
            default:
                if ("tokens" in token && Array.isArray(token.tokens)) {
                    return [
                        <Text key={key}>
                            {renderInlineTokens(token.tokens, `${key}-fallback`)}
                        </Text>,
                    ];
                }

                return [];
        }
    });
}

type Props = {
    content: string;
};

export function RichText({ content }: Props): React.ReactElement {
    const tokens = cachedLexer(content);
    const blocks = renderBlockTokens(tokens, "block");

    return (
        <Box flexDirection="column">
            {blocks.length > 0 ? blocks : <Text>{content}</Text>}
        </Box>
    );
}
