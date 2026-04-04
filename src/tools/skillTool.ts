// Tool: skill — Invokes a skill by name.
//
// When called, loads the skill's markdown content and returns it as
// instructions for the model to follow. The model then uses its
// existing tools (read_file, write_file, run_command, etc.) to
// carry out the skill's instructions.
//
// This is the minicode equivalent of Claude Code's SkillTool
// (see claude-code/src/tools/SkillTool/SkillTool.ts).

import { loadSkills, formatSkillList, type SkillDefinition } from "../skills/loader";
import type { ToolDefinition } from "../types";

// Cache skills per cwd so we don't re-scan the filesystem every call.
let _cachedCwd: string | null = null;
let _cachedSkills: Map<string, SkillDefinition> = new Map();

function getSkills(cwd: string): Map<string, SkillDefinition> {
    if (_cachedCwd !== cwd) {
        _cachedSkills = loadSkills(cwd);
        _cachedCwd = cwd;
    }
    return _cachedSkills;
}

/** Force reload on next access (call after creating/modifying a skill). */
export function clearSkillCache(): void {
    _cachedCwd = null;
    _cachedSkills = new Map();
}

/**
 * Build the skill listing for inclusion in the system prompt.
 * Returns empty string if no skills are found.
 */
export function getSkillListForPrompt(cwd: string): string {
    const skills = getSkills(cwd);
    return formatSkillList(skills);
}

export const skillTool: ToolDefinition = {
    name: "skill",
    description: [
        "Invoke a skill by name. Skills are reusable prompt-based commands that provide specialized instructions.",
        "When invoked, the skill's content is returned as instructions for you to follow using your existing tools.",
        "Users can reference skills with a slash: /skill-name. When you see this, invoke the matching skill.",
        "Do NOT mention a skill without invoking it. If a skill matches the user's request, invoke it FIRST.",
    ].join("\n"),
    accessLevel: "read",
    inputSchema: {
        type: "object",
        properties: {
            skill: {
                type: "string",
                description: "The skill name to invoke (e.g. \"deploy\", \"review-pr\")",
            },
            args: {
                type: "string",
                description: "Optional arguments to pass to the skill",
            },
        },
        required: ["skill", "args"],
        additionalProperties: false,
    },

    execute: async (
        rawArgs: Record<string, unknown>,
        context,
    ): Promise<string> => {
        const skillName = (rawArgs.skill as string).trim().replace(/^\//, "");
        const args = (rawArgs.args as string | undefined) ?? "";
        const skills = getSkills(context.cwd);

        if (skills.size === 0) {
            return "No skills available. Users can create skills by adding .md files to .minicode/skills/";
        }

        const skill = skills.get(skillName);
        if (!skill) {
            const available = [...skills.keys()].join(", ");
            return `Skill "${skillName}" not found. Available skills: ${available}`;
        }

        // Build the injected prompt
        const parts = [
            `# Skill: ${skill.name}`,
            "",
            skill.content,
        ];

        if (args) {
            parts.push("", `## Additional context from user`, "", args);
        }

        return parts.join("\n");
    },
};
