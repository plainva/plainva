import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLISHED_PRIVATE_PROPERTIES,
  DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST,
  defaultPublishedPropertyPolicy,
  previewPublishedProjection,
  projectPublishedMarkdown,
} from "../src/index.js";

/**
 * What actually leaves the vault when a slice is published (Stufe B, S3).
 *
 * These pin the sanitizer, and the sanitizer is the one place in the whole
 * publication path where a mistake is unrecoverable: a link neutralized too
 * late has already been handed to strangers. Every assertion here is therefore
 * written as "the private thing is NOT in the output", never only as "the
 * public thing is".
 */

const INCLUDED = ["Shared/Note.md", "Shared/Deep/Other.md"];

function project(markdown: string, over: Partial<Parameters<typeof projectPublishedMarkdown>[0]> = {}) {
  return projectPublishedMarkdown({ markdown, includedPaths: INCLUDED, ...over });
}

describe("published property policy", () => {
  it("withholds what Plainva itself writes, without being told the names", () => {
    // The evidence behind decision E5. Both shells shipped the same copied
    // denylist - apiKey, password, private, secret, token - and neither of
    // these two carries any of those words:
    //
    // - plainva.pim.identity is the VERIFIED account identity of the Google or
    //   Microsoft account a mirrored task came from.
    // - OKF sources carries the RFC Message-ID of the private mail a note was
    //   captured from.
    const markdown = [
      "---",
      "title: Public report",
      "type: note",
      "sources:",
      "  - CADnac8=k7Yb@mail.gmail.com",
      "plainva:",
      "  pim:",
      "    identity: accounts.google.com:118273645",
      "---",
      "Body.",
    ].join("\n");
    const result = project(markdown);
    expect(result.markdown).not.toContain("mail.gmail.com");
    expect(result.markdown).not.toContain("accounts.google.com");
    expect(result.markdown).toContain("title: Public report");
    expect(result.report.removedProperties).toEqual(["plainva", "sources"]);
  });

  it("treats a missing allowlist as the default policy, not as publish-everything", () => {
    // What both shells store today is propertyAllowlist: null, and the document
    // schema cannot grow a field to say otherwise (assertExactKeys pins the
    // publication sub-document to five keys). So null has to MEAN the policy.
    const markdown = "---\ntitle: T\nbudget_eur: 48000\n---\nBody.";
    expect(project(markdown).report.removedProperties).toEqual(["budget_eur"]);
    expect(project(markdown, { propertyAllowlist: null }).report.removedProperties).toEqual(["budget_eur"]);
    // An explicit allowlist still wins - a deliberate custom property is named,
    // which is exactly why S3 also requires a preview before publishing.
    expect(project(markdown, { propertyAllowlist: ["title", "budget_eur"] }).report.removedProperties).toEqual([]);
  });

  it("compares property names normalized, so a spelling variant cannot slip through", () => {
    const markdown = "---\nStale-After: 2026-01-01\nAPI_Key: abc123\n---\nBody.";
    const result = project(markdown, { privateProperties: ["apikey"] });
    expect(result.markdown).not.toContain("abc123");
    // stale_after is in the default policy; Stale-After is the same property.
    expect(result.markdown).toContain("Stale-After");
    expect(result.report.removedProperties).toEqual(["API_Key"]);
  });

  it("keeps sources and the plainva namespace out of the default policy on purpose", () => {
    expect(DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST).toContain("stale_after");
    expect(DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST).not.toContain("sources");
    expect(DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST).not.toContain("plainva");
  });
});

describe("published link projection", () => {
  it("neutralizes reference links and removes the definition that carried the path", () => {
    // The definition is the actual leak: neutralizing [label][ref] while
    // leaving the definition at the bottom of the file publishes precisely the
    // path that was being withheld.
    const markdown = [
      "See [the numbers][pay] and [Shared/Note][ok].",
      "",
      "[pay]: Private/salaries.md",
      "[ok]: Shared/Note.md",
    ].join("\n");
    const result = project(markdown);
    expect(result.markdown).not.toContain("Private/salaries.md");
    expect(result.markdown).toContain("the numbers");
    expect(result.markdown).toContain("[ok]: Shared/Note.md");
    expect(result.report.neutralizedLinks).toEqual(["Private/salaries.md"]);
  });

  it("removes an unreferenced definition on the strength of its destination alone", () => {
    // Nothing points at it, so no link is rewritten - and the path would still
    // be sitting in the published file in plain sight.
    const result = project("Body only.\n\n[ghost]: Private/plan.md\n");
    expect(result.markdown).not.toContain("Private/plan.md");
    expect(result.report.neutralizedLinks).toEqual(["Private/plan.md"]);
  });

  it("handles collapsed and shortcut reference forms", () => {
    const markdown = [
      "A [Private/x][] and a [pay].",
      "",
      "[Private/x]: Private/x.md",
      "[pay]: Private/pay.md",
    ].join("\n");
    const result = project(markdown);
    expect(result.markdown).not.toContain("Private/x.md");
    expect(result.markdown).not.toContain("Private/pay.md");
    expect(result.report.neutralizedLinks).toEqual(["Private/pay.md", "Private/x.md"]);
  });

  it("reads an angle-bracket destination and an inline title", () => {
    const result = project("A [label](<Private/with space.md> \"Title\") here.");
    expect(result.markdown).not.toContain("Private/with space.md");
    expect(result.markdown).toContain("A label here.");
  });

  it("neutralizes HTML anchors and drops HTML images", () => {
    const markdown = [
      "<a href=\"Private/leak.md\">click</a>",
      "<img src=\"Private/photo.png\" alt=\"x\">",
      "<a href=\"https://plainva.com\">out</a>",
    ].join("\n");
    const result = project(markdown);
    expect(result.markdown).not.toContain("Private/leak.md");
    expect(result.markdown).not.toContain("Private/photo.png");
    expect(result.markdown).toContain("click");
    expect(result.markdown).toContain("<a href=\"https://plainva.com\">out</a>");
    expect(result.report.neutralizedLinks).toEqual(["Private/leak.md"]);
    expect(result.report.removedEmbeds).toEqual(["Private/photo.png"]);
  });

  it("leaves external destinations alone but does not mistake a drive letter for a scheme", () => {
    // "external" means "left untouched" - the leaky direction. A one-letter
    // scheme rule would read a Windows path as a URI and publish it.
    const result = project("[a](https://x.test) [b](mailto:x@y.test) [c](#top) [d](C:/notes/private.md)");
    expect(result.markdown).toContain("https://x.test");
    expect(result.markdown).toContain("mailto:x@y.test");
    expect(result.markdown).toContain("(#top)");
    expect(result.markdown).not.toContain("C:/notes/private.md");
    expect(result.report.neutralizedLinks).toEqual(["C:/notes/private.md"]);
  });

  it("matches an included path through its slash and extension shape", () => {
    const result = project("[[Shared\\Deep\\Other]] and [x](Shared/Deep/Other.md)");
    expect(result.report.neutralizedLinks).toEqual([]);
    expect(result.markdown).toContain("Shared\\Deep\\Other");
  });
});

describe("published projection and code blocks", () => {
  it("leaves fenced examples exactly as written", () => {
    // A fence almost always holds a documented example - rewriting it hands the
    // reader instructions that no longer work. The tradeoff is deliberate and
    // narrow: the target stays visible inside the fence, which is why only
    // FENCED blocks are skipped and indented ones are not (four spaces inside a
    // list item is ordinary content, and a missed leak costs more than a
    // mangled example).
    const markdown = [
      "Real: [[Private/Note]]",
      "",
      "```md",
      "[[Private/Note]]",
      "[x](Private/x.md)",
      "```",
      "",
      "~~~",
      "[[Private/Other]]",
      "~~~",
    ].join("\n");
    const result = project(markdown);
    expect(result.markdown).toContain("```md\n[[Private/Note]]\n[x](Private/x.md)\n```");
    expect(result.markdown).toContain("~~~\n[[Private/Other]]\n~~~");
    // The real link outside the fence is still neutralized, and the fenced
    // copies never reach the report.
    expect(result.markdown).toContain("Real: Note");
    expect(result.report.neutralizedLinks).toEqual(["Private/Note"]);
  });

  it("does not treat an unterminated fence as ordinary text", () => {
    const result = project("Intro\n\n```\n[[Private/Note]]\n");
    expect(result.markdown).toContain("[[Private/Note]]");
    expect(result.report.neutralizedLinks).toEqual([]);
  });

  it("ignores a definition that only exists inside a fence", () => {
    const markdown = ["Use [pay] here.", "", "```", "[pay]: Private/salaries.md", "```"].join("\n");
    const result = project(markdown);
    // No definition outside the fence, so [pay] is not a link at all.
    expect(result.markdown).toContain("Use [pay] here.");
    expect(result.report.neutralizedLinks).toEqual([]);
  });
});

describe("published projection report", () => {
  it("names each withheld path once, sorted", () => {
    // A preview listing the same path three times reads as a bug in the
    // preview rather than as three separate leaks.
    const markdown = "[[Private/b]] [[Private/b]] [x](Private/a.md) ![[Private/img.png]] ![[Private/img.png]]";
    const result = project(markdown);
    expect(result.report.neutralizedLinks).toEqual(["Private/a.md", "Private/b"]);
    expect(result.report.removedEmbeds).toEqual(["Private/img.png"]);
  });
});

describe("published property policy is shared, not copied", () => {
  it("carries exactly what both shells used to hardcode", () => {
    // Desktop and mobile each wrote the same five names into every publication
    // they created. Two copies of a policy are equal only until somebody edits
    // one of them - this pins that replacing them changed nothing.
    expect(DEFAULT_PUBLISHED_PRIVATE_PROPERTIES).toEqual(["apiKey", "password", "private", "secret", "token"]);
  });

  it("stores the allowlist as null so the policy stays code", () => {
    // A materialized list would freeze a publication on the policy of the day it
    // was created: a property added to the default list later, because it turned
    // out to leak, would keep leaking from every publication that already exists.
    const policy = defaultPublishedPropertyPolicy();
    expect(policy.propertyAllowlist).toBeNull();
    expect(policy.privateProperties).toEqual([...DEFAULT_PUBLISHED_PRIVATE_PROPERTIES]);
  });

  it("hands out a copy, so one caller cannot rewrite the policy for the next", () => {
    const policy = defaultPublishedPropertyPolicy();
    policy.privateProperties.push("everything");
    expect(defaultPublishedPropertyPolicy().privateProperties).not.toContain("everything");
    expect(DEFAULT_PUBLISHED_PRIVATE_PROPERTIES).not.toContain("everything");
  });
});

describe("published projection preview", () => {
  const objects = [
    { path: "Shared/Note.md", markdown: "---\ntitle: A\n---\nSee [x](Shared/Deep/Other.md)." },
    {
      path: "Shared/Deep/Other.md",
      markdown:
        "---\ntitle: B\nsources:\n  - CADnac8=k7Yb@mail.gmail.com\n---\nSee [[Private/Plan]] and ![[Private/img.png]].",
    },
  ];

  it("computes against the very set of objects it is showing", () => {
    // includedPaths is derived from objects rather than passed in, so the
    // preview cannot be clean while the publication is not. Same first note,
    // twice - and its link to the second one is a slice member in one run and a
    // withheld path in the other, purely because the slice changed.
    const both = previewPublishedProjection({ mode: "sanitized", objects });
    expect(both.objectCount).toBe(2);
    expect(both.neutralizedLinks).toEqual(["Private/Plan"]);
    expect(both.removedEmbeds).toEqual(["Private/img.png"]);
    expect(both.sample?.after).not.toContain("Private/Plan");

    const alone = previewPublishedProjection({ mode: "sanitized", objects: [objects[0]] });
    expect(alone.neutralizedLinks).toEqual(["Shared/Deep/Other.md"]);
    expect(alone.sample?.after).not.toContain("Shared/Deep/Other.md");
  });

  it("shows the object with the most removals, not the first one", () => {
    // The preview exists to answer "what gets taken out". A first object that
    // happens to be clean answers that question with silence.
    const preview = previewPublishedProjection({ mode: "sanitized", objects });
    expect(preview.sample?.path).toBe("Shared/Deep/Other.md");
    expect(preview.sample?.before).toContain("mail.gmail.com");
    expect(preview.sample?.after).not.toContain("mail.gmail.com");
  });

  it("reports each withheld name once, sorted, across the whole slice", () => {
    const twice = [
      { path: "a.md", markdown: "---\nbudget_eur: 1\n---\n[x](Private/p.md)" },
      { path: "b.md", markdown: "---\nbudget_eur: 2\n---\n[y](Private/p.md)" },
    ];
    const preview = previewPublishedProjection({ mode: "sanitized", objects: twice });
    expect(preview.removedProperties).toEqual(["budget_eur"]);
    expect(preview.neutralizedLinks).toEqual(["Private/p.md"]);
  });

  it("runs no projection at all in exact mode", () => {
    // An exact publication is the whole note. Showing a sanitized preview for it
    // would be a comforting lie about what leaves the vault.
    const preview = previewPublishedProjection({ mode: "exact", objects });
    expect(preview.unchanged).toBe(true);
    expect(preview.removedProperties).toEqual([]);
    expect(preview.neutralizedLinks).toEqual([]);
    expect(preview.sample?.after).toBe(objects[0].markdown);
    expect(preview.sample?.after).toContain("Shared/Deep/Other.md");
  });

  it("says so plainly when a sanitized slice has nothing to take out", () => {
    const clean = [{ path: "Shared/Note.md", markdown: "---\ntitle: A\n---\nJust prose." }];
    const preview = previewPublishedProjection({ mode: "sanitized", objects: clean });
    expect(preview.unchanged).toBe(true);
    expect(preview.sample?.path).toBe("Shared/Note.md");
  });

  it("has no sample for an empty slice", () => {
    const preview = previewPublishedProjection({ mode: "sanitized", objects: [] });
    expect(preview.objectCount).toBe(0);
    expect(preview.sample).toBeNull();
    expect(preview.unchanged).toBe(true);
  });
});
