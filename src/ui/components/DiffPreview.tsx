import React from "react";
import { Box, Text } from "ink";
import { diffWords, parsePatch, type StructuredPatch } from "diff";
import { type DiffPreviewState } from "../../runtime/sessionTypes";
import { highlightCodeLine, renderCodeToken } from "./codeHighlight";

type Props = {
    diffPreview?: DiffPreviewState;
};

type DiffLine = {
    marker: " " | "+" | "-";
    oldLine?: number;
    newLine?: number;
    content: string;
};

type DiffHunkModel = {
    header: string;
    lines: DiffLine[];
};

type DiffModel = {
    meta: string[];
    hunks: DiffHunkModel[];
    added: number;
    removed: number;
    gutterWidth: number;
};

const DIFF_MODEL_CACHE = new Map<string, DiffModel>();
const MAX_CACHED_MODELS = 20;
const ADDED_LINE_BG = "#11281c";
const REMOVED_LINE_BG = "#301515";
const ADDED_WORD_BG = "#1b5e20";
const REMOVED_WORD_BG = "#7f1d1d";

function getDisplayPath(path: string): string {
    return path.startsWith(process.cwd()) ? path.replace(`${process.cwd()}/`, "") : path;
}

function getHunkHeader(hunk: StructuredPatch["hunks"][number]): string {
    if (hunk.oldStart === 0 && hunk.newStart === 0) {
        return "@@";
    }

    return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

function buildHunkModel(hunk: StructuredPatch["hunks"][number]): DiffHunkModel {
    const lines: DiffLine[] = [];
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const rawLine of hunk.lines) {
        const marker = rawLine[0] as " " | "+" | "-";
        const content = rawLine.slice(1);

        if (marker === " ") {
            lines.push({
                marker,
                oldLine,
                newLine,
                content,
            });
            oldLine += 1;
            newLine += 1;
            continue;
        }

        if (marker === "-") {
            lines.push({
                marker,
                oldLine,
                content,
            });
            oldLine += 1;
            continue;
        }

        lines.push({
            marker,
            newLine,
            content,
        });
        newLine += 1;
    }

    return {
        header: getHunkHeader(hunk),
        lines,
    };
}

function getMaxLineNumber(hunks: DiffHunkModel[]): number {
    let maxLine = 1;

    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            if (line.oldLine !== undefined) {
                maxLine = Math.max(maxLine, line.oldLine);
            }

            if (line.newLine !== undefined) {
                maxLine = Math.max(maxLine, line.newLine);
            }
        }
    }

    return maxLine;
}

function countChanges(hunks: DiffHunkModel[]): { added: number; removed: number } {
    let added = 0;
    let removed = 0;

    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            if (line.marker === "+") {
                added += 1;
            } else if (line.marker === "-") {
                removed += 1;
            }
        }
    }

    return { added, removed };
}

/**
 * Parse the unified diff string once and cache the structured row model.
 *
 * This mirrors the Claude Code idea of separating:
 * 1) patch understanding
 * 2) row modeling
 * 3) row rendering
 *
 * The cache keeps re-renders cheap while the permission prompt or transcript updates.
 */
function getDiffModel(preview: string): DiffModel {
    const cached = DIFF_MODEL_CACHE.get(preview);
    if (cached) {
        return cached;
    }

    const parsedPatches = parsePatch(preview);
    const patch = parsedPatches[0] as StructuredPatch | undefined;

    let model: DiffModel;

    if (!patch) {
        model = {
            meta: preview.split("\n").filter((line) => line.length > 0),
            hunks: [],
            added: 0,
            removed: 0,
            gutterWidth: 3,
        };
    } else {
        const meta = [patch.oldFileName, patch.newFileName].filter(
            (value): value is string => Boolean(value),
        );
        const hunks = patch.hunks.map(buildHunkModel);
        const { added, removed } = countChanges(hunks);

        model = {
            meta,
            hunks,
            added,
            removed,
            gutterWidth: Math.max(3, String(getMaxLineNumber(hunks)).length),
        };
    }

    if (DIFF_MODEL_CACHE.size >= MAX_CACHED_MODELS) {
        const firstKey = DIFF_MODEL_CACHE.keys().next().value;
        if (typeof firstKey === "string") {
            DIFF_MODEL_CACHE.delete(firstKey);
        }
    }

    DIFF_MODEL_CACHE.set(preview, model);
    return model;
}

function renderLineNumber(value: number | undefined, width: number): string {
    return value === undefined ? "".padStart(width, " ") : value.toString().padStart(width, " ");
}

function getLineBackground(marker: DiffLine["marker"]): string | undefined {
    if (marker === "+") {
        return ADDED_LINE_BG;
    }

    if (marker === "-") {
        return REMOVED_LINE_BG;
    }

    return undefined;
}

function renderGutter(
    oldLine: number | undefined,
    newLine: number | undefined,
    marker: DiffLine["marker"],
    width: number,
): React.ReactElement {
    const markerColor = marker === "+" ? "green" : marker === "-" ? "red" : "white";
    const backgroundColor = getLineBackground(marker);

    return (
        <Box width={width * 2 + 6} backgroundColor={backgroundColor}>
            <Text color={oldLine === undefined ? "gray" : "white"} dimColor={oldLine === undefined}>
                {renderLineNumber(oldLine, width)}
            </Text>
            <Text dimColor={true}> </Text>
            <Text color={newLine === undefined ? "gray" : "white"} dimColor={newLine === undefined}>
                {renderLineNumber(newLine, width)}
            </Text>
            <Text dimColor={true}> </Text>
            <Text color={markerColor}>{marker}</Text>
            <Text color="gray"> │ </Text>
        </Box>
    );
}

function renderGutterHeader(width: number): React.ReactElement {
    return (
        <Box width={width * 2 + 6}>
            <Text color="gray" bold={true}>
                {"old".padStart(width, " ")}
            </Text>
            <Text color="gray"> </Text>
            <Text color="gray" bold={true}>
                {"new".padStart(width, " ")}
            </Text>
            <Text color="gray">   │ </Text>
        </Box>
    );
}

function renderSyntaxLine(
    content: string,
    marker: DiffLine["marker"],
): React.ReactElement {
    const plainColor = marker === "+" ? "green" : marker === "-" ? "red" : "white";
    const dimPlain = marker === " ";
    const backgroundColor = getLineBackground(marker);

    return (
        <Text backgroundColor={backgroundColor}>
            {highlightCodeLine(content).map((token, tokenIndex) =>
                renderCodeToken(token, tokenIndex, {
                    dimPlain,
                    plainColor,
                }),
            )}
        </Text>
    );
}

function renderWordDiffLine(
    original: string,
    updated: string,
    mode: "-" | "+",
): React.ReactElement {
    const parts = diffWords(original, updated);
    const lineColor = mode === "+" ? "green" : "red";
    const lineBackground = mode === "+" ? ADDED_LINE_BG : REMOVED_LINE_BG;
    const changedBackground = mode === "+" ? ADDED_WORD_BG : REMOVED_WORD_BG;

    return (
        <Text backgroundColor={lineBackground}>
            {parts.map((part, index) => {
                if (mode === "-" && part.added) {
                    return null;
                }

                if (mode === "+" && part.removed) {
                    return null;
                }

                const isChanged = mode === "-" ? Boolean(part.removed) : Boolean(part.added);

                return (
                    <Text
                        key={index}
                        color={lineColor}
                        backgroundColor={isChanged ? changedBackground : lineBackground}
                        bold={isChanged}
                    >
                        {part.value}
                    </Text>
                );
            })}
        </Text>
    );
}

function renderSingleLineRow(
    line: DiffLine,
    key: string,
    gutterWidth: number,
): React.ReactElement {
    return (
        <Box key={key}>
            {renderGutter(line.oldLine, line.newLine, line.marker, gutterWidth)}
            {renderSyntaxLine(line.content, line.marker)}
        </Box>
    );
}

function renderChangedPair(
    removedLine: DiffLine,
    addedLine: DiffLine,
    key: string,
    gutterWidth: number,
): React.ReactElement {
    return (
        <Box key={key} flexDirection="column">
            <Box>
                {renderGutter(removedLine.oldLine, undefined, "-", gutterWidth)}
                {renderWordDiffLine(removedLine.content, addedLine.content, "-")}
            </Box>
            <Box>
                {renderGutter(undefined, addedLine.newLine, "+", gutterWidth)}
                {renderWordDiffLine(removedLine.content, addedLine.content, "+")}
            </Box>
        </Box>
    );
}

function renderHunkLines(
    lines: DiffLine[],
    gutterWidth: number,
    keyPrefix: string,
): React.ReactElement[] {
    const elements: React.ReactElement[] = [];
    let pendingRemoved: DiffLine[] = [];
    let pendingAdded: DiffLine[] = [];
    let localIndex = 0;

    const flushChangedBlock = () => {
        if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
            return;
        }

        const pairCount = Math.max(pendingRemoved.length, pendingAdded.length);

        for (let index = 0; index < pairCount; index += 1) {
            const removedLine = pendingRemoved[index];
            const addedLine = pendingAdded[index];

            if (removedLine && addedLine) {
                elements.push(
                    renderChangedPair(removedLine, addedLine, `${keyPrefix}-pair-${localIndex}`, gutterWidth),
                );
                localIndex += 1;
                continue;
            }

            if (removedLine) {
                elements.push(renderSingleLineRow(removedLine, `${keyPrefix}-removed-${localIndex}`, gutterWidth));
                localIndex += 1;
            }

            if (addedLine) {
                elements.push(renderSingleLineRow(addedLine, `${keyPrefix}-added-${localIndex}`, gutterWidth));
                localIndex += 1;
            }
        }

        pendingRemoved = [];
        pendingAdded = [];
    };

    for (const line of lines) {
        if (line.marker === "-") {
            pendingRemoved.push(line);
            continue;
        }

        if (line.marker === "+") {
            pendingAdded.push(line);
            continue;
        }

        flushChangedBlock();
        elements.push(renderSingleLineRow(line, `${keyPrefix}-context-${localIndex}`, gutterWidth));
        localIndex += 1;
    }

    flushChangedBlock();

    return elements;
}

function renderHunks(hunks: DiffHunkModel[], gutterWidth: number): React.ReactElement[] {
    const elements: React.ReactElement[] = [];

    hunks.forEach((hunk, index) => {
        if (index > 0) {
            elements.push(
                <Text key={`ellipsis-${index}`} color="gray" dimColor={true}>
                    ...
                </Text>,
            );
        }

        elements.push(
            <Text key={`hunk-${index}`} color="cyan" dimColor={true}>
                {hunk.header}
            </Text>,
        );
        elements.push(...renderHunkLines(hunk.lines, gutterWidth, `hunk-${index}`));
    });

    return elements;
}

export function DiffPreview({ diffPreview }: Props): React.ReactElement | null {
    if (!diffPreview) {
        return null;
    }

    const model = getDiffModel(diffPreview.preview);
    const displayPath = getDisplayPath(diffPreview.path);

    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Box
                borderColor="gray"
                borderStyle="single"
                borderLeft={false}
                borderRight={false}
                paddingTop={0}
                paddingBottom={0}
            >
                <Box flexDirection="column">
                    <Text>
                        <Text bold={true}>Edited </Text>
                        <Text>{displayPath}</Text>
                        <Text color="green">{model.added > 0 ? ` (+${model.added})` : ""}</Text>
                        <Text color="red">{model.removed > 0 ? ` (-${model.removed})` : ""}</Text>
                    </Text>
                    <Box flexDirection="column" marginTop={1}>
                        {model.meta.map((line, index) => (
                            <Text key={`meta-${index}`} dimColor={true}>
                                {line}
                            </Text>
                        ))}
                        {model.hunks.length > 0 ? (
                            <>
                                <Box>
                                    {renderGutterHeader(model.gutterWidth)}
                                    <Text color="gray" bold={true}>
                                        code
                                    </Text>
                                </Box>
                                {renderHunks(model.hunks, model.gutterWidth)}
                            </>
                        ) : null}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
