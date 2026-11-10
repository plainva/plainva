// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMailFrameDoc, mailHtmlPaintsItself, readMailCanvas, sanitizeEmailHtml, type MailCanvas } from "@plainva/ui/mail";

// Finding X3 (review 2026-11-10): in the dark design every HTML mail was a
// white sheet, also one that sets no colours of its own and would read in the
// theme's colours exactly like a plain-text mail. The white sheet stays for a
// mail that brings its own colours: its text was chosen against a light page.
const DARK: MailCanvas = { text: "#e4e9e8", background: "#141b1a", link: "#5cc4b4", dark: true };
const frameBody = (doc: string) => /<style>(.*?)<\/style>/s.exec(doc)?.[1] ?? "";

describe("the mail frame's canvas", () => {
  it("gives a mail without colours of its own the theme's canvas", () => {
    const clean = sanitizeEmailHtml("<p>Hallo,</p><p>anbei die <b>Rechnung</b>.</p>").html;
    const css = frameBody(buildMailFrameDoc(clean, { canvas: DARK }));
    expect(css).toContain("background:#141b1a");
    expect(css).toContain("color:#e4e9e8");
    expect(css).toContain("color-scheme:dark");
    expect(css).not.toContain("#fff");
  });

  it("keeps the white sheet for a mail that sets a background or a text colour", () => {
    for (const html of [
      '<table bgcolor="#ffffff"><tr><td>Newsletter</td></tr></table>',
      '<div style="background-color: #f4f4f4">Box</div>',
      '<p style="color:#333333">Dark text</p>',
      '<font color="#000080">Old mail</font>',
    ]) {
      const clean = sanitizeEmailHtml(html).html;
      expect(mailHtmlPaintsItself(clean), html).toBe(true);
      expect(frameBody(buildMailFrameDoc(clean, { canvas: DARK })), html).toContain("background:#fff");
    }
  });

  it("does not count a style that sets neither colour nor background", () => {
    const clean = sanitizeEmailHtml('<p style="margin:0;font-size:14px">Text</p><img alt="colorful">').html;
    expect(mailHtmlPaintsItself(clean)).toBe(false);
  });

  it("stays the white sheet without a canvas, as before", () => {
    expect(frameBody(buildMailFrameDoc("<p>x</p>"))).toContain("background:#fff");
  });

  it("refuses a colour value that could break out of its rule", () => {
    const css = frameBody(buildMailFrameDoc("<p>x</p>", { canvas: { ...DARK, background: "red}body{display:none" } }));
    expect(css).toContain("background:#fff");
    expect(css).not.toContain("display:none");
  });

  it("reads the canvas from the theme's computed custom properties", () => {
    const root = document.documentElement;
    root.style.setProperty("--text-main", "#e4e9e8");
    root.style.setProperty("--bg-primary", "#141b1a");
    root.style.setProperty("--accent-color", "#5cc4b4");
    root.setAttribute("data-theme", "dark");
    try {
      expect(readMailCanvas(root)).toEqual(DARK);
    } finally {
      for (const name of ["--text-main", "--bg-primary", "--accent-color"]) root.style.removeProperty(name);
      root.removeAttribute("data-theme");
    }
  });
});
