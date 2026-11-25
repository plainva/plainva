// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blanked, elementPath, engineHiddenWords, mailHtmlView } from "@plainva/ui/mail";

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
