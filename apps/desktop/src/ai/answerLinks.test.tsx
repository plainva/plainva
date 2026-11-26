// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { markdownDestinationUrl } from "@plainva/core";
import { type AnswerGrounding } from "@plainva/core/ai";
import { AiAnswer, answerLinksShown, answerMayLink, unfoundedAmongShown } from "@plainva/ui/ai";

/**
 * The links an answer's source check reads are the links the answer's view shows (review O7, fifth round): read by
 * the parser the view renders with, and led where a click on them leads (`planLinkOpen`). Before, the check read the
 * answer with the editor's parser (`parseMarkdownAst`): a link in `<code>`, `<pre>`, `<kbd>` or an indented block
 * was shown and not checked, an `<a href>` and a reference link were checked and shown as text.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** What the view draws as a link into the vault — a wiki link by its target, a Markdown link by its `href` — in order. */
function linksDrawn(answer: string): string[] {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AiAnswer text={answer} onOpenNote={() => undefined} onOpenUrl={() => undefined} />));
  const out: string[] = [];
  for (const a of host.querySelectorAll("a")) {
    const wiki = a.getAttribute("data-wiki-target");
    const href = a.getAttribute("href") ?? "";
    if (wiki !== null) out.push(`wiki:${wiki}`);
    // A web address and a bare URL open outside: they name no note.
    else if (!/^https?:\/\//i.test(href)) out.push(`markdown:${href}`);
  }
  act(() => root?.unmount());
  host.remove();
  root = null;
  host = null;
  return out;
}

const linksRead = (answer: string) => answerLinksShown(answer).map((link) => (link.kind === "wiki" ? `wiki:${link.text}` : `markdown:${markdownDestinationUrl(link.text)}`));

/** The cases of the fifth round's review, and more of every kind the two parsers could read apart. */
const CORPUS = [
  "<code>[[Pricing 2026]]</code>",
  "<pre>[[Pricing 2026]]</pre>",
  "<kbd>[[Pricing 2026]]</kbd>",
  '<a href="Pricing%202026.md">p</a>',
  "See [P][ref].\n\n[ref]: Pricing%202026.md",
  "Intro:\n\n    [[Pricing 2026]]",
  "``[[Pricing 2026]]``",
  "[[Pricing 2026|Preise]]",
  "> [[Pricing 2026]]",
  "| a |\n|---|\n| [[Pricing 2026]] |",
  "~~~\n[[Pricing 2026]]\n~~~",
  "[p](<Pricing 2026.md>)",
  '[p](Pricing%202026.md "t")',
  "## Sources [[Roadmap]]\n\n1. **[[Plan]]** and *[p](Plan.md)*\n2. ~~[[Old]]~~ ==[[Marked]]==",
  "- [ ] [[Task note]]\n  - [x] nested [q](Areas/Q.md)",
  "```\n[[Fenced]]\n```\nAfter [[Fence end]]",
  "[site](https://example.com) and https://example.com/Plan.md and <https://x.y>",
  "![[diagram.png]] ![a](missing.png) [[#Heading]] [[Plan#Goals]]",
  "Das kostet $20, siehe [[Pricing 2026]]. Formula $[[a]]$.",
  "Write \\[\\[Escaped\\]\\] and `[[code]]`.",
];

/** Answers drawn at random from the pieces the parsers treat differently. */
function randomAnswers(count: number): string[] {
  let seed = 5051;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const links = ["[[Pricing 2026]]", "[[A|b]]", "[p](Plan.md)", "[p](<Two words.md>)", "[s](https://x.y)", "![[pic.png]]", "[[#H]]", "[r][ref]"];
  const wraps = [(s: string) => s, (s: string) => `**${s}**`, (s: string) => `\`${s}\``, (s: string) => `<code>${s}</code>`, (s: string) => `<kbd>${s}</kbd>`, (s: string) => `~~${s}~~`];
  const blocks = [(s: string) => s, (s: string) => `- ${s}`, (s: string) => `> ${s}`, (s: string) => `    ${s}`, (s: string) => `## ${s}`, (s: string) => `| ${s} |\n|---|\n| ${s} |`, (s: string) => `\`\`\`\n${s}\n\`\`\``];
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(blocks)(`Text ${pick(wraps)(pick(links))} more $5 ${pick(links)}`)).join("\n\n") + "\n\n[ref]: Pricing%202026.md",
  );
}

describe("the links an answer's check reads", () => {
  it("are the links its view shows, in every case of the review and in answers drawn at random", () => {
    for (const answer of [...CORPUS, ...randomAnswers(150)]) {
      expect(linksRead(answer), JSON.stringify(answer)).toEqual(linksDrawn(answer));
      // The one look before the reading never keeps an answer from it that shows a link.
      if (linksRead(answer).length) expect(answerMayLink(answer), JSON.stringify(answer)).toBe(true);
    }
  });

  it("an answer whose view shows no link is not read", () => {
    expect(answerMayLink("Three feature pages instead of six (see the [draft] plan), and https://example.com.")).toBe(false);
    expect(answerMayLink('See <a href="Pricing%202026.md">p</a> and [P][ref].\n\n[ref]: Pricing%202026.md')).toBe(false);
  });
});

/** Plan Oberfläche O7, E2: a warning only where the answer links a note that the run never had. */
describe("unfounded note citations", () => {
  const cite = (answer: string, grounding: AnswerGrounding) => unfoundedAmongShown(answerLinksShown(answer), grounding);
  const grounding = { sent: ["Projects/Website relaunch.md"], read: ["Areas/Roadmap.md"] };
  const vault = [
    { path: "Projects/Website relaunch.md", title: "Website relaunch" },
    { path: "Areas/Roadmap.md", title: "Roadmap" },
    { path: "Pricing 2026.md", title: "Pricing 2026" },
    { path: "Node.js.md", title: "Node.js" },
    { path: "Vue.config.md", title: "Vue.config" },
    { path: "Q4: Plan.md", title: "Q4: Plan" },
    { path: "Daten.json.md", title: "Daten.json" },
    { path: "www.example.md", title: "www.example" },
    { path: "Areas/Alpha.md", title: "Projekt:Alpha" },
    { path: "Sitzung.mp4.md", title: "Sitzung.mp4" },
    { path: "Logs.txt.md", title: "Logs.txt" },
    { path: "Tipps:Tricks.md", title: "Tipps:Tricks" },
    { path: "diagram.png", mode: "attachment" },
    { path: "assets/chart.png", mode: "attachment" },
    { path: "assets/report.pdf", mode: "attachment" },
    { path: "Board.canvas", mode: "attachment" },
  ];

  it("finds nothing when every cited note went along or was read", async () => {
    const answer = "The site gets three pages [[Website relaunch]].\n\n- Launch is in May [[Areas/Roadmap|the roadmap]].\n- Hero first [[Website relaunch#Goals]].";
    expect(await cite(answer, grounding)).toEqual([]);
  });

  it("names a cited note the run neither sent nor read, once, as the click asked for it", async () => {
    expect(await cite("Pricing is settled [[Pricing 2026]].\n\nSee also [[pricing 2026|prices]] and [[Website relaunch]].", grounding)).toEqual(["Pricing 2026"]);
  });

  it("matches by path, file name, `.md`, case and the title a note goes by", async () => {
    const answer = "[[projects/website relaunch.md]] [[ROADMAP]] [[Relaunch plan]]";
    expect(await cite(answer, { ...grounding, titled: [{ path: "Projects/Website relaunch.md", title: "Relaunch plan" }] })).toEqual([]);
  });

  it("says nothing when the tools read more than the run listed: an unknown is no finding", async () => {
    expect(await cite("Pricing is settled [[Pricing 2026]].", { ...grounding, readMore: true })).toEqual([]);
  });

  it("a run that had no notes and cites one is warned about it", async () => {
    expect(await cite("Your plan says so [[Plan]].", { sent: [] })).toEqual(["Plan"]);
  });

  it("reads a wiki link with an escaped bar in a table cell as the note it names", async () => {
    expect(await cite("| Topic | Source |\n|---|---|\n| Launch 12 May | [[Website relaunch\\|WR]] |", grounding)).toEqual([]);
  });

  it("checks Markdown links as a click opens them, and leaves addresses and other files alone", async () => {
    const answer = "See [Pricing](Pricing%202026.md), [the plan](<Projects/Website relaunch.md>), [site](https://example.com), [pdf](plan.pdf).";
    expect(await cite(answer, grounding)).toEqual(["Pricing 2026.md"]);
    expect(await cite(answer, { ...grounding, vault })).toEqual(["Pricing 2026.md"]);
    // The destination as the view shows it: in angle brackets, or with a title behind it.
    expect(await cite('x [p](<Pricing 2026.md>) and [q](Pricing%202026.md "t").', { ...grounding, vault })).toEqual(["Pricing 2026.md"]);
  });

  it("a link with a folder leads where the click leads: a same-named note elsewhere is not the sent one", async () => {
    expect(await cite("The old plan said 2025 [[Archive/Website relaunch]].", grounding)).toEqual(["Archive/Website relaunch"]);
    expect(await cite("Three pages [[Projects/Website relaunch]].", grounding)).toEqual([]);
  });

  it("a bare link leads where a click in the answer leads: to the note the vault answers with", async () => {
    const files = [{ path: "Plan.md" }, { path: "Projects/Plan.md" }];
    expect(await cite("x [[Plan]].", { sent: ["Projects/Plan.md"], vault: files })).toEqual(["Plan"]);
    expect(await cite("x [[Plan]].", { sent: ["Plan.md"], vault: files })).toEqual([]);
  });

  it("a link to a file that is no note names no source; a note that is not there is named", async () => {
    const g = { ...grounding, vault };
    expect(await cite("The picture [[diagram.png]] and [the plan](diagram.png).", g)).toEqual([]);
    expect(await cite("A note to come [[Ideas for 2027]].", g)).toEqual(["Ideas for 2027"]);
  });

  it("a note reached by a dotted or a colon name, by `www.` or by its title is that note (review O7, fourth round)", async () => {
    const g = { ...grounding, vault };
    for (const [link, name] of [
      ["[[Daten.json]]", "Daten.json"],
      ["[[www.example]]", "www.example"],
      ["[[Projekt:Alpha]]", "Projekt:Alpha"],
      ["[[Sitzung.mp4]]", "Sitzung.mp4"],
      ["[[Logs.txt]]", "Logs.txt"],
      ["[[Tipps:Tricks]]", "Tipps:Tricks"],
      ["[w](www.example.md)", "www.example.md"],
      ["[[Node.js]]", "Node.js"],
      ["[[Q4: Plan]]", "Q4: Plan"],
    ] as const) {
      expect(await cite(`See ${link}.`, g), link).toEqual([name]);
    }
  });

  // What the view shows as a link is checked; what it shows as text is not (review O7, fifth round).
  const silent: [string, string][] = [
    ["a web address as a wiki link", "See [[https://example.com]]."],
    ["a mail address as a wiki link", "Write [[mailto:a@b.c]]."],
    ["a drive path", "Under [[C:\\Pfad\\x]]."],
    ["an app address as a wiki link", "Open [[plainva://open?path=a]]."],
    ["a web address", "[site](https://example.com/a.md)"],
    ["an address in a Markdown link, even where a note ends so", "[site](https://example.com/Pricing%202026)"],
    ["www. without a scheme", "[site](www.example.com)"],
    ["an app address", "[open](plainva://open?path=Pricing%202026.md)"],
    ["a heading of this note", "[below](#abschnitt)"],
    ["an attachment that is there", "[r](assets/report.pdf)"],
    ["a picture that is there", "See [[chart.png]]."],
    ["a canvas that is there", "See [[Board.canvas]]."],
    ["a PDF that is not there", "[r](budget.pdf)"],
    ["a PDF that is not there, as a wiki link", "See [[budget.pdf]]."],
    ["a picture that is not there", "See [[photo.png]]."],
    ["a picture behind a plain link", "[pic](img/photo.jpg)"],
    ["a picture shown", "![a](missing.png)"],
    ["a reference link, which the view shows as text", "See [site][s].\n\n[s]: Pricing%202026.md"],
    ["an <a href>, which the view shows as text", 'See <a href="Pricing%202026.md">x</a>.'],
    ["a bare address", "See https://example.com/Pricing.md now."],
    ["a folder that is there", "[p](Projects/)"],
    ["a folder that is not there", "[p](Nowhere/)"],
    ["a heading of this note, as a wiki link", "See [[#Budget]]."],
    ["a wiki link in a code span", "Write `[[Pricing 2026]]`."],
    ["a wiki link in a code span of two backticks", "Write ``[[Pricing 2026]]``."],
    ["a wiki link in a fence", "```\n[[Pricing 2026]]\n```"],
    ["escaped brackets", "Write \\[\\[Pricing 2026\\]\\]."],
  ];
  const warned: [string, string, string[]][] = [
    ["a note not sent", "x [[Pricing 2026]].", ["Pricing 2026"]],
    ["a note not sent, as a Markdown link", "x [p](Pricing%202026.md).", ["Pricing 2026.md"]],
    ["a note that is not there", "x [[Ideas 2027]].", ["Ideas 2027"]],
    ["in <code>, which the view shows as a link", "<code>[[Pricing 2026]]</code>", ["Pricing 2026"]],
    ["in <pre>, which the view shows as a link", "<pre>[[Pricing 2026]]</pre>", ["Pricing 2026"]],
    ["in <kbd>, which the view shows as a link", "<kbd>[[Pricing 2026]]</kbd>", ["Pricing 2026"]],
    ["in an indented block, which the view shows as a link", "Intro:\n\n    [[Pricing 2026]]", ["Pricing 2026"]],
    ["after a price", "Das kostet $20, siehe [[Pricing 2026]].", ["Pricing 2026"]],
    ["after an escaped dollar", "US\\$ 5 laut [[Pricing 2026]].", ["Pricing 2026"]],
    ["in a list item after a price", "- $5 pro Monat: [[Pricing 2026]]", ["Pricing 2026"]],
    ["as a Markdown link after a price", "Preis 20 $ – mehr in [p](Pricing%202026.md).", ["Pricing 2026.md"]],
    ["between two dollars, which the view shows as text", "Formula $[[Pricing 2026]]$ ok.", ["Pricing 2026"]],
  ];
  for (const [name, answer] of silent) {
    it(`says nothing of ${name}`, async () => {
      expect(await cite(answer, { sent: ["Projects/Website relaunch.md"], vault })).toEqual([]);
      expect(await cite(answer, { sent: ["Projects/Website relaunch.md"] })).toEqual([]);
    });
  }
  for (const [name, answer, names] of warned) {
    it(`names ${name}`, async () => {
      expect(await cite(answer, { sent: ["Projects/Website relaunch.md"], vault })).toEqual(names);
      expect(await cite(answer, { sent: ["Projects/Website relaunch.md"] })).toEqual(names);
    });
  }
});
