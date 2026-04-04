// ---------------------------------------------------------------------------
// Skill Loader
// ---------------------------------------------------------------------------
// Scans .minicode/skills/ for markdown files and parses them into
// SkillDefinition objects. Each .md file is one skill.
//
// Format:
//   .minicode/skills/deploy.md
//   ---
//   description: Build, test, and deploy to staging
//   ---
//   1. Run `bun run build`
//   2. Run `bun run test`
//   3. If tests pass, run `./deploy.sh staging`
//
// This is the minicode equivalent of Claude Code's
// src/skills/loadSkillsDir.ts + src/skills/bundledSkills.ts
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";

export type SkillDefinition = {
    /** Skill name derived from filename (e.g. "deploy" from deploy.md). */
    name: string;
    /** One-line description shown to the model in the skill list. */
    description: string;
    /** The full prompt content injected when the skill is invoked. */
    content: string;
    /** Source path for debugging. */
    path: string;
};

/**
 * Parse simple YAML-like frontmatter from a markdown string.
 * Returns { frontmatter, content } where frontmatter is a key-value map.
 *
 * Only handles simple `key: value` pairs (no nesting, no arrays).
 * Good enough for skill metadata — we don't need a full YAML parser.
 */
function parseFrontmatter(raw: string): {
    meta: Record<string, string>;
    content: string;
} {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("---")) {
        return { meta: {}, content: raw };
    }

    const endIndex = trimmed.indexOf("---", 3);
    if (endIndex === -1) {
        return { meta: {}, content: raw };
    }

    const frontmatterBlock = trimmed.slice(3, endIndex).trim();
    const content = trimmed.slice(endIndex + 3).trim();

    const meta: Record<string, string> = {};
    for (const line of frontmatterBlock.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");
        if (key) meta[key] = value;
    }

    return { meta, content };
}

/**
 * Load all skills from a directory. Each .md file becomes one skill.
 */
function loadSkillsFromDir(dir: string): SkillDefinition[] {
    if (!existsSync(dir)) return [];

    const skills: SkillDefinition[] = [];

    for (const entry of readdirSync(dir)) {
        if (extname(entry) !== ".md") continue;

        const filePath = join(dir, entry);
        const name = basename(entry, ".md");

        try {
            const raw = readFileSync(filePath, "utf-8");
            const { meta, content } = parseFrontmatter(raw);

            if (!content.trim()) continue;

            skills.push({
                name,
                description: meta.description ?? `Skill: ${name}`,
                content,
                path: filePath,
            });
        } catch {
            // Skip unreadable files
        }
    }

    return skills;
}

/**
 * Load all skills from project (.minicode/skills/) directory.
 * Returns a Map keyed by skill name for fast lookup.
 */
export function loadSkills(cwd: string): Map<string, SkillDefinition> {
    const projectSkills = loadSkillsFromDir(join(cwd, ".minicode", "skills"));

    const map = new Map<string, SkillDefinition>();
    for (const skill of projectSkills) {
        map.set(skill.name, skill);
    }
    return map;
}

/**
 * Format the skill list for inclusion in the system prompt / tool description.
 * Shows name + description for each skill.
 */
export function formatSkillList(skills: Map<string, SkillDefinition>): string {
    if (skills.size === 0) return "";

    const lines = [...skills.values()].map(
        (s) => `- ${s.name}: ${s.description}`,
    );
    return lines.join("\n");
}
