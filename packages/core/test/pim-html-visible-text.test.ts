import { describe, it, expect } from "vitest";
import { htmlToVisibleText } from "../src/pim/htmlVisibleText.js";

/**
 * The text of an HTML body as a reader has it on screen. It is what a reply
 * quotes and a filed mail holds when the message brought no text part of its
 * own, so three things are pinned here: nothing the reader does not show gets
 * in, the lines stand as they do on screen, and no markup makes it throw.
 */
describe("htmlToVisibleText", () => {
  it("reads paragraphs and line breaks the way they stand on screen", () => {
    expect(htmlToVisibleText("<p>Hallo Marco,</p><p>anbei die Rechnung.<br>Viele Grüße</p>")).toBe("Hallo Marco,\n\nanbei die Rechnung.\nViele Grüße");
    expect(htmlToVisibleText("<div>eins</div><div>zwei</div>")).toBe("eins\nzwei");
    expect(htmlToVisibleText("eins<br><br><br>zwei")).toBe("eins\n\nzwei");
    expect(htmlToVisibleText("<h1>Titel</h1>Text")).toBe("Titel\n\nText");
  });

  it("reads blanks as HTML does: a line break in the source is a blank", () => {
    expect(htmlToVisibleText("<div>\n      Hallo\n      Welt   </div>\n   <div>zwei</div>\n")).toBe("Hallo Welt\nzwei");
    expect(htmlToVisibleText("Hallo <b>fette</b>   <i>Welt</i>")).toBe("Hallo fette Welt");
    expect(htmlToVisibleText("Tom &amp; Jerry&nbsp;&lt;3")).toBe("Tom & Jerry <3");
    // A blank that does not break is a blank in a plain text, and a run of them is not folded.
    expect(htmlToVisibleText("<p>a&nbsp;&nbsp;&nbsp;b</p>")).toBe("a   b");
    // Only the blanks HTML folds are folded: the wide blank of a Japanese mail is a character of its text.
    const wide = String.fromCharCode(0x3000);
    expect(htmlToVisibleText(`<p>${wide}山田${wide}太郎  様</p>`)).toBe(`${wide}山田${wide}太郎 様`);
    // A paragraph of nothing but a non-breaking blank is an empty line, as Outlook writes one.
    expect(htmlToVisibleText('<p class="MsoNormal">Hallo,<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p><p class="MsoNormal">anbei.<o:p></o:p></p>')).toBe("Hallo,\n\nanbei.");
  });

  it("leaves out what is never text on screen", () => {
    const html =
      "<html><head><title>Fenstertitel</title><style>p { color: red }</style></head><body>" +
      "<script>alert(1)</script><!-- Kommentar --><!--[if mso]><p>nur Outlook</p><![endif]-->" +
      "<template><p>Vorlage</p></template><noscript>ohne Skript</noscript><svg><text>Bild</text></svg>" +
      "<p>Sichtbar</p></body></html>";
    expect(htmlToVisibleText(html)).toBe("Sichtbar");
  });

  it("leaves out what a browser hides by itself and what the mail reader drops whole", () => {
    // Fallback text of elements the browser draws itself, and the brackets around a ruby text.
    expect(htmlToVisibleText("<p>Stand: <meter value=0.5>halb</meter><progress>fast fertig</progress>heute</p>")).toBe("Stand: heute");
    expect(htmlToVisibleText("<p><ruby>Wort<rp>(</rp><rt>Lesung</rt><rp>)</rp></ruby></p>")).toBe("WortLesung");
    expect(htmlToVisibleText('<p>Ort</p><datalist id="orte"><option>Berlin</option></datalist>')).toBe("Ort");
    // Removed by the reader's sanitizer together with what they hold.
    expect(htmlToVisibleText("<p>Davor</p><noembed>ohne Einbettung</noembed><noframes>ohne Rahmen</noframes><xmp><b>roh</b></xmp><p>Danach</p>")).toBe("Davor\n\nDanach");
    expect(htmlToVisibleText("<p>Davor</p><plaintext>Rest <b>bis</b> zum Ende</p>")).toBe("Davor");
  });

  it.each([
    ["the hidden attribute", "<div hidden>X</div>"],
    ["display: none", '<div style="display:none">X</div>'],
    ["display: none, written loosely", '<div style="  DISPLAY : None  !important ; color: red">X</div>'],
    ["visibility: hidden", '<span style="visibility:hidden">X</span>'],
    ["opacity: 0", '<span style="opacity:0">X</span>'],
    ["a font of no size", '<span style="font-size:0">X</span>'],
    ["a font of one pixel", '<span style="color:#ffffff;font-size:1px">X</span>'],
    ["a box of no height that clips", '<div style="max-height:0;overflow:hidden">X</div>'],
    ["a one-pixel box that clips", '<span style="position:absolute;width:1px;height:1px;overflow:hidden">X</span>'],
    ["a hidden table row", '<table><tr style="display:none"><td>X</td></tr></table>'],
  ])("leaves out an element taken off the screen by %s", (_what, hidden) => {
    expect(htmlToVisibleText(`<p>Davor</p>${hidden}<p>Danach</p>`)).toBe("Davor\n\nDanach");
  });

  it.each([
    ["display: block", '<div style="display:block">X</div>'],
    ["a later declaration that shows it again", '<div style="display:none;display:block">X</div>'],
    ["half an opacity", '<span style="opacity:0.5">X</span>'],
    ["a readable font size", '<span style="font-size:12px">X</span>'],
    ["no height, but nothing clips", '<div style="max-height:0">X</div>'],
    ["a clipping box of real size", '<div style="height:40px;overflow:hidden">X</div>'],
    ["aria-hidden, which a screen still shows", '<span aria-hidden="true">X</span>'],
    ["a class, whose style sheet no mail reader keeps", '<div class="preheader">X</div>'],
    // The mail reader removes a style that loads something, so the element is on screen there.
    ["a style the reader drops because it names a url(", '<div style="display:none;background:url(https://tracker.example/p.gif)">X</div>'],
  ])("keeps an element with %s", (_what, shown) => {
    expect(htmlToVisibleText(`<p>Davor</p>${shown}<p>Danach</p>`)).toBe("Davor\n\nX\n\nDanach");
  });

  it("shows what sets its size or its visibility again inside an element that hides text", () => {
    // What a layout tool writes (MJML): size 0 on the cells that only arrange, a real size on what is read.
    expect(htmlToVisibleText('<table><tr><td style="font-size:0px;padding:10px"><div style="font-size:13px">Hello World</div></td></tr></table>')).toBe("Hello World");
    expect(
      htmlToVisibleText(
        '<table><tr><td style="text-align:center;font-size:0;">' +
          '<div style="display:inline-block;font-size:16px">Left column</div><div style="display:inline-block;font-size:16px">Right column</div>' +
          "</td></tr></table>",
      ),
    ).toBe("Left column\nRight column");
    expect(htmlToVisibleText('<div style="visibility:hidden">a<span style="visibility:visible">b</span>c</div>')).toBe("b");
    // A size measured against the parent's stays what the parent's is; nothing is nothing in every unit.
    expect(htmlToVisibleText('<div style="font-size:0">a<span style="font-size:120%">b</span><span style="font-size:1.2em">c</span><b style="font-size:medium">d</b></div>')).toBe("d");
    expect(htmlToVisibleText('<p>a<span style="font-size:0em">b</span>c</p>')).toBe("ac");
    // A number without a unit is no font size, so nothing is set again by it; neither by "as the parent's".
    expect(htmlToVisibleText('<div style="font-size:0">a<span style="font-size:12">b</span><span style="font-size:unset">c</span></div>d')).toBe("d");
    // Off the screen with all it holds: nothing inside can come back.
    expect(htmlToVisibleText('<div style="display:none"><span style="display:block;visibility:visible;font-size:20px">X</span></div>Y')).toBe("Y");
    expect(htmlToVisibleText('<div style="opacity:0"><span style="opacity:1">X</span></div>Y')).toBe("Y");
  });

  it("reads an element's own style the way a browser does", () => {
    // The `hidden` attribute is the browser's `display: none`; the element's own display replaces it.
    expect(htmlToVisibleText('<div hidden style="display:block">X</div>')).toBe("X");
    // A dialog is on screen once it is open — or where its own style shows it.
    expect(htmlToVisibleText('<dialog>Zu</dialog><dialog open>Offen</dialog><dialog style="display:block">Gezeigt</dialog>')).toBe("Offen\nGezeigt");
    // `!important` holds against a later declaration, however it is spaced.
    expect(htmlToVisibleText('<div style="display:block !important;display:none">X</div>')).toBe("X");
    expect(htmlToVisibleText('<div style="display:none ! important;display:block">X</div>Y')).toBe("Y");
    // A length without a unit is no length: the declaration does not apply.
    expect(htmlToVisibleText('<span style="font-size:1">X</span>')).toBe("X");
    expect(htmlToVisibleText('<div style="width:1;overflow:hidden">X</div>')).toBe("X");
    // What stands inside an element the mail reader removes but keeps the content of, is on screen there.
    expect(htmlToVisibleText("<object><p>Ersatztext</p></object>")).toBe("Ersatztext");
  });

  it("leaves out the preview line a sender hides above the message", () => {
    const html =
      '<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Nur heute: 50 % Rabatt</div>' +
      '<div style="display: none; max-height: 0px; overflow: hidden;">&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>' +
      "<table><tr><td><p>Guten Tag,</p><p>Ihre Rechnung liegt bereit.</p></td></tr></table>";
    expect(htmlToVisibleText(html)).toBe("Guten Tag,\n\nIhre Rechnung liegt bereit.");
  });

  it("reads a line of characters without width as an empty line", () => {
    expect(htmlToVisibleText("<div>eins</div><div>&#847;&zwnj;&nbsp;&#847;&zwnj;&#8203;&shy;</div><div>zwei</div>")).toBe("eins\nzwei");
    // Inside a word they are part of the text and stay (the soft hyphen is built here, never typed).
    expect(htmlToVisibleText("<p>Silben&shy;trennung</p>")).toBe("Silben" + String.fromCharCode(0xad) + "trennung");
  });

  it("marks a quoted passage level by level, so a reply can quote it once more", () => {
    expect(htmlToVisibleText("<div>Am 1. Juli schrieb Anna:</div><blockquote><p>Hallo,</p><p>bis morgen.</p></blockquote><div>Gern.</div>")).toBe(
      "Am 1. Juli schrieb Anna:\n\n> Hallo,\n>\n> bis morgen.\n\nGern.",
    );
    expect(htmlToVisibleText("<blockquote>A<blockquote>B</blockquote>C</blockquote>")).toBe("> A\n>\n> > B\n>\n> C");
  });

  it("keeps lists as lists", () => {
    expect(htmlToVisibleText("<p>Offen:</p><ul><li>Angebot</li><li><div>Rechnung</div></li></ul>")).toBe("Offen:\n\n- Angebot\n- Rechnung");
    expect(htmlToVisibleText('<ol><li>eins</li><li>zwei</li></ol><ol start="5"><li>fünf</li></ol>')).toBe("1. eins\n2. zwei\n\n5. fünf");
    expect(htmlToVisibleText("<ul><li>Oben<ul><li>Unten</li></ul></li><li></li><li>Ende</li></ul>")).toBe("- Oben\n- Unten\n- Ende");
  });

  it("puts a table row on a line and a blank between its cells", () => {
    expect(htmlToVisibleText("<table><tr><th>Posten</th><th>Betrag</th></tr><tr><td>Lizenz</td><td>120 €</td></tr></table>")).toBe("Posten Betrag\nLizenz 120 €");
  });

  it("keeps preformatted lines as they are written", () => {
    expect(htmlToVisibleText("<p>Code:</p><pre>if (a) {\n    b();\n\n\n}\n</pre><p>Ende</p>")).toBe("Code:\n\nif (a) {\n    b();\n\n}\n\nEnde");
    // An element whose own style keeps its lines is read the same way; its neighbour is not.
    expect(htmlToVisibleText('<div style="white-space: pre-wrap">eins\nzwei  drei</div><div>vier\nfünf</div>')).toBe("eins\nzwei  drei\nvier fünf");
    // Kept blanks are kept where they stand; the running text around them is folded as ever.
    expect(htmlToVisibleText('<p>  a   b <span style="white-space:pre">c  d</span>   e   f  </p>')).toBe("a b c  d e f");
    expect(htmlToVisibleText('<pre>eins\n<span style="white-space:normal">zwei\n   drei</span></pre>')).toBe("eins\nzwei drei");
  });

  it("answers markup of any depth and shape without throwing", () => {
    const deep = "<div>".repeat(5_000) + "Tief" + "</div>".repeat(5_000);
    expect(htmlToVisibleText(deep)).toBe("Tief");
    expect(htmlToVisibleText("")).toBe("");
    expect(htmlToVisibleText("   \n  ")).toBe("");
    expect(htmlToVisibleText("</p></blockquote></li>Rest<li>")).toBe("Rest");
    expect(htmlToVisibleText("kein Markup, nur Text")).toBe("kein Markup, nur Text");
  });

  it("writes no more than it reads: quotes nested without end are marked up to a depth, not squared", () => {
    const levels = 40;
    const nested = htmlToVisibleText("<blockquote>".repeat(levels) + "tief" + "</blockquote>".repeat(levels));
    expect(nested).toBe("> ".repeat(32) + "tief");
    // 3000 levels, one word each: every line stays short, so the text grows with the input.
    const lines = htmlToVisibleText("<blockquote>x".repeat(3_000)).split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBe(65);
    expect(lines.length).toBeLessThan(6_001);
  });

  it("walks a tree the caller brings: plain objects in the shape of the portable parser's", () => {
    // A copy of what a browser's parser made: names in capitals, as a DOM spells them.
    interface CopiedNode {
      nodeName: string;
      childNodes: CopiedNode[];
      value?: string;
      attrs?: Array<{ name: string; value: string }>;
    }
    const element = (name: string, attributes: Record<string, string>, ...childNodes: CopiedNode[]): CopiedNode => ({
      nodeName: name,
      childNodes,
      attrs: Object.entries(attributes).map(([attribute, value]) => ({ name: attribute, value })),
    });
    const text = (value: string): CopiedNode => ({ nodeName: "#text", value, childNodes: [] });
    const body = element(
      "BODY",
      { style: "display:none" },
      element("DIV", { style: "display:none" }, text("Vorschau")),
      element("P", {}, text("Hallo "), element("B", {}, text("Welt"))),
      element("DIALOG", { open: "" }, text("Hinweis")),
      element("DIALOG", {}, text("nie geöffnet")),
    );
    // The root is a container: its own style is not the message's.
    expect(htmlToVisibleText("", () => body)).toBe("Hallo Welt\n\nHinweis");
  });

  it("reads one long line in time that grows with its length", () => {
    // 200 000 short texts on one line, each beginning with a blank. Whether the
    // line ended in a blank was asked of the line itself, which flattened the
    // growing string once per text: a quarter of a minute for this one.
    const pieces = Array.from({ length: 200_000 }, () => ({ nodeName: "b", attrs: [], childNodes: [{ nodeName: "#text", value: " a" }] }));
    const start = performance.now();
    const text = htmlToVisibleText("", () => ({ nodeName: "#root", childNodes: pieces }));
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(text.length).toBe(2 * 200_000 - 1);
    expect(text.startsWith("a a a ")).toBe(true);
    expect(text.endsWith(" a a")).toBe(true);
  });
});
