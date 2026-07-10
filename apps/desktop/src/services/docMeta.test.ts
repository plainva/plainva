import { describe, it, expect } from "vitest";
import { frontmatterBlockOf, plainvaMetaFromContent } from "@plainva/ui";

describe("frontmatterBlockOf", () => {
  it("extracts the leading block", () => {
    expect(frontmatterBlockOf("---\ntype: Note\n---\nBody\n")).toBe("type: Note");
  });

  it("returns null without frontmatter or for mid-document rules", () => {
    expect(frontmatterBlockOf("# Heading\n\n---\nnot frontmatter\n---\n")).toBeNull();
    expect(frontmatterBlockOf("")).toBeNull();
  });

  it("handles CRLF", () => {
    expect(frontmatterBlockOf("---\r\ntype: Note\r\n---\r\nBody")).toBe("type: Note");
  });
});

describe("plainvaMetaFromContent", () => {
  it("reads icon and header color from the plainva namespace", () => {
    const content = '---\ntype: Note\nplainva:\n  icon: "🚀"\n  header_color: "#2f6f6f"\n---\nBody\n';
    expect(plainvaMetaFromContent(content)).toEqual({ icon: "🚀", headerColor: "#2f6f6f" });
  });

  it("returns empty meta for missing namespace, broken yaml and invalid colors", () => {
    expect(plainvaMetaFromContent("# Just text\n")).toEqual({});
    expect(plainvaMetaFromContent("---\ntitle: [broken\n---\nBody\n")).toEqual({});
    expect(
      plainvaMetaFromContent("---\nplainva:\n  header_color: tomato\n---\n")
    ).toEqual({});
  });
});
