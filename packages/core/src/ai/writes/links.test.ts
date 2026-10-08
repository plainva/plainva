import { describe, expect, it } from "vitest";
import { parseWriteDraft } from "./drafts.js";
import { LINK_CHECK_LIMITS, addedNoteTargets, linkedNoteName, linkedNoteTargets, parseMissingLinks } from "./links.js";
import { WRITE_RESULTS } from "./sentences.js";

/**
 * What the source check reads (plan KI-Harness P5-7): the notes a text names
 * as links. Nothing here knows a vault; it finds the names.
 */
describe("the notes a text links to", () => {
  it("are the targets of its wiki links and embeds, by the name each link gives — once, in order", () => {
    const text = "See [[Offer 2026]] and [[Projects/Brief|the brief]], also [[offer 2026#Rates]].\n\n![[Diagram]]\n\nAgain [[Offer 2026]].";
    expect(linkedNoteTargets(text)).toEqual(["Offer 2026", "Projects/Brief", "Diagram"]);
  });

  it("leaves out a place in the note itself, an empty link and a link to a file that is no note", () => {
    expect(linkedNoteTargets("[[#Rates]] [[ ]] [[]] ![[photo.png]] [[Books.base]] [[report.pdf|the report]] [[Notes.md]] [[v2]]")).toEqual(["Notes.md", "v2"]);
  });

  it("counts a note once, with or without the extension a link spells out", () => {
    expect(linkedNoteTargets("[[Brief]] [[brief.md]] [[BRIEF.MD#Scope]] [[Projects/Brief.md]] [[.md]]")).toEqual(["Brief", "Projects/Brief.md"]);
    expect(linkedNoteName("Projects/Brief.md")).toBe("Projects/Brief");
    expect(linkedNoteName("Brief.MD")).toBe("Brief");
    expect(linkedNoteName("Brief")).toBe("Brief");
    // A link the note had with its extension is not added by writing it without.
    expect(addedNoteTargets("See [[Brief.md]].", "See [[Brief]] and [[New]].")).toEqual(["New"]);
  });

  it("does not read code: a fenced block and a code span say [[x]] without linking anything", () => {
    const text = ["Before [[Real]].", "```md", "[[In a fence]]", "```", "Inline `[[In a span]]` and ``[[In two ticks]]`` but [[Also real]].", "~~~", "[[In a tilde fence]]", "~~~"].join("\n");
    expect(linkedNoteTargets(text)).toEqual(["Real", "Also real"]);
    // A fence that never closes hides the rest, as a reader would see it.
    expect(linkedNoteTargets("```\n[[Hidden]]\n\n[[Still hidden]]")).toEqual([]);
    // A fence closes with at least as many of the same character.
    expect(linkedNoteTargets("````\n```\n[[Inside]]\n````\n[[Outside]]")).toEqual(["Outside"]);
  });

  it("reads a code span as a reader does: closed by a run of exactly as many backticks, and text where nothing closes it", () => {
    // Two ticks are not closed by one: the single tick inside belongs to the span.
    expect(linkedNoteTargets("``a ` [[In]] ` b`` [[Out]]")).toEqual(["Out"]);
    // A run nothing closes is text, and what follows it is no code.
    expect(linkedNoteTargets("A stray ` and then [[Real]].")).toEqual(["Real"]);
    expect(linkedNoteTargets("x ```three [[Real]] and `[[one]]` after")).toEqual(["Real"]);
    // Three backticks with a backtick behind them open no block: the line is a paragraph, and the text goes on.
    expect(linkedNoteTargets("```[[In a span]]``` and [[Real]]\n\n[[Also real]]")).toEqual(["Real", "Also real"]);
    expect(linkedNoteTargets("```md [[info]]\n[[Hidden]]\n```\n[[Shown]]")).toEqual(["Shown"]);
    // Two spans on one line, a link between them.
    expect(linkedNoteTargets("`[[A]]` [[B]] `[[C]]`")).toEqual(["B"]);
    // A span does not reach over a line.
    expect(linkedNoteTargets("`open\n[[Next line]] close`")).toEqual(["Next line"]);
  });

  it("stays quick on a line made of backticks", () => {
    // Runs of every length up to 600, none closed, on one line of 180,000 characters — and a link at its end.
    const hostile = `${Array.from({ length: 600 }, (_, index) => `${"`".repeat(index + 1)} x`).join(" ")} [[Real]]`;
    const started = Date.now();
    expect(linkedNoteTargets(hostile)).toEqual(["Real"]);
    expect(linkedNoteTargets(`${"` ".repeat(60_000)}[[Odd]]`)).toEqual(["Odd"]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reads a text with \\r\\n as it reads one with \\n", () => {
    expect(linkedNoteTargets("One [[A]]\r\n```\r\n[[B]]\r\n```\r\n[[C]]")).toEqual(["A", "C"]);
  });

  it("stops at its bound", () => {
    const many = Array.from({ length: LINK_CHECK_LIMITS.targets + 20 }, (_, index) => `[[Note ${index}]]`).join(" ");
    expect(linkedNoteTargets(many)).toHaveLength(LINK_CHECK_LIMITS.targets);
  });
});

describe("the links a change adds", () => {
  it("are those the note did not have — whatever their letter case, alias or heading", () => {
    const base = "# Offer\n\nSee [[Brief]] and [[Rates#2026|the rates]].\n";
    const next = "# Offer\n\nSee [[brief|our brief]], [[Rates]], [[Contract 2025]] and [[Kick-off]].\n";
    expect(addedNoteTargets(base, next)).toEqual(["Contract 2025", "Kick-off"]);
    expect(addedNoteTargets(base, base)).toEqual([]);
    // A link that only moved into code is no new link, and one that left code is.
    expect(addedNoteTargets("`[[Draft]]`", "[[Draft]]")).toEqual(["Draft"]);
  });
});

describe("the names a record keeps", () => {
  it("are text, bounded, and nothing a name cannot be", () => {
    expect(parseMissingLinks(["Contract 2025", " Kick-off ", "Contract 2025", "", 7, "two\nlines", "a]]b", "x".repeat(301)])).toEqual(["Contract 2025", "Kick-off"]);
    expect(parseMissingLinks("Contract 2025")).toEqual([]);
    expect(parseMissingLinks(undefined)).toEqual([]);
  });

  it("travel with a draft, and a draft from before the check has none", () => {
    const draft = { id: "d-000001", createdAt: "2026-10-08T10:00:00.000Z", author: { id: "plainva-ai/m-1", label: "Plainva AI · m-1" }, conversationId: null, title: "Kick-off", body: { kind: "note", path: null, folder: null, content: "See [[Contract 2025]]." }, inherited: [], sources: [], defused: 0 };
    expect(parseWriteDraft(draft)).not.toHaveProperty("missing");
    expect(parseWriteDraft({ ...draft, missing: ["Contract 2025", 3, "a|b"] })!.missing).toEqual(["Contract 2025"]);
    expect(parseWriteDraft({ ...draft, missing: [] })).not.toHaveProperty("missing");
    // The second list — links to notes the rules kept from the writer — is read the same way, and apart.
    expect(parseWriteDraft(draft)).not.toHaveProperty("withheld");
    const both = parseWriteDraft({ ...draft, missing: ["Contract 2025"], withheld: ["Diary", "two\nlines", "Diary"] })!;
    expect(both.missing).toEqual(["Contract 2025"]);
    expect(both.withheld).toEqual(["Diary"]);
    expect(parseWriteDraft({ ...draft, withheld: "Diary" })).not.toHaveProperty("withheld");
  });
});

describe("what a tool says about links that lead nowhere", () => {
  it("names them back — once for one, a few of many — and says nothing where every link leads somewhere", () => {
    expect(WRITE_RESULTS.proposed("Offer.md", 1, 0)).toBe(WRITE_RESULTS.proposed("Offer.md", 1, 0, []));
    expect(WRITE_RESULTS.proposed("Offer.md", 1, 0, ["Contract 2025"])).toBe(
      "Proposed on Offer.md: 1 change. Nothing in the vault has changed. The user accepts or declines each change in Plainva. Your text links to a note that is not available here: [[Contract 2025]]. The user is told about this link.",
    );
    const many = Array.from({ length: LINK_CHECK_LIMITS.named + 3 }, (_, index) => `N${index}`);
    const said = WRITE_RESULTS.drafted('a note "Kick-off"', 0, many);
    expect(said).toContain(`Your text links to notes that are not available here: ${many.slice(0, LINK_CHECK_LIMITS.named).map((name) => `[[${name}]]`).join(", ")} and 3 more. The user is told about these links.`);
    // A name is the model's own words handed back: cut where it is no name any more.
    expect(WRITE_RESULTS.drafted("a journal entry", 0, ["x".repeat(500)])).toContain(`[[${"x".repeat(120)}]]`);
  });

  it("uses the words a read uses for a note that is not there or kept back — one sentence for both, so a name is not found out by trying it", () => {
    // The sentence takes names and nothing else: whoever calls it has no way to say which kind a name is.
    const said = WRITE_RESULTS.proposed("Offer.md", 1, 0, ["Contract 2025", "Diary"]);
    expect(said).toContain("not available here: [[Contract 2025]], [[Diary]].");
    expect(said).not.toMatch(/does not (have|exist)|kept|rule|privacy|withheld|may not/i);
  });
});
