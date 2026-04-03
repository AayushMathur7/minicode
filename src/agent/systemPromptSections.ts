type ComputeSection = () => string | null;

type PromptSection = {
    name: string;
    compute: ComputeSection;
    cacheBreak: boolean;
};

const sectionCache = new Map<string, string | null>();

// Stable sections are memoized for the lifetime of the process. This is the
// small `minicode` version of Claude Code's section-based prompt assembly.
export function systemPromptSection(
    name: string,
    compute: ComputeSection,
): PromptSection {
    return {
        name,
        compute,
        cacheBreak: false,
    };
}

// Dynamic sections are recomputed each turn. Keep these small so they do not
// dominate the prompt or defeat the value of caching the stable sections.
export function dynamicSystemPromptSection(
    name: string,
    compute: ComputeSection,
): PromptSection {
    return {
        name,
        compute,
        cacheBreak: true,
    };
}

export function resolveSystemPromptSections(
    sections: PromptSection[],
): string[] {
    return sections
        .map((section) => {
            if (!section.cacheBreak && sectionCache.has(section.name)) {
                return sectionCache.get(section.name) ?? null;
            }

            const value = section.compute();

            if (!section.cacheBreak) {
                sectionCache.set(section.name, value);
            }

            return value;
        })
        .filter((section): section is string => section !== null);
}

export function clearSystemPromptSectionCache(): void {
    sectionCache.clear();
}
