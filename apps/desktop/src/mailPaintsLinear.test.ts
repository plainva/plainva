import { describe, expect, it } from "vitest";
import { within } from "../../../packages/core/test/helpers/timeBudget";
import { mailHtmlPaintsItself } from "@plainva/ui/mail";

/**
 * Whether a mail paints itself is read in linear time (code scanning #273, js/polynomial-redos). The three
 * expressions it replaces, kept here as the reference, read the rest of a tag again from every `<a` in it, and the
 * rest of a style from every `color` in it — quadratic in a long attribute of a mail. The scan answers exactly what
 * they answered; mailCanvas.test.ts pins the frame around it unchanged.
 */
const REFERENCE = (html: string) =>
  /<[a-z][^>]*\s(bgcolor|background)\s*=/i.test(html) ||
  /<font\b[^>]*\scolor\s*=/i.test(html) ||
  /\sstyle\s*=\s*("[^"]*|'[^']*)\b(background|color)\b[^:;"']*:/i.test(html);
const N = 20_000;

describe("whether a mail paints itself", () => {
  it("reads colours in attributes, in fonts and in styles", () => {
    for (const html of [
      '<table bgcolor="#ffffff"><tr><td>x</td></tr></table>',
      '<td background="bg.png">x</td>',
      '<font color="#000080">x</font>',
      '<div style="background-color: #f4f4f4">x</div>',
      "<p style='margin:0; color : red'>x</p>",
      '<p style="font-weight:bold;color:#333">x</p>',
      '<p title="a" style="border-color:red">x</p>',
    ]) {
      expect(mailHtmlPaintsItself(html), html).toBe(true);
    }
    for (const html of [
      "<p>colour: plain text, background: none</p>",
      '<p style="margin:0">x</p>',
      '<p style="font-family:\'color\'">x</p>',
      '<p class="bgcolor">x</p>',
      '<span>font color = red</span>',
      '<p style="x;color">x</p>',
    ]) {
      expect(mailHtmlPaintsItself(html), html).toBe(false);
    }
  });

  it("agrees with the expressions it replaces on every text of their marks", () => {
    const parts = ["<", ">", "a", "font", " ", "bgcolor", "background", "color", "style", "=", ":", ";", '"', "'", "-", "\n"];
    let seed = 11;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let round = 0; round < 40_000; round++) {
      let html = "";
      for (let i = next() % 12; i > 0; i--) html += parts[next() % parts.length];
      expect(mailHtmlPaintsItself(html), JSON.stringify(html)).toBe(REFERENCE(html));
    }
  });

  it("stays linear on a long attribute of tag openings, and on a long style of colour words", () => {
    const tags = `<p title="${"<a".repeat(N * 5)}">x</p>`;
    within(1_000, () => expect(mailHtmlPaintsItself(tags)).toBe(false));
    const words = `<p style="${"color ".repeat(N * 3)}">x</p>`;
    within(1_000, () => expect(mailHtmlPaintsItself(words)).toBe(false));
  });
});
