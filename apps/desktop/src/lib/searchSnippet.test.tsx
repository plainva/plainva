import { describe, expect, it } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { VaultQueryService } from "@plainva/core";
import { hasSnippetMark, renderSnippetNodes, stripSnippetMarks } from "@plainva/ui";

const S = VaultQueryService.SNIPPET_MARK_START;
const E = VaultQueryService.SNIPPET_MARK_END;

// Serializes the node list for readable assertions: <mark> children are
// wrapped, plain strings stay as-is.
const textOf = (nodes: ReactNode[]) =>
  nodes
    .map((n) => (isValidElement(n) ? `[${String((n.props as { children?: unknown }).children)}]` : String(n)))
    .join("");

describe("searchSnippet", () => {
  it("shares the sentinel contract with the core (char(1)/char(2))", () => {
    expect(S.charCodeAt(0)).toBe(1);
    expect(E.charCodeAt(0)).toBe(2);
  });

  it("wraps marked ranges in <mark> nodes", () => {
    const nodes = renderSnippetNodes(`Der ${S}Projektplan${E} steht.`);
    expect(textOf(nodes)).toBe("Der [Projektplan] steht.");
    const marks = nodes.filter((n) => isValidElement(n));
    expect(marks).toHaveLength(1);
    expect((marks[0] as { type?: unknown }).type).toBe("mark");
  });

  it("handles multiple matches in one snippet", () => {
    const nodes = renderSnippetNodes(`${S}foo${E} und ${S}bar${E}`);
    expect(textOf(nodes)).toBe("[foo] und [bar]");
  });

  it("keeps HTML-looking content as literal text (no innerHTML anywhere)", () => {
    const nodes = renderSnippetNodes(`<b>fett</b> <script>x</script> ${S}Treffer${E}`);
    expect(typeof nodes[0]).toBe("string");
    expect(nodes[0]).toBe("<b>fett</b> <script>x</script> ");
  });

  it("renders unbalanced or stray markers as plain text", () => {
    expect(textOf(renderSnippetNodes(`a${S}b`))).toBe("ab");
    expect(textOf(renderSnippetNodes(`a${E}b${E}c`))).toBe("abc");
  });

  it("detects markers with hasSnippetMark", () => {
    expect(hasSnippetMark(`x${S}y${E}`)).toBe(true);
    expect(hasSnippetMark("plain")).toBe(false);
    expect(hasSnippetMark(null)).toBe(false);
    expect(hasSnippetMark(undefined)).toBe(false);
  });

  it("strips both markers with stripSnippetMarks", () => {
    expect(stripSnippetMarks(`a${S}b${E}c${S}`)).toBe("abc");
  });
});
