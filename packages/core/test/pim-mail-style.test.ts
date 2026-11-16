import { describe, it, expect } from "vitest";
import { htmlToVisibleText, JUDGED_BY_THE_WALK } from "../src/pim/htmlVisibleText.js";
import { keptMailStyle, MAIL_STYLE } from "../src/pim/mailStyle.js";

/**
 * The inline styles a mail keeps and the walk that reads what the reader shows
 * are ONE list (review of 2026-11-16). This file holds them together: a
 * property the sanitizer lets through is either judged by the walk or listed
 * here, with the reason it cannot take words off the screen. A property added
 * to `MAIL_STYLE` without either turns this red.
 */

/** Properties that cannot hide words with the values `MAIL_STYLE` accepts, and why. */
const CANNOT_HIDE: Record<string, string> = {
  color: "a colour: text against its background is the named limit; transparent is not kept",
  "background-color": "a colour: the named limit",
  background: "a single colour only: the named limit",
  "font-family": "a typeface changes letters, not whether they are drawn",
  "font-weight": "keywords and weights only",
  "font-style": "keywords only",
  "line-height": "kept from half a line up: lines never lie on top of each other",
  "text-align": "keywords only, the text stays in its box",
  "vertical-align": "keywords only, no length that moves a line off the page",
  "text-decoration": "lines drawn with the text",
  "text-decoration-line": "lines drawn with the text",
  "text-transform": "letter case only",
  "letter-spacing": "never tighter than a tenth of a letter (2 px): letters never lie on each other",
  "word-spacing": "never negative: words only move apart",
  "text-indent": "never negative: a line only moves in",
  "word-break": "where lines break",
  "overflow-wrap": "where lines break",
  "word-wrap": "where lines break",
  direction: "the direction of a line, not whether it shows",
  width: "nothing clips (overflow is not kept): what does not fit stands beside the box",
  "min-width": "as width",
  "max-width": "as width",
  height: "nothing clips: what does not fit stands below the box",
  "min-height": "as height",
  "max-height": "as height",
  margin: "never negative: a box only moves away from its neighbours",
  "margin-top": "as margin",
  "margin-right": "as margin",
  "margin-bottom": "as margin",
  "margin-left": "as margin",
  padding: "never negative",
  "padding-top": "never negative",
  "padding-right": "never negative",
  "padding-bottom": "never negative",
  "padding-left": "never negative",
  border: "a frame around a box",
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
      "font:0/0 a", "display:n\\one", "display:\\6e one", "opacity:-1", "opacity:calc(0)", "opacity:2", "overflow:hidden", "overflow:scroll",
      "overflow-y:auto", "text-overflow:clip", "position:absolute", "left:-9999px", "top:-100px", "z-index:-1", "transform:scale(0)",
      "clip:rect(0 0 0 0)", "clip-path:inset(50%)", "mask:none", "filter:opacity(0)", "content-visibility:hidden", "color:transparent",
      "color:rgba(0,0,0,0)", "color:#0000", "text-indent:-9999px", "margin:-1px", "margin-left:-5000px", "letter-spacing:-1em",
      "line-height:0", "vertical-align:-9999px", "width:99999px", "font-size:-12px", "font-size:12furlongs", "font-size:var(--x)", "font-size:constructor", "font-size:__proto__",
      "display:table-column", "font-size:0.5ex", "font-size:1ch", "line-height:0.5ex", "mso-hide:all", "background:url(x)", "display:none !importan",
    ];
    for (const style of dropped) expect(keptMailStyle(style), style).toBe("");
    // An open quote cannot carry the next declaration away: the reader is given
    // only what is written out here, and that is what the walk reads.
    expect(keptMailStyle('font-family:"a;display:none')).toBe("display:none");
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
    expect(htmlToVisibleText('<div style="position:absolute;left:-9999px">a</div><div style="max-height:0;overflow:hidden">b</div>')).toBe("a\nb");
  });
});
