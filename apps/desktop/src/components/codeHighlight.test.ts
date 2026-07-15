import { describe, it, expect } from "vitest";
import { highlightCodeToTokens } from "@plainva/ui";

// Read-mode fenced-code highlighting (issue #13). The helper loads the grammar
// lazily from @codemirror/language-data (the same table the editor uses) and
// tokenizes with the same highlighters, so the read view matches the editor.
// These tests exercise the real grammars (dynamic import), so they double as a
// smoke test that the css/js/... loaders resolve.

describe("highlightCodeToTokens", () => {
  it("returns null when no language is given", async () => {
    expect(await highlightCodeToTokens("const x = 1;", undefined)).toBeNull();
  });

  it("returns null for an unknown language", async () => {
    expect(await highlightCodeToTokens("const x = 1;", "totally-not-a-language")).toBeNull();
  });

  it("highlights JavaScript and reproduces the source verbatim", async () => {
    const code = "const answer = 42; // the answer";
    const tokens = await highlightCodeToTokens(code, "js");
    expect(tokens).not.toBeNull();
    // Lossless: concatenating every token reproduces the exact input.
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
    // The `const` keyword carries a highlight class (definitionKeyword inherits
    // the keyword rule via the tag set → the editor's accent override).
    expect(tokens!.find((token) => token.text === "const")?.cls).toBeTruthy();
    // The line comment is highlighted too.
    expect(tokens!.find((token) => token.text.includes("// the answer"))?.cls).toBeTruthy();
  });

  it("resolves the `html` alias and highlights markup", async () => {
    const code = "<div class=\"x\">hi</div>";
    const tokens = await highlightCodeToTokens(code, "html");
    expect(tokens).not.toBeNull();
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
    expect(tokens!.some((token) => token.cls)).toBe(true);
  });

  it("highlights CSS and preserves newlines", async () => {
    const code = "a {\n  color: red;\n}";
    const tokens = await highlightCodeToTokens(code, "css");
    expect(tokens).not.toBeNull();
    expect(tokens!.map((token) => token.text).join("")).toBe(code);
    expect(tokens!.some((token) => token.cls)).toBe(true);
  });
});
