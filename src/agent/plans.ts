import fs from "node:fs/promises";
import path from "node:path";

export type PlanArtifact = {
    resolvedPath: string;
    displayPath: string;
};

export type PreparedPlanApproval = PlanArtifact & {
    content: string;
};

function assertSessionId(sessionId: string | undefined): string {
    if (!sessionId || sessionId.trim() === "") {
        throw new Error("A session id is required for plan mode");
    }

    return sessionId;
}

function sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function getPlansDirectory(cwd: string): string {
    return path.join(cwd, ".minicode", "plans");
}

export function getPlanArtifact(cwd: string, sessionId: string | undefined): PlanArtifact {
    const safeSessionId = sanitizeSessionId(assertSessionId(sessionId));
    const resolvedPath = path.join(getPlansDirectory(cwd), `plan-${safeSessionId}.md`);

    return {
        resolvedPath,
        displayPath: path.relative(cwd, resolvedPath),
    };
}

export async function readPlanFile(
    cwd: string,
    sessionId: string | undefined,
): Promise<string | null> {
    const artifact = getPlanArtifact(cwd, sessionId);

    try {
        return await fs.readFile(artifact.resolvedPath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }

        throw error;
    }
}

export async function writePlanFile(
    cwd: string,
    sessionId: string | undefined,
    content: string,
): Promise<PlanArtifact> {
    const artifact = getPlanArtifact(cwd, sessionId);
    await fs.mkdir(path.dirname(artifact.resolvedPath), { recursive: true });
    await fs.writeFile(artifact.resolvedPath, content, "utf8");
    return artifact;
}

export async function clearPlanFile(
    cwd: string,
    sessionId: string | undefined,
): Promise<void> {
    const artifact = getPlanArtifact(cwd, sessionId);
    await fs.rm(artifact.resolvedPath, { force: true });
}

export async function preparePlanApproval(
    cwd: string,
    sessionId: string | undefined,
): Promise<PreparedPlanApproval> {
    const artifact = getPlanArtifact(cwd, sessionId);
    const content = await readPlanFile(cwd, sessionId);

    if (!content || content.trim() === "") {
        throw new Error(
            `No plan file found at ${artifact.displayPath}. Use write_plan to save the plan before exiting plan mode.`,
        );
    }

    return {
        ...artifact,
        content,
    };
}
