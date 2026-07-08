import { describe, it, expect } from "vitest";
import {
  upsertFrontmatterKeys,
  setFrontmatterPath,
  deleteFrontmatterPath,
  renameFrontmatterKey,
  renameFrontmatterWikiLinks,
  ensureOkfFrontmatter,
  FrontmatterSurgicalError
} from "../src/frontmatter-surgical.js";
import { getPlainvaMeta } from "../src/metadata.js";
import { parse as parseYaml } from "yaml";

const DOC_WITH_COMMENTS = `---
title: "Golden Note"
# taxonomy block
tags:
  - alpha
  - beta
custom: 123
---

# Heading

Body with [[Wikilink]] stays byte-identical.
`;

function frontmatterOf(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("no frontmatter");
  return parseYaml(match[1]) as Record<string, unknown>;
}

function bodyOf(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("no frontmatter");
  return content.slice(match[0].length);
}

describe("upsertFrontmatterKeys", () => {
  it("touches only the given keys and preserves comments, order and body", () => {
    const result = upsertFrontmatterKeys(DOC_WITH_COMMENTS, { type: "Note" });

    expect(result).toContain("# taxonomy block");
    expect(bodyOf(result)).toBe(bodyOf(DOC_WITH_COMMENTS));
    const fm = frontmatterOf(result);
    expect(fm.type).toBe("Note");
    expect(fm.title).toBe("Golden Note");
    expect(fm.custom).toBe(123);
    // Original quoting of untouched scalars stays intact.
    expect(result).toContain('title: "Golden Note"');
    // Untouched keys keep their original order (title first).
    expect(result.indexOf("title:")).toBeLessThan(result.indexOf("tags:"));
  });

  it("creates a frontmatter block when none exists", () => {
    const result = upsertFrontmatterKeys("# Just a heading\n", { type: "Note" });
    expect(result.startsWith("---\n")).toBe(true);
    expect(frontmatterOf(result).type).toBe("Note");
    expect(result.endsWith("# Just a heading\n")).toBe(true);
  });

  it("preserves CRLF line endings", () => {
    const crlf = "---\r\ntitle: X\r\n---\r\nBody\r\n";
    const result = upsertFrontmatterKeys(crlf, { type: "Note" });
    expect(result).toContain("type: Note\r\n");
    expect(result.endsWith("Body\r\n")).toBe(true);
    expect(result.includes("\n---\n")).toBe(false);
  });

  it("quotes version-like strings so they survive as strings", () => {
    const result = upsertFrontmatterKeys("Body\n", { okf_version: "0.1" });
    expect(frontmatterOf(result).okf_version).toBe("0.1");
    expect(typeof frontmatterOf(result).okf_version).toBe("string");
  });

  it("throws on unparseable frontmatter", () => {
    const broken = "---\ntitle: [unclosed\n---\nBody\n";
    expect(() => upsertFrontmatterKeys(broken, { type: "Note" })).toThrow(
      FrontmatterSurgicalError
    );
  });

  it("throws on non-map frontmatter", () => {
    const listFm = "---\n- just\n- a list\n---\nBody\n";
    expect(() => upsertFrontmatterKeys(listFm, { type: "Note" })).toThrow(
      FrontmatterSurgicalError
    );
  });
});

describe("setFrontmatterPath / deleteFrontmatterPath", () => {
  it("creates the plainva namespace and keeps siblings on second write", () => {
    const withIcon = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    const withBoth = setFrontmatterPath(withIcon, ["plainva", "header_color"], "#2f6f6f");

    const meta = getPlainvaMeta(frontmatterOf(withBoth));
    expect(meta.icon).toBe("🚀");
    expect(meta.headerColor).toBe("#2f6f6f");
    expect(withBoth).toContain("# taxonomy block");
    expect(bodyOf(withBoth)).toBe(bodyOf(DOC_WITH_COMMENTS));
  });

  it("removes an emptied namespace map entirely", () => {
    const withIcon = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    const removed = deleteFrontmatterPath(withIcon, ["plainva", "icon"]);
    expect(frontmatterOf(removed).plainva).toBeUndefined();
    expect(removed).not.toContain("plainva");
    expect(bodyOf(removed)).toBe(bodyOf(DOC_WITH_COMMENTS));
  });

  it("keeps the namespace when siblings remain", () => {
    let content = setFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"], "🚀");
    content = setFrontmatterPath(content, ["plainva", "header_color"], "#aabbcc");
    const removed = deleteFrontmatterPath(content, ["plainva", "icon"]);
    const meta = getPlainvaMeta(frontmatterOf(removed));
    expect(meta.icon).toBeUndefined();
    expect(meta.headerColor).toBe("#aabbcc");
  });

  it("is a no-op when the path does not exist", () => {
    expect(deleteFrontmatterPath(DOC_WITH_COMMENTS, ["plainva", "icon"])).toBe(
      DOC_WITH_COMMENTS
    );
    expect(deleteFrontmatterPath("no frontmatter\n", ["plainva"])).toBe("no frontmatter\n");
  });

  it("emits an empty frontmatter block when the last key is deleted", () => {
    const single = "---\nonly: value\n---\nBody\n";
    const removed = deleteFrontmatterPath(single, ["only"]);
    expect(removed).toBe("---\n---\nBody\n");
  });
});

describe("renameFrontmatterKey", () => {
  it("renames in place, keeping value, position and body", () => {
    const content = "---\ntitle: X\ntype: Persönliche Kategorie\nrank: 3\n---\nBody\n";
    const renamed = renameFrontmatterKey(content, "type", "type_original");
    const fm = frontmatterOf(renamed);
    expect(fm.type).toBeUndefined();
    expect(fm.type_original).toBe("Persönliche Kategorie");
    // Position preserved: between title and rank.
    expect(renamed.indexOf("title:")).toBeLessThan(renamed.indexOf("type_original:"));
    expect(renamed.indexOf("type_original:")).toBeLessThan(renamed.indexOf("rank:"));
    expect(bodyOf(renamed)).toBe("Body\n");
  });

  it("is a no-op when the source key is absent", () => {
    expect(renameFrontmatterKey(DOC_WITH_COMMENTS, "type", "type_original")).toBe(
      DOC_WITH_COMMENTS
    );
  });

  it("throws when the target key already exists", () => {
    const content = "---\ntype: A\ntype_original: B\n---\n";
    expect(() => renameFrontmatterKey(content, "type", "type_original")).toThrow(
      FrontmatterSurgicalError
    );
  });

  it("renames non-string values (lists) intact", () => {
    const content = "---\ntype:\n  - projekt\n  - privat\n---\nBody\n";
    const renamed = renameFrontmatterKey(content, "type", "type_original");
    expect(frontmatterOf(renamed).type_original).toEqual(["projekt", "privat"]);
  });
});

describe("ensureOkfFrontmatter", () => {
  it("builds a full block for empty content", () => {
    const result = ensureOkfFrontmatter("", { type: "Note" });
    expect(result.changed).toBe(true);
    expect(result.setType).toBe(true);
    expect(result.setOkfVersion).toBe(true);
    const fm = frontmatterOf(result.content);
    expect(fm.type).toBe("Note");
    expect(fm.okf_version).toBe("0.1");
  });

  it("keeps an existing non-blank type and only adds okf_version", () => {
    const content = "---\ntype: Report\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(false);
    expect(result.setOkfVersion).toBe(true);
    expect(frontmatterOf(result.content).type).toBe("Report");
  });

  it("replaces a blank type", () => {
    const content = "---\ntype: '   '\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(true);
    expect(frontmatterOf(result.content).type).toBe("Note");
  });

  it("does not touch a non-string type (handled by explicit conversion)", () => {
    const content = "---\ntype:\n  - list\n---\nBody\n";
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.setType).toBe(false);
    expect(frontmatterOf(result.content).type).toEqual(["list"]);
  });

  it("returns content unchanged (same reference semantics) when nothing to do", () => {
    const content = '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n';
    const result = ensureOkfFrontmatter(content, { type: "Ignored" });
    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });

  it("keeps a foreign okf_version untouched", () => {
    const content = '---\ntype: Note\nokf_version: "0.2"\n---\nBody\n';
    const result = ensureOkfFrontmatter(content, { type: "Note" });
    expect(result.changed).toBe(false);
    expect(frontmatterOf(result.content).okf_version).toBe("0.2");
  });
});

describe("getPlainvaMeta", () => {
  it("returns empty meta for missing/malformed namespaces", () => {
    expect(getPlainvaMeta(null)).toEqual({});
    expect(getPlainvaMeta({})).toEqual({});
    expect(getPlainvaMeta({ plainva: "not-an-object" })).toEqual({});
    expect(getPlainvaMeta({ plainva: ["list"] })).toEqual({});
  });

  it("ignores invalid colors and blank icons", () => {
    expect(getPlainvaMeta({ plainva: { icon: "  ", header_color: "red" } })).toEqual({});
    expect(getPlainvaMeta({ plainva: { header_color: "#12345" } })).toEqual({});
  });

  it("accepts 3-, 6- and 8-digit hex colors and trims values", () => {
    expect(getPlainvaMeta({ plainva: { header_color: " #abc " } }).headerColor).toBe("#abc");
    expect(getPlainvaMeta({ plainva: { header_color: "#a1b2c3" } }).headerColor).toBe("#a1b2c3");
    expect(getPlainvaMeta({ plainva: { header_color: "#a1b2c3dd" } }).headerColor).toBe(
      "#a1b2c3dd"
    );
    expect(getPlainvaMeta({ plainva: { icon: " 🚀 " } }).icon).toBe("🚀");
  });

  it("reads an icon tint (icon_color) with the same hex validation", () => {
    const meta = getPlainvaMeta({
      plainva: { icon: "lucide:rocket", icon_color: "#c94f4f" },
    });
    expect(meta.icon).toBe("lucide:rocket");
    expect(meta.iconColor).toBe("#c94f4f");
    expect(getPlainvaMeta({ plainva: { icon_color: "red" } }).iconColor).toBeUndefined();
  });
});

describe("renameFrontmatterWikiLinks", () => {
  it("rewrites a scalar whole-value link, keeping quoting style and body bytes", () => {
    const content = '---\n# kommentar\nprojekt: "[[Alt]]"\nstatus: offen\n---\nBody [[Alt]] bleibt.\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "projekt", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('projekt: "[[Neu]]"');
    expect(res.content).toContain("# kommentar");
    expect(res.content).toContain("status: offen");
    // Only the listed key is touched — the body link stays.
    expect(res.content).toContain("Body [[Alt]] bleibt.");
  });

  it("rewrites matching list items and leaves others alone", () => {
    const content = '---\nrefs:\n  - "[[Alt]]"\n  - "[[Bleibt]]"\n  - 42\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "refs", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('- "[[Neu]]"');
    expect(res.content).toContain('- "[[Bleibt]]"');
    expect(res.content).toContain("- 42");
  });

  it("preserves anchors and aliases", () => {
    const content = '---\nrel: "[[Alt#Abschnitt|Anzeige]]"\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "rel", oldTarget: "Alt", newTarget: "Pfad/Neu" },
    ]);
    expect(res.renamed).toBe(1);
    expect(res.content).toContain('rel: "[[Pfad/Neu#Abschnitt|Anzeige]]"');
  });

  it("returns the content unchanged when nothing matches (missing key, other target, embedded text)", () => {
    const content = '---\nprojekt: "[[Anders]]"\nnotiz: "siehe [[Alt]] hier"\n---\n';
    const res = renameFrontmatterWikiLinks(content, [
      { key: "projekt", oldTarget: "Alt", newTarget: "Neu" },
      { key: "fehlt", oldTarget: "Alt", newTarget: "Neu" },
      { key: "notiz", oldTarget: "Alt", newTarget: "Neu" },
    ]);
    expect(res.renamed).toBe(0);
    expect(res.content).toBe(content);
  });

  it("is a no-op without frontmatter and throws on malformed frontmatter", () => {
    expect(renameFrontmatterWikiLinks("Nur Body [[Alt]]\n", [
      { key: "x", oldTarget: "Alt", newTarget: "Neu" },
    ])).toEqual({ content: "Nur Body [[Alt]]\n", renamed: 0 });

    expect(() =>
      renameFrontmatterWikiLinks('---\n{ kaputt: [\n---\n', [
        { key: "x", oldTarget: "Alt", newTarget: "Neu" },
      ])
    ).toThrow(FrontmatterSurgicalError);
  });
});
