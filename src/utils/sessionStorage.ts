import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { type Message } from "../types"

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getMinicodeDir(): string {
    const dir = join(homedir(), ".minicode");
    mkdirSync(dir, { recursive: true });
    return dir;
}

function getSessionDir(): string {
    const dir = join(getMinicodeDir(), "sessions");
    mkdirSync(dir, { recursive: true });
    return dir;
}

function getSessionPath(sessionId: string): string {
    return join(getSessionDir(), `${sessionId}.jsonl`)
}

function getHistoryPath(): string {
    return join(getMinicodeDir(), "history.jsonl");
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

export function appendToSession(sessionId: string, entry: object): void {
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() })
    appendFileSync(getSessionPath(sessionId), line + "\n")
}

export function setSessionTitle(sessionId: string, title: string): void {
    appendToSession(sessionId, { type: "metadata", key: "title", value: title });
}

export function listSessions(): Array<{ id: string, title: string, firstPrompt: string, modified: Date }> {
    const dir = getSessionDir();
    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));

    return files.map(file => {
        const filePath = join(dir, file);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n");
        const firstLine = lines[0];
        if (!firstLine) return null;
        try {
            const firstEntry = JSON.parse(firstLine);
            const stat = statSync(filePath);

            // Scan for a title metadata entry (last one wins)
            let title: string | undefined;
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.type === "metadata" && entry.key === "title") {
                        title = entry.value;
                    }
                } catch { /* skip */ }
            }

            return {
                id: file.replace(".jsonl", ""),
                title: title ?? "",
                firstPrompt: firstEntry.content ?? "(no prompt)",
                modified: stat.mtime,
            };
        } catch {
            return null;
        }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

export function loadSessions(sessionId: string): Message[] {
    const content = readFileSync(getSessionPath(sessionId), "utf-8")
    const lines = content.trim().split("\n");
    const messages: Message[] = [];

    for (const line of lines) {
        const entry = JSON.parse(line);

        if (entry.type === "user" || entry.type === "assistant") {
            messages.push({ role: entry.type, content: entry.content });
        } else if (entry.type === "tool_result") {
            messages.push({ role: "tool", content: entry.content, name: entry.name });
        }
        // Skip tool_call entries — the model doesn't need those on replay,
        // it only needs the results
    }

    return messages
}

// ---------------------------------------------------------------------------
// Prompt history (cross-session, like shell history)
// ---------------------------------------------------------------------------

export function appendToHistory(prompt: string): void {
    const line = JSON.stringify({ prompt, timestamp: new Date().toISOString() });
    appendFileSync(getHistoryPath(), line + "\n");
}

export function loadHistory(): string[] {
    const path = getHistoryPath();
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf-8").trim();
    if (!content) return [];

    const prompts: string[] = [];
    for (const line of content.split("\n")) {
        try {
            const entry = JSON.parse(line);
            if (entry.prompt) prompts.push(entry.prompt);
        } catch { /* skip corrupt lines */ }
    }
    return prompts;
}

// ---------------------------------------------------------------------------
// Session search
// ---------------------------------------------------------------------------

export function searchSessions(query: string): Array<{
    id: string;
    firstPrompt: string;
    matchingLine: string;
    modified: Date;
}> {
    const dir = getSessionDir();
    const files = readdirSync(dir).filter(f => f.endsWith(".jsonl"));
    const lowerQuery = query.toLowerCase();
    const results: Array<{
        id: string;
        firstPrompt: string;
        matchingLine: string;
        modified: Date;
    }> = [];

    for (const file of files) {
        const filePath = join(dir, file);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n");
        const firstLine = lines[0];
        let firstPrompt = "(no prompt)";

        try {
            if (firstLine) {
                firstPrompt = JSON.parse(firstLine).content ?? "(no prompt)";
            }
        } catch { /* skip */ }

        // Search through all lines for the query
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const text = entry.content ?? "";
                if (text.toLowerCase().includes(lowerQuery)) {
                    const stat = statSync(filePath);
                    results.push({
                        id: file.replace(".jsonl", ""),
                        firstPrompt,
                        matchingLine: text.length > 80 ? text.slice(0, 77) + "..." : text,
                        modified: stat.mtime,
                    });
                    break; // one match per session is enough
                }
            } catch { /* skip corrupt lines */ }
        }
    }

    return results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

// ---------------------------------------------------------------------------
// MINICODE.md loader
// ---------------------------------------------------------------------------

export function loadProjectInstructions(cwd: string): string | null {
    const paths = [
        join(cwd, "MINICODE.md"),
        join(cwd, ".minicode", "MINICODE.md"),
    ];

    for (const p of paths) {
        if (existsSync(p)) {
            return readFileSync(p, "utf-8").trim();
        }
    }
    return null;
}