import { describe, expect, it } from "vitest";
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import { contrast, MIN_CONTRAST, readAttributeColour, readColour } from "../src/pim/mailColour.js";
import { LEFT_MAX, MailShaper, REACH_MAX, type ShapeState } from "../src/pim/mailShape.js";
import { fontSizePx, keptMailStyle } from "../src/pim/mailStyle.js";
import { htmlToVisibleDocument, WHITE_SHEET } from "../src/pim/htmlVisibleText.js";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/** The attributes the sanitizer hands the shaper (`SHAPED_ATTRS` in `mailSanitize.ts`). */
const SHAPED = new Set(["style", "hidden", "nowrap", "bgcolor", "background", "width", "height", "cellpadding", "cellspacing", "hspace", "vspace", "border"]);

/** Whether words stand anywhere inside (`holdsText` in `mailSanitize.ts`): blanks and no-break spaces are none. */
function holdsText(node: ParentNode): boolean {
  return node.childNodes.some((child) => ("value" in child && child.nodeName === "#text" ? /[^\s\u200b-\u200d\u2060\u00ad]/.test(child.value) : "childNodes" in child && holdsText(child)));
}

/**
 * The shaper run the way the sanitizer runs it, over parse5's tree: each
 * element in document order, the attributes it reads taken off and handed to
 * it, the style left as the list keeps it until the shaper gives another.
 */
function shape(html: string): string {
  const root = parseFragment(html);
  const written = new Map<Element, Map<string, string>>();
  const shaper = new MailShaper<Element>({
    written: (node) => written.get(node),
    give: (node, name, value) => {
      node.attrs = node.attrs.filter((attr) => attr.name !== name);
      if (value !== null) node.attrs.push({ name, value });
    },
    holdsText: (node) => holdsText(node),
  });
  const visit = (parent: ParentNode, state: ShapeState) => {
    for (const child of parent.childNodes) {
      if (!("tagName" in child)) continue;
      const attrs = new Map<string, string>();
      for (const attr of child.attrs) if (SHAPED.has(attr.name) || (attr.name === "color" && child.tagName === "font")) attrs.set(attr.name, attr.value);
      if (attrs.size > 0) written.set(child, attrs);
      child.attrs = child.attrs.filter((attr) => !attrs.has(attr.name));
      // The reader has the style as the list keeps it until the shaper gives another.
      const style = attrs.get("style");
      const kept = style === undefined ? "" : keptMailStyle(style);
      if (kept) child.attrs.push({ name: "style", value: kept });
      visit(child, shaper.element(child, child.tagName, state));
    }
  };
  visit(root, shaper.root());
  return serialize(root);
}

describe("the mail shaper (review of 2026-11-17)", () => {
  it("lays no box past the frame: margins and widths that add up lose their horizontal lengths", () => {
    expect(shape('<div style="margin-left:300px"><div style="margin-left:300px;margin-top:4px"><p style="margin-left:300px">x</p></div></div>')).toBe(
      '<div style="margin-left:300px"><div style="margin-top:4px"><p>x</p></div></div>'
    );
    expect(shape('<div style="padding:10px 2000px">x</div>')).toBe('<div style="padding-top:10px;padding-bottom:10px">x</div>');
    // The frame holds a table to its width (`table{max-width:100%}`): its width stays, as at main.
    expect(shape('<table width="3000"><tbody><tr><td>x</td></tr></tbody></table>')).toBe('<table width="3000"><tbody><tr><td>x</td></tr></tbody></table>');
    // A list nested too deep loses the indent a browser gives it.
    const deep = `${"<ul>".repeat(16)}<li>x</li>${"</ul>".repeat(16)}`;
    expect(shape(deep)).toContain('<ul style="padding-left:0 !important;padding-right:0 !important">');
    expect(LEFT_MAX).toBeLessThan(REACH_MAX);
  });

  it("keeps the widths of a row's cells: the frame holds the table to its width", () => {
    const row = '<table><tbody><tr><td width="300">a</td><td width="300">b</td><td style="width:300px">c</td></tr></tbody></table>';
    expect(shape(row)).toBe('<table><tbody><tr><td width="300">a</td><td width="300">b</td><td style="width:300px">c</td></tr></tbody></table>');
    // Two columns of a 600 px newsletter stay as they are.
    const two = '<table width="600"><tbody><tr><td width="300" style="padding:0 20px">a</td><td width="300">b</td></tr></tbody></table>';
    expect(shape(two)).toBe('<table width="600"><tbody><tr><td style="padding:0 20px" width="300">a</td><td width="300">b</td></tr></tbody></table>');
  });

  it("gives one pair of colours, never half of one (review of 2026-11-17)", () => {
    // A picture that is not shown: its box takes the reader's pair, and the colours set on it go.
    const PAIR = "color:#222222 !important;background-color:#ffffff !important";
    expect(shape('<div style="background:url(x)"><p style="color:#fff;margin:0">a</p><font color="white">b</font></div>')).toBe(
      `<div style="${PAIR}"><p style="margin:0">a</p><font>b</font></div>`
    );
    // A colour set for the picture on its own box takes that box to the reader's pair.
    expect(shape('<div style="background:url(x);color:#fff">a</div>')).toBe(`<div style="${PAIR}">a</div>`);
    // A colour set above a ground the reader shows stands on that ground; the colours set against the picture go (review 4, p18).
    expect(shape('<div style="color:#fff;background-color:#000"><div style="background-image:url(x)"><p style="color:#333">a</p></div></div>')).toBe('<div style="color:#fff;background-color:#000"><div><p>a</p></div></div>');
    // `none` is no background lost: the colour stays on what lies behind.
    expect(shape('<td style="background:none;color:#fff">a</td>')).toBe('<td style="color:#fff">a</td>');
    expect(shape('<td style="background-image:none;color:#fff">a</td>')).toBe('<td style="color:#fff">a</td>');
    // A colour the reader is not given, beside a background it is: both become the reader's.
    expect(shape('<div style="background-color:#000;color:oklch(1 0 0)">a</div>')).toBe(`<div style="${PAIR}">a</div>`);
    expect(shape('<div style="background-color:#000;color:#000;-webkit-text-fill-color:#fff">a</div>')).toBe(`<div style="${PAIR}">a</div>`);
    expect(shape('<span style="color:initial">a</span>')).toBe(`<span style="${PAIR}">a</span>`);
    // A background the reader is not given, under a colour set above it.
    expect(shape('<div style="color:#fff"><div style="background-color:hwb(0 0% 100%)">a</div></div>')).toBe(`<div style="color:#fff"><div style="${PAIR}">a</div></div>`);
    // A background of its own under a colour that fell away: the colour the mail meant.
    expect(shape('<div style="background:url(x);color:#fff"><p style="background-color:#000">a</p></div>')).toBe(
      `<div style="${PAIR}"><p style="background-color:#000;color:#ffffff">a</p></div>`
    );
    // Under a background of its own the colours stand again.
    expect(shape('<td background="x.png"><div style="background-color:#000"><p style="color:#fff">a</p></div></td>')).toContain('<p style="color:#fff">');
    // A see-through ground lies over what is behind it: over a picture that is not shown, the glass card keeps the reader's pair (R1).
    expect(shape('<div style="background:url(x);color:#fff"><p style="background-color:rgba(0,0,0,0.05)">a</p></div>')).toBe(
      `<div style="${PAIR}"><p style="background-color:rgba(0,0,0,0.05)">a</p></div>`
    );
    expect(shape('<div style="background-image:url(x);color:#fff"><div style="background-image:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0.1))">a</div></div>')).toBe(
      `<div style="${PAIR}"><div style="background-image:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0.1))">a</div></div>`
    );
    // Over a ground that is shown, it stays as the mail set it.
    expect(shape('<td style="background-color:#000;color:#fff"><div style="background-color:rgba(255,255,255,0.1)">a</div></td>')).toBe('<td style="background-color:#000;color:#fff"><div style="background-color:rgba(255,255,255,0.1)">a</div></td>');
    // The colour around it is a colour understood (R4): `inherit`, `currentColor`, a variable with a fallback.
    expect(shape('<td style="background-color:#333;color:#fff"><a href="u" style="color:inherit">a</a><span style="color:currentColor">b</span><span style="color:var(--c, #eee)">c</span></td>')).toBe(
      '<td style="background-color:#333;color:#fff"><a href="u" style="color:inherit">a</a><span style="color:inherit">b</span><span style="color:#eee">c</span></td>'
    );
    // The page's own background is not given to the reader.
    expect(shape('<p style="color:#ffffff">a</p>')).toBe('<p style="color:#ffffff">a</p>');
  });

  it("gives a size that was asked for and is lost the reader's size, where nothing is inherited", () => {
    expect(shape('<div style="font-size:0"><span style="font-size:var(--x)">a</span><span style="font-size:13px">b</span></div>')).toBe(
      '<div style="font-size:0"><span style="font-size:14px">a</span><span style="font-size:13px">b</span></div>'
    );
    // A large size stays: a word too wide breaks, or the frame scrolls to it.
    // Inheriting a size somebody reads, a lost one is just lost.
    expect(shape('<span style="font-size:var(--x)">a</span>')).toBe("<span>a</span>");
    expect(shape('<span style="font-size:160px">a</span>')).toBe('<span style="font-size:160px">a</span>');
  });

  it("lets a background lie behind every word of its box", () => {
    // A size it asked for stays its least: the box grows to its words, never smaller than it was.
    expect(shape('<div style="background-color:#000;color:#fff;height:0">a</div>')).toBe('<div style="background-color:#000;color:#fff;min-height:0">a</div>');
    expect(shape('<div style="background-color:#222;color:#fff;height:40px;line-height:40px">a</div>')).toBe('<div style="background-color:#222;color:#fff;min-height:40px;line-height:40px">a</div>');
    expect(shape('<span style="display:inline-block;width:0;background-color:#000;color:#fff">a</span>')).toBe('<span style="display:inline-block;min-width:0;background-color:#000;color:#fff">a</span>');
    // A width of at least a letter stays: the words wrap inside it.
    expect(shape('<div style="background-color:#06c;color:#fff;width:30px">a</div>')).toBe('<div style="background-color:#06c;color:#fff;width:30px">a</div>');
    expect(shape('<div style="background-color:#000;color:#fff;height:0"><span style="float:left">a</span></div>')).toBe(
      '<div style="background-color:#000;color:#fff;min-height:0;display:flow-root"><span style="float:left">a</span></div>'
    );
    // A table's parts grow to their words: their sizes stay.
    expect(shape('<td style="background-color:#000;color:#fff;height:20px">a</td>')).toBe('<td style="background-color:#000;color:#fff;height:20px">a</td>');
    // A box without a background of its own may be any size.
    expect(shape('<div style="height:20px">a</div>')).toBe('<div style="height:20px">a</div>');
  });

  it("leaves what holds no words as it is at main (review of 2026-11-17, rule 1)", () => {
    // A picture keeps its size: a fluid logo, an icon, a hero held to 600, one wider than the frame (the frame scrolls to it).
    expect(shape('<img src="x" width="200" style="display:block;width:100%;max-width:200px;height:auto">')).toBe('<img src="x" style="display:block;width:100%;max-width:200px;height:auto" width="200">');
    expect(shape('<img src="x" width="1200" height="600" style="width:100%;max-width:600px;height:auto">')).toBe('<img src="x" style="width:100%;max-width:600px;height:auto" width="1200" height="600">');
    expect(shape('<img src="x" width="2000" style="max-width:none;min-width:2000px">')).toBe('<img src="x" style="max-width:none;min-width:2000px" width="2000">');
    // A dividing line, a bar, a dot keep their size and colour.
    expect(shape('<div style="height:1px;background-color:#e0e0e0"></div>')).toBe('<div style="height:1px;background-color:#e0e0e0"></div>');
    expect(shape('<div style="height:4px;background-color:#f60;max-width:600px;margin:0 auto"></div>')).toBe('<div style="height:4px;background-color:#f60;max-width:600px;margin:0 auto"></div>');
    expect(shape('<span style="display:inline-block;width:8px;height:8px;background-color:#f00"></span> x')).toBe('<span style="display:inline-block;width:8px;height:8px;background-color:#f00"></span> x');
    // A spacer cell's no-break space is no word: it keeps its line height of nothing, as at main; its colour attribute is given as the colour it is.
    expect(shape('<table><tbody><tr><td bgcolor="#eeeeee" height="2" style="font-size:0;line-height:0">&nbsp;</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><td height="2" style="background-color:#eeeeee;font-size:0;line-height:0">&nbsp;</td></tr></tbody></table>'
    );
  });

  it("keeps overflow only where it clips a box to nothing", () => {
    expect(shape('<div style="max-height:0;overflow:hidden">a</div>')).toBe('<div style="max-height:0;overflow:hidden">a</div>');
    expect(shape('<div style="height:40px;overflow:hidden">a</div>')).toBe('<div style="height:40px">a</div>');
    expect(shape('<span style="height:0;overflow:hidden">a</span>')).toBe('<span style="height:0">a</span>');
    expect(shape('<div style="height:0;padding:8px;overflow:hidden">a</div>')).toBe('<div style="height:0;padding:8px">a</div>');
  });

  it("writes attributes the way they are read", () => {
    expect(shape('<div hidden="until-found">a</div>')).toBe('<div hidden="">a</div>');
    // A colour attribute as the legacy rule reads it — the colour a browser shows — given as a style.
    expect(shape('<table bgcolor="ffffff" cellpadding="600"><tbody><tr><td nowrap="">a</td></tr></tbody></table>')).toBe('<table style="background-color:#ffffff"><tbody><tr><td nowrap="">a</td></tr></tbody></table>');
    expect(shape('<table bgcolor="chucknorris"><tbody><tr><td>a</td></tr></tbody></table>')).toBe('<table style="background-color:#c00000"><tbody><tr><td>a</td></tr></tbody></table>');
    expect(shape('<font color="fff">a</font>')).toBe('<font color="#0f0f0f">a</font>');
    // `bgcolor` paints only on a page and a table's parts.
    expect(shape('<div bgcolor="#000">a</div>')).toBe("<div>a</div>");
    expect(shape('<table><colgroup><col style="visibility:collapse" width="900"></colgroup></table>')).toBe("<table><colgroup><col></colgroup></table>");
  });
});

describe("colours as a mail writes them", () => {
  it("reads the forms a style writes", () => {
    expect(readColour("#fff")).toEqual([255, 255, 255, 1]);
    expect(readColour("#ffffff80")).toEqual([255, 255, 255, 128 / 255]);
    expect(readColour("rgba(255, 255, 255, 0.85)")).toEqual([255, 255, 255, 0.85]);
    expect(readColour("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    expect(readColour("hsl(0 100% 50%)")?.slice(0, 3).map(Math.round)).toEqual([255, 0, 0]);
    expect(readColour("rebeccapurple")).toEqual([0x66, 0x33, 0x99, 1]);
    expect(readColour("transparent")).toEqual([0, 0, 0, 0]);
    for (const unread of ["canvas", "currentcolor", "rgb(1,2)", "#ggg", "hsl(0 100 50)", "var(--x)"]) expect(readColour(unread), unread).toBeNull();
    expect(readAttributeColour("ffffff")).toEqual([255, 255, 255, 1]);
    expect(readAttributeColour(" White ")).toEqual([255, 255, 255, 1]);
    // The legacy rule of HTML: what a browser shows for any string.
    expect(readAttributeColour("chucknorris")).toEqual([192, 0, 0, 1]);
    expect(readAttributeColour("fff")).toEqual([15, 15, 15, 1]);
    expect(readAttributeColour("transparent")).toBeNull();
  });

  it("tells a faint footer from a word nobody sees", () => {
    const white = readColour("#ffffff")!;
    expect(contrast(readColour("#cccccc")!, white)).toBeGreaterThan(MIN_CONTRAST);
    expect(contrast(readColour("#999999")!, white)).toBeGreaterThan(MIN_CONTRAST);
    expect(contrast(readColour("#eeeeee")!, white)).toBeLessThan(MIN_CONTRAST);
    expect(contrast(white, white)).toBe(1);
  });
});

describe("a font size worked out", () => {
  it("comes to the least it can be", () => {
    expect(fontSizePx("calc(14px + 0.2vw)", 0)).toBeCloseTo(14.56);
    expect(fontSizePx("clamp(14px, 2vw, 18px)", 0)).toBe(14);
    expect(fontSizePx("min(2em, 30px)", 10)).toBe(20);
    expect(fontSizePx("calc(1em - 2px)", 14)).toBe(12);
    expect(fontSizePx("2ex", 10)).toBe(8);
    expect(fontSizePx("calc(10px * 2)", 14)).toBe(20);
    for (const unread of ["calc(1px * 1px)", "calc(10)", "calc(1px / 0)", "calc(var(--x))", "clamp(1px, 2px)", "calc(1px + 1)"]) expect(fontSizePx(unread, 14), unread).toBeNull();
  });
});

describe("the walk on the reader's white sheet", () => {
  const read = (html: string) => htmlToVisibleDocument(html, undefined, { canvas: WHITE_SHEET }).text;
  it("leaves out text in the colour of what lies behind it, and only that", () => {
    expect(read('<div style="background-color:#fff"><span style="color:#fff">a</span>b</div>')).toBe("b");
    expect(read('<table bgcolor="#000000"><tr><td><font color="black">a</font><font color="#ffffff">b</font></td></tr></table>')).toBe("b");
    expect(read('<p style="color:rgba(255,255,255,0.9)">a</p><div style="background:#111"><p style="color:rgba(255,255,255,0.9)">b</p></div>')).toBe("b");
    // On a gradient, against every one of its colours.
    expect(read('<div style="background-image:linear-gradient(#000,#333)"><span style="color:#fff">a</span></div>')).toBe("a");
    expect(read('<div style="background-image:linear-gradient(#fff,#000)"><span style="color:#fff">a</span></div>')).toBe("");
    // A colour the letters inherit is the colour around them, a link's too (R4).
    expect(read('<table bgcolor="#1a1a1a"><tr><td style="color:#fff"><a href="u" style="color:inherit">a</a><span style="color:var(--c, #eee)">b</span></td></tr></table>')).toBe("ab");
    // A link and a mark have colours of their own.
    expect(read('<div style="color:#fff"><a href="x">l</a><mark>m</mark>w</div>')).toBe("lm");
    // Without the white sheet the colours are the theme's: nothing is compared.
    expect(htmlToVisibleDocument('<span style="color:#fff">a</span>').text).toBe("a");
  });
});
