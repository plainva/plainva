import { describe, expect, it } from "vitest";
import { answerCoverage, answerMayLink, answerStatements, unfoundedNoteCitations } from "./coverage.js";

/** Plan KI-Harness P2b-5: coverage after the answer — how many statements name a note. */
describe("answer coverage", () => {
  it("counts paragraphs and list items of prose, not headings, code, tables or short phrases", () => {
    const answer = [
      "## Rates",
      "",
      "Here is what your notes say about the rate:",
      "",
      "- The rate stays at 95 EUR per hour until the end of the year [[Offer 2026]].",
      "- Travel is not included in the framework contract [[Framework contract]].",
      "",
      "```",
      "rate = 95",
      "```",
      "",
      "| a | b |",
      "Sources:",
    ].join("\n");
    expect(answerStatements(answer)).toEqual([
      "Here is what your notes say about the rate:",
      "The rate stays at 95 EUR per hour until the end of the year [[Offer 2026]].",
      "Travel is not included in the framework contract [[Framework contract]].",
    ]);
    expect(answerCoverage(answer)).toEqual({ statements: 3, cited: 2, level: "partial" });
  });

  it("is high when nearly every statement names a note, low when almost none does", () => {
    const cited = "The rate stays at 95 EUR per hour [[Offer 2026]].\n\nTravel is not included in the contract [[Framework contract]].";
    expect(answerCoverage(cited).level).toBe("high");
    const bare = "The rate is probably about 95 EUR per hour.\n\nTravel is usually not included in such contracts.\n\nAsk the client [[Offer 2026]] to be sure of it.";
    expect(answerCoverage(bare).level).toBe("low");
  });

  it("has no level for an answer without a statement", () => {
    expect(answerCoverage("Sure!")).toEqual({ statements: 0, cited: 0, level: null });
  });
});

/** Plan Oberfläche O7, E2: a warning only where the answer names a note as its source that the run never had. */
describe("unfounded note citations", () => {
  const grounding = { sent: ["Projects/Website relaunch.md"], read: ["Areas/Roadmap.md"] };
  /** The vault the conversation stands in, as the index lists it: every link is read against all of it. */
  const vault = [
    { path: "Projects/Website relaunch.md", title: "Website relaunch" },
    { path: "Areas/Roadmap.md", title: "Roadmap" },
    { path: "Pricing 2026.md", title: "Pricing 2026" },
    { path: "Node.js.md", title: "Node.js" },
    { path: "Vue.config.md", title: "Vue.config" },
    { path: "Q4: Plan.md", title: "Q4: Plan" },
    { path: "diagram.png", mode: "attachment" },
  ];

  it("finds nothing when every cited note went along or was read", () => {
    const answer = "The site gets three pages [[Website relaunch]].\n\n- Launch is in May [[Areas/Roadmap|the roadmap]].\n- Hero first [[Website relaunch#Goals]].";
    expect(unfoundedNoteCitations(answer, grounding)).toEqual([]);
  });

  it("names a cited note the run neither sent nor read, once, as the answer spelled it", () => {
    const answer = "Pricing is settled [[Pricing 2026]].\n\nSee also [[pricing 2026|prices]] and [[Website relaunch]].";
    expect(unfoundedNoteCitations(answer, grounding)).toEqual(["Pricing 2026"]);
  });

  it("an answer without any link earns no warning — the calm line says what it rests on", () => {
    expect(unfoundedNoteCitations("Three feature pages instead of six.\n\n- Screenshots are missing.", grounding)).toEqual([]);
  });

  it("matches by path, file name, `.md`, case and the title a note goes by", () => {
    const answer = "[[projects/website relaunch.md]] [[ROADMAP]] [[Relaunch plan]]";
    expect(unfoundedNoteCitations(answer, { ...grounding, titled: [{ path: "Projects/Website relaunch.md", title: "Relaunch plan" }] })).toEqual([]);
  });

  it("ignores embeds, links in code and links into the note's own headings", () => {
    const answer = ["![[diagram.png]]", "`[[Not a citation]]`", "```", "[[Inside a fence]]", "```", "Back to [[#Goals]]."].join("\n");
    expect(unfoundedNoteCitations(answer, grounding)).toEqual([]);
  });

  it("says nothing when the tools read more than the run listed: an unknown is no finding", () => {
    expect(unfoundedNoteCitations("Pricing is settled [[Pricing 2026]].", { ...grounding, readMore: true })).toEqual([]);
  });

  it("a run that had no notes and cites one is warned about it", () => {
    expect(unfoundedNoteCitations("Your plan says so [[Plan]].", { sent: [] })).toEqual(["Plan"]);
  });

  it("reads a wiki link with an escaped bar in a table cell as the note it names", () => {
    const answer = "| Topic | Source |\n|---|---|\n| Launch 12 May | [[Website relaunch\\|WR]] |";
    expect(unfoundedNoteCitations(answer, grounding)).toEqual([]);
  });

  it("a link in a code span of any length is no citation", () => {
    expect(unfoundedNoteCitations("Write ``[[Some note]]`` or ```[[Other]]``` to link [[Website relaunch]].", grounding)).toEqual([]);
  });

  it("checks Markdown links to notes too, and leaves addresses and other files alone", () => {
    const answer = "See [Pricing](Pricing%202026.md), [the plan](<Projects/Website relaunch.md>), [site](https://example.com), [pdf](plan.pdf).";
    // `plan.pdf` is in no list: its form says it is no note (review O7, third round).
    expect(unfoundedNoteCitations(answer, grounding)).toEqual(["Pricing 2026.md"]);
    expect(unfoundedNoteCitations(answer, { ...grounding, vault })).toEqual(["Pricing 2026.md"]);
  });

  it("a link with a folder leads where the app's rule says: a same-named note elsewhere is not the sent one", () => {
    expect(unfoundedNoteCitations("The old plan said 2025 [[Archive/Website relaunch]].", grounding)).toEqual(["Archive/Website relaunch"]);
    expect(unfoundedNoteCitations("Three pages [[Projects/Website relaunch]].", grounding)).toEqual([]);
  });

  it("reads relative links from the note the conversation stands in", () => {
    expect(unfoundedNoteCitations("Same folder [[./Website relaunch]].", { ...grounding, from: "Projects/Today.md" })).toEqual([]);
    expect(unfoundedNoteCitations("Same folder [[./Website relaunch]].", { ...grounding, from: "Areas/Today.md" })).toEqual(["./Website relaunch"]);
  });

  // Review O7, second round: what is a link to a note comes from the app's own rule, not from a list of its own.
  it("a name with a dot or a colon is a note, as the app reads it", () => {
    const g = { ...grounding, vault };
    expect(unfoundedNoteCitations("Runs on [[Node.js]], set in [[Vue.config]], as in [[Q4: Plan]].", g)).toEqual(["Node.js", "Vue.config", "Q4: Plan"]);
    // Without the vault's list the same names are still notes: nothing is skipped by how it is spelled.
    expect(unfoundedNoteCitations("Runs on [[Node.js]] and [[Q4: Plan]].", grounding)).toEqual(["Node.js", "Q4: Plan"]);
  });

  it("reads reference links and HTML links, and no wiki link inside an HTML code element", () => {
    const g = { ...grounding, vault };
    expect(unfoundedNoteCitations("See [Pricing][p].\n\n[p]: Pricing%202026.md", g)).toEqual(["Pricing 2026.md"]);
    expect(unfoundedNoteCitations('See <a href="Pricing%202026.md">prices</a>.', g)).toEqual(["Pricing 2026.md"]);
    expect(unfoundedNoteCitations("Write <code>[[Pricing 2026]]</code> to link [[Website relaunch]].", g)).toEqual([]);
    expect(unfoundedNoteCitations("[See](https://example.com) and <a href=\"mailto:x@example.com\">mail</a>.", g)).toEqual([]);
  });

  it("a bare link leads where it leads in the editor: to the note the vault answers with, not to a sent one of that name", () => {
    const files = [{ path: "Plan.md" }, { path: "Projects/Plan.md" }];
    // `[[Plan]]` opens `Plan.md` (the shorter path); the conversation had `Projects/Plan.md`.
    expect(unfoundedNoteCitations("x [[Plan]].", { sent: ["Projects/Plan.md"], from: "Areas/Today.md", vault: files })).toEqual(["Plan"]);
    expect(unfoundedNoteCitations("x [[Plan]].", { sent: ["Plan.md"], from: "Areas/Today.md", vault: files })).toEqual([]);
    // A Markdown link is read from the linking note's folder first.
    const near = [...files, { path: "Areas/Plan.md" }];
    expect(unfoundedNoteCitations("x [P](Plan.md).", { sent: ["Projects/Plan.md"], from: "Areas/Today.md", vault: near })).toEqual(["Plan.md"]);
    expect(unfoundedNoteCitations("x [P](Plan.md).", { sent: ["Areas/Plan.md"], from: "Areas/Today.md", vault: near })).toEqual([]);
  });

  it("a link to a file that is no note names no source; a note that is not there is named", () => {
    const g = { ...grounding, vault };
    expect(unfoundedNoteCitations("The picture [[diagram.png]] and [the plan](diagram.png).", g)).toEqual([]);
    expect(unfoundedNoteCitations("A note to come [[Ideas for 2027]].", g)).toEqual(["Ideas for 2027"]);
  });

  it("a title the vault lists counts like the note's path", () => {
    expect(unfoundedNoteCitations("x [[Website relaunch]] [[Roadmap]].", { ...grounding, vault })).toEqual([]);
  });

  // Review O7, third round: whether a target means a note is its form's to say — a scheme, a drive, `www.`, a folder,
  // a file of another kind —, the same in both ways of writing and whether the file is there or not; the vault's list
  // says only WHICH note. Each case with the list and without it.
  describe("by the form of the target", () => {
    const listed = [
      { path: "Projects/Website relaunch.md", title: "Website relaunch", mode: "note" },
      { path: "Areas/Roadmap.md", title: "Roadmap", mode: "note" },
      { path: "Pricing 2026.md", title: "Pricing 2026", mode: "note" },
      { path: "assets/report.pdf", title: "report.pdf", mode: "attachment" },
      { path: "assets/chart.png", title: "chart.png", mode: "attachment" },
    ];
    const silent: [string, string][] = [
      ["a web address as a wiki link", "See [[https://example.com]]."],
      ["a mail address as a wiki link", "Write [[mailto:a@b.c]]."],
      ["a drive path", "Under [[C:\\Pfad\\x]]."],
      ["an app address as a wiki link", "Open [[plainva://open?path=a]]."],
      ["a web address", "[site](https://example.com/a.md)"],
      ["www. without a scheme", "[site](www.example.com)"],
      ["an app address", "[open](plainva://open?path=Pricing%202026.md)"],
      ["a heading of this note", "[below](#abschnitt)"],
      ["an attachment that is there", "[r](assets/report.pdf)"],
      ["a PDF that is not there", "[r](budget.pdf)"],
      ["a PDF that is not there, as a wiki link", "See [[budget.pdf]]."],
      ["a picture that is not there", "See [[photo.png]]."],
      ["a picture behind a plain link", "[pic](img/photo.jpg)"],
      ["a picture shown", "![a](missing.png)"],
      ["a reference to an address", "See [site][s].\n\n[s]: https://example.com"],
      ["a definition nobody refers to", "Text.\n\n[p]: Pricing%202026.md"],
      ["<a href> to an address", 'See <a href="https://x.y/Pricing.md">x</a>.'],
      ["<a href> to a heading", 'See <a href="#top">top</a>.'],
      ["an autolink", "See <https://example.com>."],
      ["a bare address", "See https://example.com/Pricing.md now."],
      ["a folder that is there", "[p](Projects/)"],
      ["a folder that is not there", "[p](Nowhere/)"],
      ["a heading of this note, as a wiki link", "See [[#Budget]]."],
      ["a wiki link in <pre>", "<pre>[[Pricing 2026]]</pre>"],
      ["a wiki link in <code> over lines", "<code>\n[[Pricing 2026]]\n</code>"],
      ["a wiki link in a code span", "Write `[[Pricing 2026]]`."],
      ["a wiki link in a formula", "Formula $[[a]]$ ok."],
      ["escaped brackets", "Write \\[\\[Pricing 2026\\]\\]."],
    ];
    const warned: [string, string, string[]][] = [
      ["a note not sent", "x [[Pricing 2026]].", ["Pricing 2026"]],
      ["a note not sent, as a Markdown link", "x [p](Pricing%202026.md).", ["Pricing 2026.md"]],
      ["<a href> to a note not sent", '<a href="Pricing%202026.md">p</a>', ["Pricing 2026.md"]],
      ["a note that is not there", "x [[Ideas 2027]].", ["Ideas 2027"]],
      ["after a <code> that closed", "<code>a</code> [[Pricing 2026]]", ["Pricing 2026"]],
      ["in a list after a <code> of another paragraph", "<code>x\n\n- [[Pricing 2026]]", ["Pricing 2026"]],
    ];
    for (const [name, answer] of silent) {
      it(`says nothing of ${name}`, () => {
        expect(unfoundedNoteCitations(answer, { sent: ["Projects/Website relaunch.md"], vault: listed })).toEqual([]);
        expect(unfoundedNoteCitations(answer, { sent: ["Projects/Website relaunch.md"] })).toEqual([]);
      });
    }
    for (const [name, answer, names] of warned) {
      it(`names ${name}`, () => {
        expect(unfoundedNoteCitations(answer, { sent: ["Projects/Website relaunch.md"], vault: listed })).toEqual(names);
        expect(unfoundedNoteCitations(answer, { sent: ["Projects/Website relaunch.md"] })).toEqual(names);
      });
    }
    it("an answer that cannot hold a link is not read", () => {
      expect(answerMayLink("Three feature pages instead of six.\n\n- Screenshots are missing.")).toBe(false);
      for (const [, answer] of warned) expect(answerMayLink(answer)).toBe(true);
    });
  });
});
