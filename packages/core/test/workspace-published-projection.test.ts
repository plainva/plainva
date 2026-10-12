import { describe, expect, it } from "vitest";
import {
  DEFAULT_PUBLISHED_PRIVATE_PROPERTIES,
  DEFAULT_PUBLISHED_PROPERTY_ALLOWLIST,
  FrontmatterSurgicalError,
  PUBLISHED_NOTE_REFUSED,
  PublishedNoteRefusedError,
  WorkspaceProtocolError,
  defaultPublishedPropertyPolicy,
  previewPublishedProjection,
  projectPublishedMarkdown,
  projectPublishedNote,
  publishedSliceProviderInstructions,
} from "../src/index.js";
import { splitDocument } from "../src/frontmatter-block.js";
import { FRONTMATTER_FORMS } from "./fixtures/frontmatterForms.js";

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

/**
 * Everything one call lets out: the note it would publish, what it reports
 * about it, and - where it refuses - what it says. A refusal hands out no note
 * and no report, so what it SAYS is all there is to check for a leak.
 */
function handedOut(markdown: string) {
  try {
    const result = project(markdown);
    return { note: result.markdown as string | null, report: result.report as typeof result.report | null, refusal: null as unknown };
  } catch (refusal) {
    return { note: null, report: null, refusal };
  }
}

/** Whether the property writers refuse to touch the note's block (`splitDocument` is where they all start). */
function writersRefuse(markdown: string): boolean {
  try {
    splitDocument(markdown);
    return false;
  } catch (error) {
    if (error instanceof FrontmatterSurgicalError) return true;
    throw error;
  }
}

/** Built from its code point: an escape in a source file is easily saved as the invisible character itself. */
const BOM = String.fromCharCode(0xfeff);

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

describe("published properties, wherever a reader sees a block", () => {
  // The sanitizer carried a search of its own for the block: `---` lines with
  // the line ending of the first one. What it did not find it did not filter,
  // and the note left with every property it had — while the reader on the
  // other side took the same lines for properties (finding 2026-10-07).
  it.each([
    ["closed at the very end of the file", "---\ntitle: Public\nsecret: hidden-value\n---"],
    ["closed by a fence with another line ending", "---\r\ntitle: Public\r\nsecret: hidden-value\n---\nBody."],
    ["opened with CRLF, the rest LF", "---\r\ntitle: Public\nsecret: hidden-value\n---\nBody."],
    ["closed by a fence with a blank behind it", "---\ntitle: Public\nsecret: hidden-value\n--- \nBody."],
    ["opened by a fence with a blank behind it", "--- \ntitle: Public\nsecret: hidden-value\n---\nBody."],
    ["behind a byte order mark", "\uFEFF---\ntitle: Public\nsecret: hidden-value\n---\nBody."],
    // A carriage return of its own ends a line for the reader on the other
    // side; the definition read on past it and found no block (2026-10-11).
    ["of a note from a classic Mac", "---\rtitle: Public\rsecret: hidden-value\r---\rBody."],
    ["closed by a fence behind a stray carriage return", "---\ntitle: Public\nsecret: hidden-value\r---\nBody."],
    ["opened by a fence that ends in a carriage return", "---\rtitle: Public\nsecret: hidden-value\n---\nBody."],
  ])("withholds a private property of a block %s", (_form, markdown) => {
    const result = project(markdown);
    expect(result.markdown).not.toContain("hidden-value");
    expect(result.markdown).not.toContain("secret");
    expect(result.markdown).toContain("title: Public");
    expect(result.report.removedProperties).toEqual(["secret"]);
  });

  it("keeps the text behind a block without entries, rule included", () => {
    // `---` on `---` was not found as a block; the search ran on to the rule
    // in the text and everything in between was dropped as "properties".
    expect(project("---\n---\nIntro.\n\n---\n\nRest.\n").markdown).toBe("Intro.\n\n---\n\nRest.\n");
    expect(project("---\r\n---\r\nIntro.\r\n\r\n---\r\n\r\nRest.\r\n").markdown).toBe("Intro.\r\n\r\n---\r\n\r\nRest.\r\n");
  });

  it("leaves no block behind when every property is withheld, unless the text opens with a rule", () => {
    expect(project("---\nsecret: hidden-value\n---\nBody.\n").markdown).toBe("Body.\n");
    // Dropped, the text's own `---` would open a block on the other side.
    expect(project("---\nsecret: hidden-value\n---\n---\nIntro.\n---\n").markdown).toBe("---\n---\n---\nIntro.\n---\n");
  });
});

describe("a block that names no properties", () => {
  // Properties are a YAML map, and an allowlist judges names. Text between two
  // rules at the top of a note parses as one string, a list as an array - and
  // the sanitizer walked both as if they were a record. The report named "0",
  // "1", "2" as removed properties, the preview counted them, and the block
  // was gone from the published note without a word. A number, or a `null`
  // that is spelt out, went the same way with no entry in the report at all
  // (finding 2026-10-09).
  //
  // Such a note is refused, as one whose YAML does not parse always was. Each
  // form below carries something that must not leave, and each case fails on
  // the code before: there the note came back, without its block.
  const NO_MAP: ReadonlyArray<readonly [string, string]> = [
    ["plain text", "---\nSalary 4800, hidden-value\n---\nBody.\n"],
    ["text over two lines", "---\nCall Anna about the offer,\nhidden-value\n---\nBody.\n"],
    ["a list", "---\n- anna@example.org\n- hidden-value\n---\nBody.\n"],
    ["a list in brackets", "---\n[anna@example.org, hidden-value]\n---\nBody.\n"],
    ["a null that is spelt out", "---\nnull # hidden-value\n---\nBody.\n"],
    ["a tilde under a comment", "---\n# password: hidden-value\n~\n---\nBody.\n"],
    ["a number", "---\n4800 # hidden-value\n---\nBody.\n"],
    ["a quoted string", "---\n\"hidden-value\"\n---\nBody.\n"],
    ["a block scalar", "---\n|\n  hidden-value\n---\nBody.\n"],
    ["text, with Windows line ends", "---\r\nSalary 4800, hidden-value\r\n---\r\nBody.\r\n"],
    ["text, with the line ends of a classic Mac", "---\rSalary 4800, hidden-value\r---\rBody.\r"],
    ["text behind a byte order mark", `${BOM}---\nSalary 4800, hidden-value\n---\nBody.\n`],
    ["text closed at the very end of the file", "---\nSalary 4800, hidden-value\n---"],
  ];
  // What the sanitizer refused before, too - held here for what it says.
  const UNPARSEABLE: ReadonlyArray<readonly [string, string]> = [
    ["an unclosed quote", "---\ntitle: \"unclosed\nsecret: hidden-value\n---\nBody.\n"],
    ["a property named twice", "---\ntitle: Public\ntitle: hidden-value\n---\nBody.\n"],
  ];
  // A block without content says nothing, and nothing is no properties.
  const WITHOUT_ENTRIES: ReadonlyArray<readonly [string, string]> = [
    ["no line", "---\n---\nBody.\n"],
    ["a blank line", "---\n\n---\nBody.\n"],
    ["a comment alone", "---\n# password: hidden-value\n---\nBody.\n"],
    ["an empty map", "---\n{}\n---\nBody.\n"],
  ];

  it.each(NO_MAP)("refuses a note whose block is %s, and nothing of it leaves", (_form, markdown) => {
    const out = handedOut(markdown);
    // Not in a note, not in a report, and not in the words of the refusal.
    expect(JSON.stringify([out.note, out.report, String(out.refusal)])).not.toContain("hidden-value");
    expect(out.note).toBeNull();
    // No report at all: no character position and no place in a list is named
    // as a property that was removed.
    expect(out.report).toBeNull();
    expect(out.refusal).toBeInstanceOf(WorkspaceProtocolError);
    expect((out.refusal as WorkspaceProtocolError).code).toBe("format");
  });

  it.each([...NO_MAP, ...UNPARSEABLE])("says one fixed sentence about a block that is %s, never the note's own words", (_form, markdown) => {
    // The YAML parser's message quotes the line it stumbled over. This one is
    // shown in the app and kept in the publication's record.
    const { refusal } = handedOut(markdown);
    expect((refusal as Error).message).toBe("published slice frontmatter is invalid");
    expect(String(refusal)).not.toContain("hidden-value");
    expect(String(refusal)).not.toContain("unclosed");
  });

  it.each(WITHOUT_ENTRIES)("publishes a note whose block is %s without a block, comment included", (_form, markdown) => {
    const out = handedOut(markdown);
    expect(out.refusal).toBeNull();
    expect(out.note).not.toContain("hidden-value");
    expect(out.note).toBe("Body.\n");
    expect(out.report?.removedProperties).toEqual([]);
  });

  it("takes a `null` that is spelt out for what it says, in every spelling", () => {
    // The line the writers draw (`splitDocument`) and the OKF check with them:
    // an empty block is a block without entries, a block that says `null` says
    // something - and it is no map.
    for (const spelling of ["null", "Null", "NULL", "~"]) {
      expect(handedOut(`---\n${spelling}\n---\nBody.\n`).refusal, spelling).toBeInstanceOf(WorkspaceProtocolError);
      expect(writersRefuse(`---\n${spelling}\n---\nBody.\n`), spelling).toBe(true);
    }
  });

  // One rule for what a properties block is, asked by the writers and by the
  // sanitizer alike (`parseBlockYaml`). Held on every form of this file and on
  // the table the definition itself is held on: where a writer refuses to
  // touch the block, the sanitizer refuses to publish from it - and nowhere
  // else.
  it.each([
    ...NO_MAP,
    ...UNPARSEABLE,
    ...WITHOUT_ENTRIES,
    ["a map", "---\ntitle: Public\nsecret: hidden-value\n---\nBody.\n"] as const,
    ...FRONTMATTER_FORMS.map((form) => [JSON.stringify(form), form] as const),
  ])("answers like the writers for %s", (_form, markdown) => {
    expect(handedOut(markdown).refusal !== null).toBe(writersRefuse(markdown));
  });

  it("still takes a property whose name is a number for a property", () => {
    // What must not come back with the indices is a rule against digits: a
    // year as a key is a name like any other, removed and named as such.
    const result = project("---\n2024: hidden-value\ntitle: Public\n---\nBody.\n");
    expect(result.markdown).not.toContain("hidden-value");
    expect(result.markdown).toBe("---\ntitle: Public\n---\nBody.\n");
    expect(result.report.removedProperties).toEqual(["2024"]);
  });

  it("leaves a comment in the block at home with the properties that stay", () => {
    // Held, not changed: the block is written anew from what passed the list,
    // so a line that was commented out - the usual place for a key somebody
    // meant to delete - never travels.
    const result = project("---\ntitle: Public\n# password: hidden-value\nstatus: open # hidden-value\n---\nBody.\n");
    expect(result.markdown).not.toContain("hidden-value");
    expect(result.markdown).not.toContain("password");
    expect(result.markdown).toBe("---\ntitle: Public\nstatus: open\n---\nBody.\n");
  });
});

describe("the sanitizer, for a note whose path is known", () => {
  // `projectPublishedMarkdown` is handed text and cannot say which note it
  // refuses. The preview and the refresh know, and a slice is many notes.
  const DRAFT = "---\nSalary 4800, hidden-value\n---\nBody.\n";

  function refusalOf(markdown: string, path = "Shared/Draft.md"): unknown {
    try {
      projectPublishedNote({ path, markdown, includedPaths: INCLUDED });
      return null;
    } catch (error) {
      return error;
    }
  }

  it("names the note it refuses, and nothing the note says", () => {
    const refusal = refusalOf(DRAFT);
    expect(refusal).toBeInstanceOf(PublishedNoteRefusedError);
    expect((refusal as PublishedNoteRefusedError).path).toBe("Shared/Draft.md");
    // How the shells recognise it: by how the message begins, with the path behind.
    expect((refusal as Error).message).toBe(`${PUBLISHED_NOTE_REFUSED}Shared/Draft.md`);
    expect(String(refusal)).not.toContain("hidden-value");
    expect(String(refusal)).not.toContain("4800");
  });

  it("names a note whose YAML does not parse the same way", () => {
    // Refused before as well, but by a sentence without a note in it.
    const refusal = refusalOf("---\ntitle: \"unclosed\nsecret: hidden-value\n---\nBody.\n", "Shared/Deep/Other.md");
    expect((refusal as Error).message).toBe(`${PUBLISHED_NOTE_REFUSED}Shared/Deep/Other.md`);
    expect(String(refusal)).not.toContain("hidden-value");
    expect(String(refusal)).not.toContain("unclosed");
  });

  it("is the same projection where nothing is refused", () => {
    const markdown = "---\ntitle: Public\nsecret: hidden-value\n---\nSee [[Private/Plan]].\n";
    const named = projectPublishedNote({ path: "Shared/Note.md", markdown, includedPaths: INCLUDED });
    expect(named).toEqual(project(markdown));
    expect(named.markdown).not.toContain("hidden-value");
    expect(named.markdown).not.toContain("Private/Plan");
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

  it("ends at a note the sanitizer refuses, and names it", () => {
    // The numbers used to carry on. The note's block was counted as so many
    // removed properties - one for every character of its text -, and with the
    // most "removals" of the slice the note became the sample: a preview that
    // showed the text going, and said it was properties.
    const withDraft = [...objects, { path: "Shared/Draft.md", markdown: "---\nSalary 4800, hidden-value\n---\nText." }];
    let preview: ReturnType<typeof previewPublishedProjection> | null = null;
    let refusal: unknown = null;
    try {
      preview = previewPublishedProjection({ mode: "sanitized", objects: withDraft });
    } catch (error) {
      refusal = error;
    }
    // No numbers for a publication that does not come about: the refresh stops
    // at the same note.
    expect(preview).toBeNull();
    expect(refusal).toBeInstanceOf(PublishedNoteRefusedError);
    expect((refusal as PublishedNoteRefusedError).path).toBe("Shared/Draft.md");
    expect(String(refusal)).not.toContain("hidden-value");
    expect(String(refusal)).not.toContain("4800");
  });

  it("hands an exact publication's note out as it is, whatever stands at its top", () => {
    // Exact projects nothing, so it refuses nothing - and says so.
    const draft = { path: "Shared/Draft.md", markdown: "---\nA line between two rules\n---\nText." };
    const preview = previewPublishedProjection({ mode: "exact", objects: [draft] });
    expect(preview.unchanged).toBe(true);
    expect(preview.removedProperties).toEqual([]);
    expect(preview.sample?.after).toBe(draft.markdown);
  });
});

describe("provider setup instructions", () => {
  /**
   * The shell needs a total mapping from these ids to locale keys, and a
   * missing one shows a publisher a blank line exactly where the advice was
   * supposed to be. Listing them here means adding a provider fails this test
   * before it can ship an untranslated instruction.
   */
  const ALL_IDS = [
    "dedicated-folder-permission",
    "no-link-wide-access",
    "specific-people-link",
    "download-block-optional",
    "dedicated-folder-invite",
    "no-public-link",
    "share-password-expiry",
    "credentials-outside",
    "dedicated-collection",
    "tls-separate-account",
    "dedicated-prefix-deny-default",
    "no-public-access-tls",
  ];

  const PROVIDERS = ["google-drive", "onedrive", "dropbox", "nextcloud", "webdav", "s3"] as const;

  it("covers every provider and emits no id the shell does not know", () => {
    const seen = new Set<string>();
    for (const provider of PROVIDERS) {
      const instructions = publishedSliceProviderInstructions({ provider, access: "read" });
      expect(instructions.length).toBeGreaterThan(0);
      for (const instruction of instructions) {
        expect(ALL_IDS).toContain(instruction.id);
        seen.add(instruction.id);
      }
    }
    // The other direction: no id sits in the locales without a provider that
    // asks for it, so a rename cannot leave a dead key behind.
    expect([...seen].sort()).toEqual([...ALL_IDS].sort());
  });

  it("names the weaker permission for read-only and the stronger one where recipients write", () => {
    const read = publishedSliceProviderInstructions({ provider: "google-drive", access: "read" });
    expect(read[0]).toEqual({ id: "dedicated-folder-permission", permission: "viewer" });

    for (const access of ["comment", "suggest"] as const) {
      const writable = publishedSliceProviderInstructions({ provider: "google-drive", access });
      expect(writable[0]).toEqual({ id: "dedicated-folder-permission", permission: "commenter" });
    }
  });

  it("leaves the permission unset where the sentence does not name one", () => {
    // A hint the shell cannot use would be a parameter with no slot in the
    // string - the locale would silently drop it.
    const nextcloud = publishedSliceProviderInstructions({ provider: "nextcloud", access: "comment" });
    expect(nextcloud.every((instruction) => instruction.permission === undefined)).toBe(true);
  });
});
