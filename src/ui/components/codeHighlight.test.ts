import { describe, expect, test } from "bun:test";
import { highlightCodeLine } from "./codeHighlight";

describe("highlightCodeLine", () => {
    test("classifies declarations, types, and function names", () => {
        const tokens = highlightCodeLine("export async function buildMessage(input: Promise<string>): Result {");

        expect(tokens.filter((token) => token.type === "keyword").map((token) => token.value))
            .toEqual(["export", "async", "function"]);
        expect(tokens.find((token) => token.value === "buildMessage")?.type).toBe("function");
        expect(tokens.find((token) => token.value === "Promise")?.type).toBe("builtin");
        expect(tokens.find((token) => token.value === "Result")?.type).toBe("type");
    });

    test("classifies decorators, properties, calls, literals, and trailing comments", () => {
        const tokens = highlightCodeLine("@memoize const ok = user.profile.getName(\"hi\", 42, true) // tail");

        expect(tokens.find((token) => token.value === "@memoize")?.type).toBe("decorator");
        expect(tokens.find((token) => token.value === "const")?.type).toBe("keyword");
        expect(tokens.find((token) => token.value === "profile")?.type).toBe("property");
        expect(tokens.find((token) => token.value === "getName")?.type).toBe("function");
        expect(tokens.find((token) => token.value === "\"hi\"")?.type).toBe("string");
        expect(tokens.find((token) => token.value === "42")?.type).toBe("number");
        expect(tokens.find((token) => token.value === "true")?.type).toBe("literal");
        expect(tokens.at(-1)?.type).toBe("comment");
    });
});
