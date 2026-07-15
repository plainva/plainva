import { describe, it, expect } from "vitest";
import { renameTagInText, isValidTagName, contentHasTag } from "../src/vault/renameTag.ts";

describe("renameTagInText", () => {
  it("renames inline body tags and their subtags", () => {
    const r = renameTagInText("# N\nDo #work and #work/urgent today", "work", "job");
    expect(r.changed).toBe(true);
    expect(r.content).toBe("# N\nDo #job and #job/urgent today");
  });

  it("leaves an unrelated tag whose LATER segment is the name (#area/work)", () => {
    const r = renameTagInText("#area/work here", "work", "job");
    expect(r.changed).toBe(false);
    expect(r.content).toBe("#area/work here");
  });

  it("leaves a longer tag that merely starts with the name (#workflow)", () => {
    expect(renameTagInText("#workflow tag", "work", "job").changed).toBe(false);
  });

  it("renames frontmatter tags in an inline array", () => {
    const r = renameTagInText("---\ntags: [work, home]\n---\nbody", "work", "job");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("job");
    expect(r.content).not.toContain("work");
    expect(r.content).toContain("body");
  });

  it("renames frontmatter tags in a block list and the body inline together", () => {
    const src = "---\ntags:\n  - work\n  - other\n---\nSee #work.";
    const r = renameTagInText(src, "work", "job");
    expect(r.changed).toBe(true);
    expect(r.content).toContain("- job");
    expect(r.content).toContain("- other");
    expect(r.content).toContain("See #job.");
  });

  it("leaves a #old inside a frontmatter string value alone", () => {
    const r = renameTagInText('---\ntitle: "meeting #work notes"\n---\nbody', "work", "job");
    expect(r.changed).toBe(false);
  });

  it("is a no-op when the tag is absent or the names are equal", () => {
    expect(renameTagInText("nothing here", "work", "job").changed).toBe(false);
    expect(renameTagInText("#work", "work", "work").changed).toBe(false);
  });

  it("contentHasTag detects inline, subtag and frontmatter occurrences", () => {
    expect(contentHasTag("do #work now", "work")).toBe(true);
    expect(contentHasTag("do #work/urgent now", "work")).toBe(true);
    expect(contentHasTag("---\ntags: [work]\n---\nx", "work")).toBe(true);
    expect(contentHasTag("#workflow only", "work")).toBe(false);
    expect(contentHasTag("nothing", "work")).toBe(false);
  });

  it("isValidTagName rejects empty and whitespace names", () => {
    expect(isValidTagName("job")).toBe(true);
    expect(isValidTagName("#job")).toBe(true);
    expect(isValidTagName("")).toBe(false);
    expect(isValidTagName("two words")).toBe(false);
  });
});
