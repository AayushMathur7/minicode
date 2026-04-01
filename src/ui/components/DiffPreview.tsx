import React from "react";
import { Box, Text } from "ink";
import { diffWords, parsePatch } from "diff";
import { type DiffPreviewState } from "../state";
import { highlightCodeLine, renderCodeToken } from "./codeHighlight";

type Props = {
    diffPreview?: DiffPreviewState;
};

type DiffRow =
    | { type: "meta"; text: string }
    | { type: "hunk"; text: string }
    | {
        type: "line";
        marker: " " | "+" | "-";
        oldLine?: number;
        newLine?: number;
        content: string;
    };

function getDisplayPath(path: string): string {
    return path.startsWith(process.cwd()) ? path.replace(`${process.cwd()}/`, "") : path;
}

function buildRows(preview: string): DiffRow[] {
    const [patch] = parsePatch(preview);

    if (!patch) {
        return preview
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line) => ({ type: "meta", text: line }));
    }

    const rows: DiffRow[] = [];

    if (patch.oldFileName) {
        rows.push({ type: "meta", text: `--- ${patch.oldFileName}` });
    }

    if (patch.newFileName) {
        rows.push({ type: "meta", text: `+++ ${patch.newFileName}` });
    }

    for (const hunk of patch.hunks) {
        rows.push({ type: "hunk", text: hunk.oldStart === 0 && hunk.newStart === 0 ? "@@" : `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });

        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        for (const line of hunk.lines) {
            const marker = line[0] as " " | "+" | "-";
            const content = line.slice(1);

            if (marker === " ") {
                rows.push({
                    type: "line",
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
                rows.push({
                    type: "line",
                    marker,
                    oldLine,
                    content,
                });
                oldLine += 1;
                continue;
            }

            if (marker === "+") {
                rows.push({
                    type: "line",
                    marker,
                    newLine,
                    content,
                });
                newLine += 1;
            }
        }
    }

    return rows;
}

function countChanges(rows: DiffRow[]): { added: number; removed: number } {
    let added = 0;
    let removed = 0;

    for (const row of rows) {
        if (row.type !== "line") {
            continue;
        }

        if (row.marker === "+") {
            added += 1;
        } else if (row.marker === "-") {
            removed += 1;
        }
    }

    return { added, removed };
}

function getGutterWidth(rows: DiffRow[]): number {
    let maxLine = 1;

    for (const row of rows) {
        if (row.type !== "line") {
            continue;
        }

        if (row.oldLine) {
            maxLine = Math.max(maxLine, row.oldLine);
        }

        if (row.newLine) {
            maxLine = Math.max(maxLine, row.newLine);
        }
    }

    return Math.max(3, String(maxLine).length);
}

function renderLineNumber(value: number | undefined, width: number): string {
    return value === undefined ? "".padStart(width, " ") : value.toString().padStart(width, " ");
}

function renderGutter(
    oldLine: number | undefined,
    newLine: number | undefined,
    marker: " " | "+" | "-",
    width: number,
): React.ReactElement {
    const markerColor = marker === "+" ? "green" : marker === "-" ? "red" : "white";

    return (
        <Box>
            <Text dimColor={true}>{renderLineNumber(oldLine, width)}</Text>
            <Text dimColor={true}> </Text>
            <Text dimColor={true}>{renderLineNumber(newLine, width)}</Text>
            <Text dimColor={true}> </Text>
            <Text color={markerColor}>{marker}</Text>
            <Text dimColor={true}> │ </Text>
        </Box>
    );
}

function renderSyntaxLine(
    content: string,
    marker: " " | "+" | "-",
): React.ReactElement {
    const plainColor = marker === "+" ? "green" : marker === "-" ? "red" : "white";
    const dimPlain = marker === " ";

    return (
        <Text>
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

    return (
        <Text>
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
                        inverse={isChanged}
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
    row: Extract<DiffRow, { type: "line" }>,
    key: string,
    gutterWidth: number,
): React.ReactElement {
    return (
        <Box key={key}>
            {renderGutter(row.oldLine, row.newLine, row.marker, gutterWidth)}
            {renderSyntaxLine(row.content, row.marker)}
        </Box>
    );
}

function renderChangedPair(
    removedRow: Extract<DiffRow, { type: "line" }>,
    addedRow: Extract<DiffRow, { type: "line" }>,
    key: string,
    gutterWidth: number,
): React.ReactElement {
    return (
        <Box key={key} flexDirection="column">
            <Box>
                {renderGutter(removedRow.oldLine, undefined, "-", gutterWidth)}
                {renderWordDiffLine(removedRow.content, addedRow.content, "-")}
            </Box>
            <Box>
                {renderGutter(undefined, addedRow.newLine, "+", gutterWidth)}
                {renderWordDiffLine(removedRow.content, addedRow.content, "+")}
            </Box>
        </Box>
    );
}

function renderRows(rows: DiffRow[], gutterWidth: number): React.ReactElement[] {
    const elements: React.ReactElement[] = [];
    let keyIndex = 0;
    let pendingRemoved: Extract<DiffRow, { type: "line" }>[] = [];
    let pendingAdded: Extract<DiffRow, { type: "line" }>[] = [];

    const flushChangedBlock = () => {
        if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
            return;
        }

        const pairCount = Math.max(pendingRemoved.length, pendingAdded.length);

        for (let index = 0; index < pairCount; index += 1) {
            const removedRow = pendingRemoved[index];
            const addedRow = pendingAdded[index];

            if (removedRow && addedRow) {
                elements.push(renderChangedPair(removedRow, addedRow, `pair-${keyIndex}`, gutterWidth));
                keyIndex += 1;
                continue;
            }

            if (removedRow) {
                elements.push(renderSingleLineRow(removedRow, `removed-${keyIndex}`, gutterWidth));
                keyIndex += 1;
            }

            if (addedRow) {
                elements.push(renderSingleLineRow(addedRow, `added-${keyIndex}`, gutterWidth));
                keyIndex += 1;
            }
        }

        pendingRemoved = [];
        pendingAdded = [];
    };

    for (const row of rows) {
        if (row.type === "line" && row.marker === "-") {
            pendingRemoved.push(row);
            continue;
        }

        if (row.type === "line" && row.marker === "+") {
            pendingAdded.push(row);
            continue;
        }

        flushChangedBlock();

        if (row.type === "meta") {
            elements.push(
                <Text key={`meta-${keyIndex}`} dimColor={true}>
                    {row.text}
                </Text>,
            );
            keyIndex += 1;
            continue;
        }

        if (row.type === "hunk") {
            elements.push(
                <Text key={`hunk-${keyIndex}`} color="cyan">
                    {row.text}
                </Text>,
            );
            keyIndex += 1;
            continue;
        }

        elements.push(renderSingleLineRow(row, `line-${keyIndex}`, gutterWidth));
        keyIndex += 1;
    }

    flushChangedBlock();

    return elements;
}

export function DiffPreview({ diffPreview }: Props): React.ReactElement | null {
    if (!diffPreview) {
        return null;
    }

    const rows = buildRows(diffPreview.preview);
    const { added, removed } = countChanges(rows);
    const gutterWidth = getGutterWidth(rows);

    return (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Text>
                <Text bold>Edited </Text>
                <Text>{getDisplayPath(diffPreview.path)}</Text>
                <Text color="green">{added > 0 ? ` (+${added})` : ""}</Text>
                <Text color="red">{removed > 0 ? ` (-${removed})` : ""}</Text>
            </Text>
            {renderRows(rows, gutterWidth)}
        </Box>
    );
}
