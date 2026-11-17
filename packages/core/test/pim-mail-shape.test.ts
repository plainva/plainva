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
    expect(shape('<table width="3000"><tbody><tr><td>x</td></tr></tbody></table>')).toBe("<table><tbody><tr><td>x</td></tr></tbody></table>");
    // A list nested too deep loses the indent a browser gives it.
    const deep = `${"<ul>".repeat(16)}<li>x</li>${"</ul>".repeat(16)}`;
    expect(shape(deep)).toContain('<ul style="padding-left:0 !important;padding-right:0 !important">');
    expect(LEFT_MAX).toBeLessThan(REACH_MAX);
  });

  it("takes back the widths of a row whose cells reach too far together", () => {
    // The third would begin past the frame's middle: the two before it give up their widths, and it begins at the row.
    const row = '<table><tbody><tr><td width="300">a</td><td width="300">b</td><td style="width:300px">c</td></tr></tbody></table>';
    expect(shape(row)).toBe('<table><tbody><tr><td>a</td><td>b</td><td style="width:300px">c</td></tr></tbody></table>');
    // Two columns of a 600 px newsletter stay as they are.
    const two = '<table width="600"><tbody><tr><td width="300" style="padding:0 20px">a</td><td width="300">b</td></tr></tbody></table>';
    expect(shape(two)).toBe('<table width="600"><tbody><tr><td style="padding:0 20px" width="300">a</td><td width="300">b</td></tr></tbody></table>');
  });

  it("takes a text colour away with the background it was set on", () => {
    expect(shape('<div style="background:url(x)"><p style="color:#fff;margin:0">a</p><font color="white">b</font></div>')).toBe(
      '<div><p style="margin:0">a</p><font>b</font></div>'
    );
    // Under a background of its own the colours stand again.
    expect(shape('<td background="x.png"><div style="background-color:#000"><p style="color:#fff">a</p></div></td>')).toContain('<p style="color:#fff">');
    // The page's own background is not given to the reader.
    expect(shape('<p style="color:#ffffff">a</p>')).toBe('<p style="color:#ffffff">a</p>');
  });

  it("gives a size that was asked for and is lost the reader's size, where nothing is inherited", () => {
    expect(shape('<div style="font-size:0"><span style="font-size:var(--x)">a</span><span style="font-size:13px">b</span></div>')).toBe(
      '<div style="font-size:0"><span style="font-size:14px">a</span><span style="font-size:13px">b</span></div>'
    );
    // Inheriting a size somebody reads, a lost one is just lost.
    expect(shape('<span style="font-size:var(--x)">a</span>')).toBe("<span>a</span>");
    expect(shape('<span style="font-size:100em">a</span>')).toBe('<span style="font-size:160px">a</span>');
  });

  it("keeps overflow only where it clips a box to nothing", () => {
    expect(shape('<div style="max-height:0;overflow:hidden">a</div>')).toBe('<div style="max-height:0;overflow:hidden">a</div>');
    expect(shape('<div style="height:40px;overflow:hidden">a</div>')).toBe('<div style="height:40px">a</div>');
    expect(shape('<span style="height:0;overflow:hidden">a</span>')).toBe('<span style="height:0">a</span>');
    expect(shape('<div style="height:0;padding:8px;overflow:hidden">a</div>')).toBe('<div style="height:0;padding:8px">a</div>');
  });

  it("writes attributes the way they are read", () => {
    expect(shape('<div hidden="until-found">a</div>')).toBe('<div hidden="">a</div>');
    expect(shape('<table bgcolor="ffffff" cellpadding="600"><tbody><tr><td nowrap="">a</td></tr></tbody></table>')).toBe('<table bgcolor="#ffffff"><tbody><tr><td>a</td></tr></tbody></table>');
    expect(shape('<table bgcolor="chucknorris"><tbody><tr><td>a</td></tr></tbody></table>')).toBe("<table><tbody><tr><td>a</td></tr></tbody></table>");
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
    expect(readAttributeColour("chucknorris")).toBeNull();
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
    // A link and a mark have colours of their own.
    expect(read('<div style="color:#fff"><a href="x">l</a><mark>m</mark>w</div>')).toBe("lm");
    // Without the white sheet the colours are the theme's: nothing is compared.
    expect(htmlToVisibleDocument('<span style="color:#fff">a</span>').text).toBe("a");
  });
});
