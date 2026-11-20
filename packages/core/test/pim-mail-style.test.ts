import { describe, it, expect } from "vitest";
import { htmlToVisibleText, JUDGED_BY_THE_WALK } from "../src/pim/htmlVisibleText.js";
import { keptMailStyle, MAIL_STYLE, tinyLineHeight } from "../src/pim/mailStyle.js";

/**
 * The inline styles a mail keeps and the walk that reads what the reader shows
 * are ONE list (review of 2026-11-16). This file holds them together: a
 * property the sanitizer lets through is either judged by the walk or listed
 * here, with the reason it cannot take words off the screen. A property added
 * to `MAIL_STYLE` without either turns this red.
 */

/** Properties that cannot hide words with the values `MAIL_STYLE` accepts, and why. */
const CANNOT_HIDE: Record<string, string> = {
  "font-family": "a typeface changes letters, not whether they are drawn",
  "font-weight": "keywords and weights only",
  "font-style": "keywords only",
  "line-height": "lines laid on top of each other are taken where a word takes its line from them (the shaper, `tinyLineHeight`); a wrapper of pictures keeps line-height:0 as at main",
  "text-align": "keywords only, the text stays in its box",
  "vertical-align": "keywords only, no length that moves a line off the page",
  "text-decoration": "lines drawn with the text",
  "text-decoration-line": "lines drawn with the text",
  "text-transform": "letter case only",
  "letter-spacing": "never tighter than a tenth of a letter (2 px), never wider than 20 px: letters never lie on each other",
  "word-spacing": "never negative, at most 40 px: words only move apart",
  "text-indent": "never negative, and never past the frame (mailShape): a line only moves in",
  "word-break": "where lines break",
  "overflow-wrap": "where lines break",
  "word-wrap": "where lines break",
  direction: "the direction of a line, not whether it shows",
  width: "clips only with overflow, which the walk judges; no box reaches past the frame (mailShape)",
  "min-width": "as width",
  "max-width": "as width",
  height: "clips only with overflow, which the walk judges; what does not fit stands below the box",
  "min-height": "as height",
  "max-height": "as height",
  margin: "never negative, and never past the frame (mailShape): a box only moves away from its neighbours",
  "margin-top": "as margin",
  "margin-right": "as margin",
  "margin-bottom": "as margin",
  "margin-left": "as margin",
  padding: "never negative",
  "padding-top": "never negative",
  "padding-right": "never negative",
  "padding-bottom": "never negative",
  "padding-left": "never negative",
  border: "a frame around a box, at most 20 px wide",
  "border-top": "a frame around a box",
  "border-right": "a frame around a box",
  "border-bottom": "a frame around a box",
  "border-left": "a frame around a box",
  "border-width": "a frame around a box",
  "border-style": "a frame around a box",
  "border-color": "a frame around a box",
  "border-radius": "rounded corners; nothing clips",
  "border-collapse": "how table frames meet",
  "border-spacing": "never negative",
  "table-layout": "how a table works out its columns",
  "box-sizing": "how a size is measured",
  float: "a box beside the text, still on the page",
  clear: "a box below a float",
  "list-style-type": "the marker of a list item",
  "list-style": "the marker of a list item; url() never reaches here",
};

describe("the inline styles a mail keeps", () => {
  it("are each judged by the walk or listed as unable to hide words", () => {
    const judged = new Set<string>(JUDGED_BY_THE_WALK);
    for (const [name, rule] of Object.entries(MAIL_STYLE)) {
      if (rule.kind === "judged") expect(judged.has(name), `${name} is judged, the walk must read it`).toBe(true);
      else expect(CANNOT_HIDE[name], `${name} is kept: judge it in the walk or say here why it cannot hide words`).toBeTypeOf("string");
    }
    for (const name of JUDGED_BY_THE_WALK) expect(MAIL_STYLE[name]?.kind, `${name} is read by the walk`).toBe("judged");
    for (const name of Object.keys(CANNOT_HIDE)) expect(MAIL_STYLE[name], `${name} is listed here but not kept`).toBeDefined();
  });

  it("keep no form the walk does not read", () => {
    const dropped = [
      "display:n\\one", "display:\\6e one", "opacity:-1", "opacity:calc(0)", "opacity:2", "overflow:scroll", "overflow:hidden hidden",
      "overflow-y:auto", "text-overflow:clip", "position:absolute", "left:-9999px", "top:-100px", "z-index:-1", "transform:scale(0)",
      "clip:rect(0 0 0 0)", "clip-path:inset(50%)", "mask:none", "filter:opacity(0)", "content-visibility:hidden", "color:canvas",
      "color:rgb(1,2)", "background:url(x) #fff left/cover magic", "text-indent:-9999px", "margin:-1px", "margin-left:-5000px", "letter-spacing:-1em",
      "vertical-align:-9999px", "width:99999px", "font-size:-12px", "font-size:12furlongs", "font-size:var(--x)", "font-size:constructor", "font-size:__proto__",
      "display:table-column", "font-size:calc(1px * 1px)", "font-size:calc(10)", "font-size:min(10px)x", "mso-hide:all", "background:url(x)", "display:none !importan",
      "font:16px", "font:caption", "border:2000px solid red", "letter-spacing:1000px", "word-spacing:2000px",
    ];
    for (const style of dropped) expect(keptMailStyle(style), style).toBe("");
    // A line height on top of the lines is kept by the list; the shaper decides on it (`tinyLineHeight`).
    expect(keptMailStyle("line-height:0")).toBe("line-height:0");
    expect(tinyLineHeight("0")).toBe(true);
    expect(tinyLineHeight("0.5ex")).toBe(true);
    expect(tinyLineHeight("3px")).toBe(true);
    expect(tinyLineHeight("4px")).toBe(false);
    expect(tinyLineHeight("0.5")).toBe(false);
    expect(tinyLineHeight("normal")).toBe(false);
    // An open quote cannot carry the next declaration away: the reader is given
    // only what is written out here, and that is what the walk reads.
    expect(keptMailStyle('font-family:"a;display:none')).toBe("display:none");
  });

  it("write the shorthands out as the longhands they set (review of 2026-11-17)", () => {
    expect(keptMailStyle("font:bold 16px/22px Arial, sans-serif")).toBe("font-style:normal;font-weight:bold;font-size:16px;line-height:22px;font-family:Arial, sans-serif");
    expect(keptMailStyle("font: italic 12px Georgia")).toBe("font-style:italic;font-weight:normal;font-size:12px;line-height:normal;font-family:Georgia");
    // A line height of nothing and the size of nothing are kept: the walk reads the size, and the shaper takes the line height where a word takes its line from it.
    expect(keptMailStyle("font:0/0 a")).toBe("font-style:normal;font-weight:normal;font-size:0;line-height:0;font-family:a");
    expect(keptMailStyle("background:#000 url(https://x.example/a.png) no-repeat center / cover")).toBe("background-color:#000");
    expect(keptMailStyle("background:linear-gradient(to right, #000 0%, rgba(0,0,0,.5) 100%), #111")).toBe(
      "background-color:#111;background-image:linear-gradient(to right, #000 0%, rgba(0,0,0,.5) 100%)"
    );
    expect(keptMailStyle("background-image:url(x)")).toBe("");
  });

  it("keep colours with alpha, inherited colours, variables with a fallback, sizes worked out and lines as the mail sets them", () => {
    for (const style of ["color:rgba(255,255,255,0.85)", "color:rgb(255 255 255 / 90%)", "color:#ffffffe6", "color:hsl(210 50% 40% / .5)", "color:transparent", "font-size:calc(14px + 0.2vw)", "font-size:clamp(14px,2vw,18px)", "font-size:max(1em, 12px)", "font-size:2ex"]) {
      expect(keptMailStyle(style), style).toBe(style.replace(/:\s*/, ":"));
    }
    // A line that runs past the frame stays as set: the frame scrolls to it (review of 2026-11-17, rule 1).
    for (const style of ["white-space:pre", "white-space:nowrap", "word-break:keep-all", "word-break:normal"]) expect(keptMailStyle(style), style).toBe(style);
    // The colour around it is a colour understood (rule 2): `currentColor` and `unset` are `inherit`.
    for (const style of ["color:inherit", "color:currentColor", "color:unset", "color:var(--x)"]) expect(keptMailStyle(style), style).toBe("color:inherit");
    // No custom property is ever given: a variable is its fallback.
    expect(keptMailStyle("color:var(--c, #333)")).toBe("color:#333");
    expect(keptMailStyle("background-color:var(--a, var(--b, #000))")).toBe("background-color:#000");
    expect(keptMailStyle("background-color:var(--b)")).toBe("");
    // A size from a bare variable stays unread: the reader gives its own where that leaves none.
    expect(keptMailStyle("font-size:var(--x)")).toBe("");
  });

  it("keep what a newsletter lays out with, written anew", () => {
    expect(keptMailStyle("font-family: Arial, 'Helvetica Neue', sans-serif; FONT-SIZE:14PX; color:#333333; line-height:1.5")).toBe(
      "font-family:Arial, 'Helvetica Neue', sans-serif;font-size:14px;color:#333333;line-height:1.5"
    );
    expect(keptMailStyle("padding:10px 20px;margin:0 auto;max-width:600px;border:1px solid #dddddd;border-radius:4px")).toBe(
      "padding:10px 20px;margin:0 auto;max-width:600px;border:1px solid #dddddd;border-radius:4px"
    );
    expect(keptMailStyle("display:none !important;background-color:rgb(255, 255, 255)")).toBe("display:none !important;background-color:rgb(255, 255, 255)");
    expect(keptMailStyle("display:/* a comment */none")).toBe("display:none");
    // Gmail's quote (measured 2026-11-16): its indent is set in ex.
    expect(keptMailStyle("margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex")).toBe(
      "margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"
    );
  });

  it("judge sizes and opacity the way they reach the screen", () => {
    expect(htmlToVisibleText('<div style="font-size:0">a<span style="font-size:13px">b</span></div>')).toBe("b");
    expect(htmlToVisibleText('<div style="font-size:2px">a<span style="font-size:400%">b</span></div>')).toBe("b");
    expect(htmlToVisibleText('<span style="font-size:3px">a</span><span style="font-size:4px">b</span>')).toBe("b");
    expect(htmlToVisibleText('<div style="opacity:0.5"><span style="opacity:0.1">a</span><span style="opacity:0.4">b</span></div>')).toBe("b");
    // A form the reader is not given hides nothing.
    expect(htmlToVisibleText('<div style="position:absolute;left:-9999px">a</div><div style="height:0;overflow:scroll">b</div>')).toBe("a\nb");
    // A size worked out at its least: a viewport unit can be small.
    expect(htmlToVisibleText('<div style="font-size:0"><span style="font-size:calc(1px + 0.5vw)">a</span><span style="font-size:clamp(12px, 1vw, 20px)">b</span></div>')).toBe("b");
    // Sizes a browser's own sheet gives.
    expect(htmlToVisibleText(`${"<small>".repeat(8)}a${"</small>".repeat(8)}${"<small>".repeat(6)}b${"</small>".repeat(6)}`)).toBe("b");
    // A share of a size named by a word is never drawn below 6 px; a size in pixels is drawn as written.
    expect(htmlToVisibleText('<font size="1"><span style="font-size:3px">a</span><span style="font-size:35%">b</span></font>')).toBe("b");
    expect(htmlToVisibleText('<span style="font-size:x-small"><span style="font-size:1%">a</span></span><span style="font-size:10px"><span style="font-size:35%">b</span></span>')).toBe("a");
  });

  it("judge a box that clips itself to nothing, and no other", () => {
    expect(htmlToVisibleText('<div style="max-height:0;overflow:hidden">a</div><div style="max-height:0;padding:4px 0;overflow:hidden">b</div>')).toBe("b");
    expect(htmlToVisibleText('<span style="max-height:0;overflow:hidden">c</span><div style="width:0;overflow:hidden">d</div><div style="height:0;min-height:20px;overflow:hidden">e</div>')).toBe("c\ne");
  });
});
