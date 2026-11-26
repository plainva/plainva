// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blanked, elementPath, engineHiddenWords, hasLayoutEngine, mailHtmlView } from "@plainva/ui/mail";
import { readableBodyInEngine, UNREADABLE_BODY } from "@plainva/ui/ai";

/**
 * The parts of the engine's judgement of a mail (plan Umsetzung 0.9.x, B7; F23) that need no engine. Whether a word is
 * covered is the engine's to say and is measured in Chromium and WebKit (`mailFrameEquality.spec.ts`); here: where a
 * text is found again, how a hidden word is taken out, and that a DOM without layout is no engine.
 */
describe("the engine's judgement of a mail, without an engine", () => {
  it("blanks a hidden word where it stands, and nothing else", () => {
    // The parent's own text "Hello SECRET world" is two texts here: "Hello " and "SECRET world".
    expect(blanked("SECRET world", [[6, 12]], 6)).toBe("      " + " world");
    expect(blanked("Hello ", [[6, 12]], 0)).toBe("Hello ");
    expect(blanked("a b c", [[0, 1], [4, 5]], 0)).toBe("  b  ");
    expect(blanked("a b c", [], 0)).toBe("a b c");
  });

  it("finds an element by its place among element children, whatever texts stand between them", () => {
    const body = document.createElement("body");
    body.innerHTML = "x<p>a</p> <div><span>b</span><b>c</b></div>";
    expect(elementPath(body.querySelector("b")!, body)).toBe("1/1");
    expect(elementPath(body.querySelector("p")!, body)).toBe("0");
    expect(elementPath(body, body)).toBe("");
  });

  it("asks no engine where the DOM lays nothing out, and the walk's reading stands", async () => {
    expect(await engineHiddenWords("<!doctype html><html><head></head><body><p>a</p></body></html>")).toBeNull();
    const view = mailHtmlView(`<p>VISIBLE words</p><div style="height:0">SECRET</div>`);
    expect((await view.engineDocument()).text).toBe(view.document().text);
  });
});

/**
 * It fails closed (B7, review): where an engine is there but cannot say what the reader shows, the assistant reads
 * nothing of the message — never the walk's reading in its stead. Only a runtime without any layout engine (this test
 * runner's DOM) keeps the walk's reading.
 */
describe("when the engine cannot finish", () => {
  const html = `<p>VISIBLE words</p><div style="height:0">SECRET</div>`;

  it("reads the walk's text where there is no layout engine at all", async () => {
    expect(hasLayoutEngine()).toBe(false);
    const read = await readableBodyInEngine({ html }, 10_000);
    expect(read.text).toContain("VISIBLE words");
  });

  it("reads nothing where an engine is there but its frame lays nothing out", async () => {
    // An engine that answers the hit test, in a DOM that lays nothing out: the pass cannot finish.
    const doc = document as Document & { elementsFromPoint?: unknown };
    const before = doc.elementsFromPoint;
    doc.elementsFromPoint = () => [];
    try {
      expect(hasLayoutEngine()).toBe(true);
      await expect(engineHiddenWords("<!doctype html><html><head></head><body><p>a</p></body></html>", [343])).rejects.toThrow();
      const read = await readableBodyInEngine({ html: `${html}<p>another mail</p>` }, 10_000);
      expect(read).toEqual({ text: UNREADABLE_BODY, links: [], truncated: false });
    } finally {
      doc.elementsFromPoint = before;
    }
  }, 20_000);
});

describe("the reader's rules for pictures, from one source (review B7-2, S3)", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../../../..", path), "utf8");

  it("the reader's frame and the frame the engine measures in both take them from MAIL_IMAGE_RULES", () => {
    const sanitize = read("packages/ui/src/mail/mailSanitize.ts");
    expect(sanitize).toMatch(/export const MAIL_IMAGE_RULES = "img\{[^"]+\}";/);
    // The one builder writes them; no second rule for pictures is written into a frame anywhere.
    expect(sanitize.match(/\$\{MAIL_IMAGE_RULES\}/g)).toHaveLength(1);
    expect(sanitize.replace(/export const MAIL_IMAGE_RULES = "[^"]+";/, "")).not.toMatch(/img\{/);
    // Both shells' readers and the engine's frame are made by that builder.
    for (const file of ["apps/desktop/src/components/mail/MailView.tsx", "apps/mobile/src/screens/MailMessageScreen.tsx"]) expect(read(file), file).toMatch(/buildMailFrameDoc\(/);
    expect(sanitize).toMatch(/engineHiddenWords\(buildMailFrameDoc\(/);
    // The engine adds no rule of its own for pictures: what the reader leaves to a picture is asked of the layout.
    const engine = read("packages/ui/src/mail/engineVisibility.ts");
    expect(engine).not.toMatch(/img\{|img:not\(\[src\]\):not/);
    expect(engine).toMatch(/remotePictureFreedom\(doc\)/);
  });
});
