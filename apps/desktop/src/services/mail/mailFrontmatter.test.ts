import { describe, it, expect } from "vitest";
import { stripFrontmatter, frontmatterToAddress } from "@plainva/ui";

// P2: a note sent as an email must never carry its YAML frontmatter in the body,
// and a reply-as-note's `to:` should prefill the recipient field.

describe("stripFrontmatter", () => {
  it("removes a leading frontmatter block and the blank line that followed it", () => {
    expect(stripFrontmatter("---\ntitle: X\nto: a@b.c\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("---\ntitle: X\n---\n\n# Body")).toBe("# Body");
  });

  it("leaves content without frontmatter untouched (incl. a genuine leading blank line)", () => {
    expect(stripFrontmatter("\n# Body")).toBe("\n# Body");
    expect(stripFrontmatter("# Just a note\n\n- a\n- b\n")).toBe("# Just a note\n\n- a\n- b\n");
  });

  it("does not treat a mid-document thematic break as frontmatter", () => {
    const md = "# Title\n\n---\n\nAfter a rule";
    expect(stripFrontmatter(md)).toBe(md);
  });

  it("removes a block without entries, and nothing of the text up to the next rule", () => {
    // The two fences went into the mail as two rules — or, with a rule in the
    // note, everything in front of that rule was cut as "frontmatter".
    expect(stripFrontmatter("---\n---\n# Body\n")).toBe("# Body\n");
    expect(stripFrontmatter("---\r\n---\r\n\r\n# Body\r\n")).toBe("# Body\r\n");
    expect(stripFrontmatter("---\n---\nIntro\n\n---\n\nRest")).toBe("Intro\n\n---\n\nRest");
  });
});

describe("frontmatterToAddress", () => {
  it("reads the trimmed `to` recipient from the frontmatter", () => {
    expect(frontmatterToAddress("---\nto: alice@example.com\ndate: 2026-07-20\n---\nHi")).toBe("alice@example.com");
    expect(frontmatterToAddress("---\nto: '  bob@x.io  '\n---\n")).toBe("bob@x.io");
  });

  it("returns null with no frontmatter, no `to`, or a non-string `to`", () => {
    expect(frontmatterToAddress("# no frontmatter")).toBeNull();
    expect(frontmatterToAddress("---\ntitle: X\n---\nbody")).toBeNull();
    expect(frontmatterToAddress("---\nto: [a, b]\n---\n")).toBeNull();
  });

  it("never throws on malformed frontmatter", () => {
    expect(frontmatterToAddress("---\nto: : :\n[bad yaml\n---\n")).toBeNull();
  });
});
