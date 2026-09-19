import { describe, expect, it } from "vitest";
import { findInlineTags, findInlineTagsInLine, findInlineTagsInSource, isInlineTagName, tagRoot } from "../src/tagRule.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { scanTasks } from "../src/vault/taskScan.ts";
import { contentHasTag, renameTagInText } from "../src/vault/renameTag.ts";

/**
 * ONE rule for what an inline tag is (finding 2026-09-19). The index, the task
 * scan and the vault-wide rename each had their own; this pins the rule and then
 * proves the three callers agree on the same awkward cases.
 */
const names = (tags: { name: string }[]): string[] => tags.map((tag) => tag.name);
const indexed = (markdown: string): string[] => names(extractLinksAndTags(parseMarkdownAst(markdown)).tags);

describe("the rule", () => {
  it("a # at the start or after whitespace, then name characters", () => {
    expect(names(findInlineTags("#a and #a/b, then #_x and #-y"))).toEqual(["a", "a/b", "_x", "-y"]);
    expect(names(findInlineTags("umlauts count: #Büro #日本語"))).toEqual(["Büro", "日本語"]);
  });

  it("digits alone are a number, not a tag; digits with a letter are one", () => {
    expect(names(findInlineTags("issue #123 and #2026-plan and #1a"))).toEqual(["2026-plan", "1a"]);
    expect(isInlineTagName("123")).toBe(false);
    expect(isInlineTagName("1a")).toBe(true);
    expect(isInlineTagName("two words")).toBe(false);
    expect(isInlineTagName("")).toBe(false);
  });

  it("no tag without the whitespace: a fragment, a heading link, a word#part", () => {
    expect(findInlineTags("https://example.com/page#part word#part (#paren)")).toEqual([]);
    // "# Heading" is a heading marker, "##x" is nothing.
    expect(findInlineTags("# Heading")).toEqual([]);
    expect(findInlineTags("##x")).toEqual([]);
  });

  it("reports where the tag stands, # included", () => {
    expect(findInlineTags("see #a/b.")).toEqual([{ name: "a/b", from: 4, to: 8 }]);
  });

  it("the root of a nested tag is its first segment", () => {
    expect(tagRoot("project/website/launch")).toBe("project");
    expect(tagRoot("#project/website")).toBe("project");
    expect(tagRoot("idea")).toBe("idea");
  });
});

describe("the rule over SOURCE", () => {
  it("skips what the parser takes out: code, wiki links, link targets, HTML", () => {
    const line = "`#code` and ``a ` #still-code`` [[Note|alias #alias]] ![[Pic #x]] [text #in-text](#heading) <span style=\"color: #fff\"> <!-- #hidden --> #real";
    expect(names(findInlineTagsInLine(line))).toEqual(["in-text", "real"]);
  });

  it("keeps the offsets of the line although ranges were blanked", () => {
    const line = "`#code` then #real";
    const [tag] = findInlineTagsInLine(line);
    expect(line.slice(tag.from, tag.to)).toBe("#real");
  });

  it("an unclosed backtick is no code span", () => {
    expect(names(findInlineTagsInLine("a ` and #tag"))).toEqual(["tag"]);
  });

  it("accepts inline markup right before the # - the parser starts a text node there", () => {
    expect(names(findInlineTagsInLine("**#bold** and ==#marked== and ~~#struck~~"))).toEqual(["bold", "marked", "struck"]);
    expect(indexed("**#bold** and ==#marked==")).toContain("bold");
  });

  it("walks a body: no tag inside a fence, a quoted fence or a comment over several lines", () => {
    const body = ["#one", "```", "#in-fence", "```", "> ```", "> #in-quoted-fence", "> ```", "<!--", "#in-comment", "--> #after", "~~~", "#in-tilde", "~~~", "#two\r"].join("\n");
    const tags = findInlineTagsInSource(body);
    expect(names(tags)).toEqual(["one", "after", "two"]);
    for (const tag of tags) expect(body.slice(tag.from, tag.to)).toBe("#" + tag.name);
  });
});

describe("three callers, one rule", () => {
  const note = [
    "Work on #project/site and #_draft, see issue #42.",
    "A link to a heading [[#project]] and [here](#project), a colour `#project`.",
    "```",
    "#project in code",
    "```",
    "- [ ] call back #project/site #42 `#project`",
  ].join("\n");

  it("the index counts them", () => {
    expect(indexed(note)).toEqual(["project/site", "_draft", "project/site"]);
  });

  it("the task scan reads the same ones - a leading underscore is a tag, a number is not", () => {
    expect(scanTasks(note)[0].tags).toEqual(["project/site"]);
    expect(scanTasks("- [ ] tidy #_inbox #7")[0].tags).toEqual(["_inbox"]);
  });

  it("the rename touches exactly those - not the heading links, not the code", () => {
    const renamed = renameTagInText(note, "project", "client").content.split("\n");
    expect(renamed[0]).toBe("Work on #client/site and #_draft, see issue #42.");
    expect(renamed[1]).toBe("A link to a heading [[#project]] and [here](#project), a colour `#project`.");
    expect(renamed[3]).toBe("#project in code");
    expect(renamed[5]).toBe("- [ ] call back #client/site #42 `#project`");
  });

  it("a note that only LINKS to a heading of that name does not carry the tag", () => {
    expect(contentHasTag("see [[#project]] and [x](#project)", "project")).toBe(false);
    expect(contentHasTag("**#project** first", "project")).toBe(true);
  });
});
