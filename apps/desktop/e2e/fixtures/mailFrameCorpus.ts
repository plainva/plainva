/**
 * Ordinary newsletter forms that hide nothing (review of 2026-11-17, rule 3):
 * a hero with a shading and a glass card, fluid pictures, logos and icons,
 * dividing lines, bars and dots, buttons, a footer with `color: inherit`,
 * light words on dark cells, a dark theme, Korean set with `keep-all` — and the
 * reviewer's cases of the fourth round. The reader shows each one as `main`
 * does: the same boxes (width and height within 1 px) and the same computed
 * colours for every element with words and every element that paints, and
 * words at least as readable (`mailFrameEquality.spec.ts`, against
 * `mailFrameCorpus.main.json`, frozen from `main` in Chromium and WebKit).
 *
 * Where the reader shows a case otherwise on purpose, `differs` says which
 * element (its path in the frame, as `measureFrame` writes it — that element
 * only, not what stands inside it — or `*` for the whole case) and why. Words marked VISIBLE are meant to be read; the
 * assistant reads no word the frame does not show.
 */
export interface MailCorpusCase {
  name: string;
  html: string;
  /** Elements the reader shows otherwise than `main`, with the reason. */
  differs?: Record<string, string>;
}

const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
const REMOTE = "https://cdn.example.invalid";
const LINE = "Ein ganz gewöhnlicher Absatz mit ein paar Worten darin, damit die Zeile umbricht";

/** The box of a picture the reader never fetches (it is how mails track) takes the reader's pair: on the white sheet it looks as at main, where the box had no style. */
const PICTURE_BOX = "the hero picture is never fetched; its box takes the reader's pair, white on the white sheet, where main dropped its style";

/** The glass card in a cell whose picture is never fetched. */
const GLASS_CELL = "main shows these words white on the near-white glass card (contrast 1): the picture behind the cell is never fetched, and the cell and its card take the reader's pair";

/** Why the reader shows words otherwise than main, where main shows them unreadably. */
const MAIN_WHITE_ON_WHITE =
  "main shows these words white on the white sheet (contrast 1): the page's own background is given to neither reader, and the words take the reader's pair";

/** The reviewer's cases of the fourth round (2026-11-17) that hide nothing, and the four regressions it found. */
const REVIEW_4: MailCorpusCase[] = [
  { name: "review 4 · p1 bgcolor fff table, dark text", html: "<table bgcolor=\"fff\"><tr><td style=\"color:#333333\">VISIBLEp1</td></tr></table>" },
  { name: "review 4 · p2 font color fff on dark td", html: "<table bgcolor=\"#000000\"><tr><td><font color=\"fff\">VISIBLEp2</font></td></tr></table>" },
  { name: "review 4 · p3 bgcolor ccc table", html: "<table bgcolor=\"ccc\"><tr><td>VISIBLEp3</td></tr></table>" },
  { name: "review 4 · p4 bgcolor on tr, color on td", html: "<table><tr bgcolor=\"#000000\"><td style=\"color:#ffffff\">VISIBLEp4</td></tr></table>" },
  { name: "review 4 · p5 bgcolor on body", html: "<body bgcolor=\"#000000\"><p style=\"color:#ffffff\">VISIBLEp5</p></body>", differs: { "body/0": MAIN_WHITE_ON_WHITE } },
  { name: "review 4 · p6 color on table, bg on td", html: "<table style=\"color:#ffffff\"><tr><td style=\"background-color:#000000\">VISIBLEp6</td></tr></table>" },
  { name: "review 4 · p7 bg shorthand url+colour, white text", html: "<td style=\"background:#000000 url(https://x.example.com/a.jpg) no-repeat;color:#ffffff\">VISIBLEp7</td>" },
  { name: "review 4 · p8 bg shorthand url+colour div", html: "<div style=\"background:#000000 url(https://x.example.com/a.jpg) no-repeat;color:#ffffff\">VISIBLEp8</div>", differs: { "body/0": "main drops the whole style of a box that names a picture; the reader keeps its colours, white on black, and leaves the picture out" } },
  { name: "review 4 · p9 bg-color transparent white text in dark td", html: "<table><tr><td style=\"background-color:#000000\"><div style=\"background-color:transparent;color:#ffffff\">VISIBLEp9</div></td></tr></table>" },
  { name: "review 4 · p10 link color inherit in dark td", html: "<table><tr><td style=\"background-color:#333333;color:#ffffff\"><a href=\"https://e.example.com/u\" style=\"color:inherit;text-decoration:none\">VISIBLEp10</a></td></tr></table>" },
  { name: "review 4 · p11 color currentColor", html: "<div style=\"background-color:#000;color:#fff\"><span style=\"color:currentColor\">VISIBLEp11</span></div>" },
  { name: "review 4 · p12 important colour", html: "<div style=\"background-color:#000000 !important;color:#ffffff !important\">VISIBLEp12</div>" },
  { name: "review 4 · p13 rgba alpha 0 bg", html: "<div style=\"background-color:#000\"><div style=\"background-color:rgba(255,255,255,0);color:#fff\">VISIBLEp13</div></div>" },
  { name: "review 4 · p14 font color names/8hex", html: "<div style=\"background-color:#000\"><font color=\"white\">VISIBLEp14a</font> <font color=\"#ffffffff\">VISIBLEp14b</font> <font color=\"ffffff\">VISIBLEp14c</font></div>" },
  { name: "review 4 · p15 text-fill only", html: "<div style=\"-webkit-text-fill-color:#ffffff\">VISIBLEp15</div>", differs: { "body/0": "main paints the letters white on white with `-webkit-text-fill-color`, a colour the reader does not keep; the words take the reader's pair" } },
  { name: "review 4 · p16 color var fallback", html: "<div style=\"background-color:#ffffff\"><span style=\"color:var(--c, #333)\">VISIBLEp16</span></div>" },
  { name: "review 4 · p17 bg var under white text", html: "<div style=\"color:#fff;background-color:#000\"><div style=\"background-color:var(--b)\">VISIBLEp17</div></div>" },
  { name: "review 4 · p18 bg url under white ancestor", html: "<div style=\"color:#ffffff;background-color:#000\"><div style=\"background-image:url(https://x.example.com/p.png)\">VISIBLEp18</div></div>" },
  { name: "review 4 · p19 bgcolor td lost picture attr", html: "<table><tr><td background=\"https://x.example.com/bg.jpg\" bgcolor=\"#000000\" style=\"color:#ffffff\">VISIBLEp19</td></tr></table>" },
  { name: "review 4 · p20 plain mail with color inherit only", html: "<p>Hello <a href=\"https://e.example.com\" style=\"color:inherit\">VISIBLEp20</a></p>" },
  { name: "review 4 · p21 bg none + colour on td in dark table", html: "<table style=\"background-color:#000\"><tr><td style=\"background:none;color:#fff\">VISIBLEp21</td></tr></table>" },
  { name: "review 4 · p22 caption", html: "<table style=\"background-color:#000;color:#fff\"><caption>VISIBLEp22cap</caption><tr><td>VISIBLEp22td</td></tr></table>" },
  { name: "review 4 · p23 a no href in white p on dark", html: "<div style=\"background-color:#000;color:#fff\"><a name=\"x\">VISIBLEp23</a></div>" },
  { name: "review 4 · p26 img 2000 then text", html: "<table><tr><td><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" width=\"2000\" height=\"10\"></td><td>VISIBLEp26</td></tr></table>" },
  { name: "review 4 · p27 table width 2000", html: "<table width=\"2000\"><tr><td width=\"1900\">a</td><td>VISIBLEp27</td></tr></table>" },
  { name: "review 4 · p28 keep-all CJK", html: "<div style=\"word-break:keep-all\">中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中VISIBLEp28</div>" },
  { name: "review 4 · p29 font 160px", html: "<div style=\"font-size:160px\">LONGWORDVIS29</div>" },
  { name: "review 4 · p30 font 100px heading", html: "<h1 style=\"font-size:100px;line-height:110px\">VISIBLEp30</h1>" },
  { name: "review 4 · p31 nowrap long line", html: "<div style=\"white-space:nowrap\">word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word VISIBLEp31</div>" },
  { name: "review 4 · p32 cell with bg and width 20", html: "<table><tr><td style=\"background-color:#000;color:#fff;width:20px\">VISIBLEp32</td></tr></table>" },
  { name: "review 4 · p33 div bg width 30 (button)", html: "<div style=\"background-color:#0066cc;color:#fff;width:30px;padding:4px\">VISIBLEp33</div>" },
  { name: "review 4 · p34 button bg none blue", html: "<a href=\"https://e.example.com/b\" style=\"background:none;color:#0066cc;border:1px solid #0066cc\">VISIBLEp34</a>" },
  { name: "review 4 · p41 div bg + inline color white body", html: "<body style=\"background-color:#000000\"><p style=\"color:#ffffff\">VISIBLEp41</p></body>", differs: { "body/0": MAIN_WHITE_ON_WHITE } },
  { name: "review 4 · p42 body bgcolor fff hashless", html: "<body bgcolor=\"fff\" text=\"000\"><p>VISIBLEp42</p></body>" },
  { name: "review 4 · p43 tbody bgcolor + td color", html: "<table><tbody bgcolor=\"#000000\"><tr><td style=\"color:#ffffff\">VISIBLEp43</td></tr></tbody></table>" },
  { name: "review 4 · p44 font color fff in white mail", html: "<p><font color=\"fff\">VISIBLEp44</font></p>" },
  { name: "review 4 · body 1", html: "<html><body bgcolor=\"#000000\"><table><tr><td><font color=\"#ffffff\">VISIBLEb_1</font></td></tr></table></body></html>", differs: { "body/0/0/0/0/0": MAIN_WHITE_ON_WHITE } },
  { name: "review 4 · body 2", html: "<html style=\"background-color:#000\"><body><div style=\"color:#fff\">VISIBLEb_2</div></body></html>" },
  { name: "review 4 · body 3", html: "<body style=\"background:#000 url(https://x.example.com/a.png)\"><table style=\"color:#fff\"><tr><td>VISIBLEb_3</td></tr></table></body>", differs: { "body/0/0/0/0": MAIN_WHITE_ON_WHITE } },
  { name: "review 4 · body 4", html: "<table style=\"background-color:#000000\"><tr><td><a href=\"https://x.example.com\" style=\"color:#ffffff;background:url(https://x.example.com/btn.png)\">VISIBLEb_4</a></td></tr></table>", differs: { "body/0/0/0/0/0": "the link's white is set on a picture the reader never fetches (main drops its style and shows the default blue on black, contrast 2.2): the words fall with their ground to the reader's pair" } },
  { name: "review 4 · body 5", html: "<table bgcolor=\"#1a1a1a\"><tr><td style=\"color:#ffffff\"><span style=\"color:inherit\">VISIBLEb_5</span> <a href=\"https://x.example.com/u\" style=\"color:inherit!important\">VISIBLEb_5b</a></td></tr></table>" },
];

/**
 * The reviewer's ordinary mails of 2026-11-18 (review 6, `ordinary6.mjs`): fixed heights and
 * max-heights, fixed widths with `nowrap`, tight line heights, `word-break` — nothing hidden. The
 * gate of rule 3: they look as at main.
 */
const ORDINARY_TEXT = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const ORDINARY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** Why the reader shows a card or a preview of fixed size otherwise than main (coordination, 2026-11-18): main cuts off or overlays words the assistant reads, the branch shows them on the element itself. */
const GROWS_TO_ITS_WORDS = "main keeps the painted box at its height and its words run out of it, past its ground and over what follows; the branch lets the box grow to its words (round 4, a painted box keeps no height its words outgrow)";
const SHOWS_THE_CUT = "main cuts the box at its height or max-height with overflow:hidden, and the assistant reads the words cut off; the branch gives no clip that does not take a box to nothing, so the reader shows all of it";
const LINE_NOT_CUT = "main cuts the line at the box's width with overflow:hidden and an ellipsis, and the assistant reads the words cut off; the branch gives no clip, the whole line shows and the frame fits it";
const ORDINARY_6: MailCorpusCase[] = [
  { name: "ordinary 6 · b1 button inline-block height = line-height", html: `<p><a href="https://x.example.com/b1" style="display:inline-block;height:44px;line-height:44px;padding:0 24px;background-color:#0a66c2;color:#ffffff;border-radius:4px;text-decoration:none">VISIBLEb1 Jetzt ansehen</a></p>` },
  { name: "ordinary 6 · b2 header bar height 60 line-height 60", html: `<div style="height:60px;line-height:60px;background-color:#222222;color:#ffffff;padding:0 16px;font-size:18px">VISIBLEb2 Brand Weekly</div><p>${ORDINARY_TEXT}</p>` },
  { name: "ordinary 6 · b3 two equal-height cards, text fits", html: `<div style="width:100%"><div style="display:inline-block;width:45%;height:120px;vertical-align:top;background-color:#eeeeee;padding:8px">VISIBLEb3a Kurz</div> <div style="display:inline-block;width:45%;height:120px;vertical-align:top;background-color:#eeeeee;padding:8px">VISIBLEb3b Auch kurz</div></div>` },
  { name: "ordinary 6 · b4 equal-height cards, one text longer than the card", html: `<div><div style="display:inline-block;width:45%;height:60px;vertical-align:top;background-color:#eeeeee">VISIBLEb4a ${ORDINARY_TEXT}</div> <div style="display:inline-block;width:45%;height:60px;vertical-align:top;background-color:#dddddd">VISIBLEb4b</div></div><p>VISIBLEb4c after</p>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 6 · b5 preview cut with max-height + overflow hidden", html: `<div style="max-height:42px;line-height:21px;overflow:hidden;background-color:#fafafa">VISIBLEb5 ${ORDINARY_TEXT} ${ORDINARY_TEXT}</div><p>VISIBLEb5b after</p>`, differs: { body: SHOWS_THE_CUT, "body/0": SHOWS_THE_CUT } },
  { name: "ordinary 6 · b6 one-line ellipsis with nowrap and a fixed width", html: `<div style="width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background-color:#f0f0f0">VISIBLEb6 Sehr langer Produktname mit vielen Wörtern und noch mehr</div><p>VISIBLEb6b after</p>`, differs: { body: LINE_NOT_CUT, "body/0": LINE_NOT_CUT, "body/1": LINE_NOT_CUT } },
  { name: "ordinary 6 · b7 painted nav block 600 wide, nowrap, centred", html: `<div style="width:600px;white-space:nowrap;margin:0 auto;text-align:center;background-color:#333333;color:#ffffff">VISIBLEb7 Home | Shop | Blog</div>` },
  { name: "ordinary 6 · b8 cell with nowrap and width", html: `<table><tr><td style="white-space:nowrap;width:120px;background-color:#eef">VISIBLEb8 12.11.2026</td><td>${ORDINARY_TEXT}</td></tr></table>` },
  { name: "ordinary 6 · b9 label inline-block 80 wide nowrap, short text", html: `<p><span style="display:inline-block;width:80px;white-space:nowrap;background-color:#e0f0ff">VISIBLEb9</span> Neu</p>` },
  { name: "ordinary 6 · b10 painted block 300 wide nowrap, short text", html: `<div style="width:300px;white-space:nowrap;background-color:#fafafa;border:1px solid #ddd">VISIBLEb10 Datum: 12.11.</div>` },
  { name: "ordinary 6 · b11 painted block max-width 300 nowrap", html: `<div style="max-width:300px;white-space:nowrap;background-color:#fafafa;border:1px solid #ddd">VISIBLEb11 Kurz</div>` },
  { name: "ordinary 6 · b12 tight headline 48/36", html: `<h1 style="font-size:48px;line-height:36px;margin:0;color:#111">VISIBLEb12 Große Schlagzeile über zwei Zeilen</h1><p>VISIBLEb12b</p>` },
  { name: "ordinary 6 · b13 price bigger than the cell's px line height", html: `<table><tr><td style="font-size:14px;line-height:18px;background-color:#fff8e0;padding:4px">Nur <span style="font-size:32px;font-weight:bold">VISIBLEb13 49,99 €</span></td></tr></table>` },
  { name: "ordinary 6 · b14 bold word bigger in a paragraph", html: `<p style="font-size:12px;line-height:16px">VISIBLEb14 Text <strong style="font-size:24px">GROSS</strong> und weiter ${ORDINARY_TEXT}</p>` },
  { name: "ordinary 6 · b15 Korean keep-all in a 300 px box", html: `<div style="width:300px;word-break:keep-all;background-color:#f6f6f6">VISIBLEb15 한국어 문장은 단어 사이에서만 줄을 바꿉니다 그래서 이렇게 씁니다 한국어 문장은 단어 사이에서만</div>` },
  { name: "ordinary 6 · b16 long address with word-break normal in 300 box", html: `<div style="width:300px;word-break:normal;background-color:#f6f6f6">VISIBLEb16 https://www.example.com/very/long/path/that/goes/on/and/on/without/any/break/at/all</div>` },
  { name: "ordinary 6 · b17 divider nbsp", html: `<p>VISIBLEb17</p><div style="height:1px;background-color:#dddddd;font-size:1px;line-height:1px">&nbsp;</div><p>after</p>` },
  { name: "ordinary 6 · b18 avatar circle", html: `<div style="width:40px;height:40px;line-height:40px;border-radius:20px;background-color:#0099ff;color:#ffffff;text-align:center;font-size:16px">MK</div><p>VISIBLEb18</p>` },
  { name: "ordinary 6 · b19 badge nowrap", html: `<p>VISIBLEb19 Nachrichten <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:12px;background-color:#e00;color:#fff;text-align:center;white-space:nowrap">12</span></p>` },
  { name: "ordinary 6 · b20 nav items fixed width nowrap, one longer", html: `<div><span style="display:inline-block;width:120px;white-space:nowrap;background-color:#eee">VISIBLEb20 Start</span><span style="display:inline-block;width:120px;white-space:nowrap;background-color:#ddd">Sonderangebote der Woche</span><span style="display:inline-block;width:120px;white-space:nowrap;background-color:#ccc">Kontakt</span></div>` },
  { name: "ordinary 6 · b21 hybrid columns in font-size 0 / line-height 0 cell", html: `<table width="100%"><tr><td style="font-size:0;line-height:0" align="center"><div style="display:inline-block;max-width:300px;width:100%;vertical-align:top"><table width="100%"><tr><td style="font-size:14px;line-height:20px;padding:8px">VISIBLEb21a ${ORDINARY_TEXT}</td></tr></table></div><div style="display:inline-block;max-width:300px;width:100%;vertical-align:top"><table width="100%"><tr><td style="font-size:14px;line-height:20px;padding:8px">VISIBLEb21b ${ORDINARY_TEXT}</td></tr></table></div></td></tr></table>` },
  { name: "ordinary 6 · b22 hero stage with fixed height and gradient", html: `<div style="height:200px;background-image:linear-gradient(#1d3557,#457b9d);color:#ffffff;padding:20px;font-size:24px">VISIBLEb22 Sommer</div>` },
  { name: "ordinary 6 · b23 mobile-only block clipped to nothing", html: `<div style="display:none;max-height:0;overflow:hidden">Mobil-Text</div><p>VISIBLEb23</p>` },
  { name: "ordinary 6 · b24 fixed-height list item", html: `<ul><li style="height:24px;line-height:24px">VISIBLEb24a Eins</li><li style="height:24px;line-height:24px">Zwei</li></ul>` },
  { name: "ordinary 6 · b25 footer nowrap 560 wide", html: `<div style="width:560px;white-space:nowrap;font-size:11px;color:#999999">VISIBLEb25 © 2026 Musterfirma · Impressum · Datenschutz</div>` },
  { name: "ordinary 6 · b26 line-height 1 on big heading", html: `<h2 style="font-size:32px;line-height:1;margin:0">VISIBLEb26 Überschrift mit Zeilenhöhe eins</h2>` },
  { name: "ordinary 6 · b27 font shorthand tight", html: `<p style="font:bold 30px/22px Georgia,serif">VISIBLEb27 Zitat in großer Schrift über zwei Zeilen hinweg</p>` },
  { name: "ordinary 6 · b28 inherited px line height into h1 child", html: `<td><div style="font-size:14px;line-height:20px"><h1 style="font-size:30px">VISIBLEb28 Titel mit geerbter Zeilenhöhe</h1></div></td>` },
  { name: "ordinary 6 · b29 card with fixed height and image + caption", html: `<div style="width:260px;height:220px;background-color:#ffffff;border:1px solid #eee"><img src="${ORDINARY_PNG}" width="260" height="150" style="display:block"><div style="height:70px;padding:8px;font-size:13px">VISIBLEb29 Bildunterschrift kurz</div></div>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 6 · b30 pre code block with fixed width", html: `<pre style="width:300px;background-color:#f4f4f4;padding:8px">VISIBLEb30 const a = 1;\nconsole.log(a);</pre>` },
];

/** The reviewer's ordinary mails of round 7 (2026-11-18, `ordinary7.mjs`): fixed heights, max-heights and tight line heights the shaper could reach. */
const ORDINARY_7: MailCorpusCase[] = [
  { name: "ordinary 7 · o1 card height 120, text fits", html: `<div style="height:120px;width:260px;background-color:#f2f2f2;padding:10px">VISIBLEo1 Kurz und knapp.</div><p>VISIBLEo1b after</p>` },
  { name: "ordinary 7 · o2 card height 40, text overflows (overflow visible)", html: `<div style="height:40px;width:260px;background-color:#f2f2f2">VISIBLEo2 ${ORDINARY_TEXT}</div><p style="background-color:#ffffff">VISIBLEo2b after</p>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 7 · o3 card height 40 overflow hidden, text longer", html: `<div style="height:40px;width:260px;overflow:hidden;background-color:#f2f2f2">VISIBLEo3 ${ORDINARY_TEXT} SECRETo3tail</div><p>VISIBLEo3b</p>`, differs: { body: SHOWS_THE_CUT, "body/0": SHOWS_THE_CUT } },
  { name: "ordinary 7 · o4 button height 36 = line-height", html: `<a href="https://x.example.com/o4" style="display:inline-block;height:36px;line-height:36px;padding:0 18px;background-color:#e4572e;color:#ffffff">VISIBLEo4 Kaufen</a>` },
  { name: "ordinary 7 · o5 button height 36, label wraps on phone", html: `<a href="https://x.example.com/o5" style="display:block;height:36px;line-height:36px;width:180px;background-color:#e4572e;color:#ffffff;text-align:center">VISIBLEo5 Jetzt das Angebot ansehen und sparen</a><p>VISIBLEo5b</p>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 7 · o6 accordion open state max-height 1000", html: `<div style="max-height:1000px;overflow:hidden;background-color:#fafafa">VISIBLEo6 ${ORDINARY_TEXT}</div>` },
  { name: "ordinary 7 · o7 preview box max-height 60 overflow hidden", html: `<div style="max-height:60px;overflow:hidden;line-height:20px">VISIBLEo7 ${ORDINARY_TEXT} ${ORDINARY_TEXT} SECRETo7tail</div><p>VISIBLEo7b</p>` },
  { name: "ordinary 7 · o8 max-height 300 no overflow", html: `<div style="max-height:300px;background-color:#eef">VISIBLEo8 kurzer Text</div>` },
  { name: "ordinary 7 · o9 line-height 0.45 inherited into a paragraph", html: `<div style="font-size:20px;line-height:9px"><p>VISIBLEo9 ${ORDINARY_TEXT}</p></div>` },
  { name: "ordinary 7 · o10 single-line headline line-height 0.4", html: `<h1 style="font-size:40px;line-height:16px;margin:20px 0">VISIBLEo10 Kurz</h1><p>VISIBLEo10b</p>` },
  { name: "ordinary 7 · o11 line-height 0.5 exactly", html: `<p style="font-size:20px;line-height:10px">VISIBLEo11 ${ORDINARY_TEXT}</p>` },
  { name: "ordinary 7 · o12 line-height 0.6 two lines", html: `<p style="font-size:30px;line-height:18px">VISIBLEo12 Zwei Zeilen Schlagzeile mit Text</p>` },
  { name: "ordinary 7 · o13 line-height 0.8 headline", html: `<h2 style="font-size:36px;line-height:0.8;margin:0">VISIBLEo13 Große Überschrift über mehrere Zeilen hinweg</h2>` },
  { name: "ordinary 7 · o14 wrapper line-height 0 with image and text", html: `<div style="line-height:0"><img src="${ORDINARY_PNG}" width="300" height="80"><span style="font-size:14px;line-height:20px">VISIBLEo14 Bildunterschrift</span></div><p>after</p>` },
  { name: "ordinary 7 · o15 wrapper line-height 0px around images, text in a nested div", html: `<div style="line-height:0px"><img src="${ORDINARY_PNG}" width="200" height="60"> <img src="${ORDINARY_PNG}" width="200" height="60"><div style="line-height:20px">VISIBLEo15 Text</div></div>` },
  { name: "ordinary 7 · o16 image-over-text stage fixed height", html: `<div style="height:260px;width:300px;background-color:#123456;color:#ffffff"><img src="${ORDINARY_PNG}" width="300" height="200" style="display:block"><div style="padding:8px">VISIBLEo16 Bühne</div></div><p>VISIBLEo16b</p>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 7 · o17 stage fixed height, caption too long", html: `<div style="height:230px;width:300px;background-color:#123456;color:#ffffff"><img src="${ORDINARY_PNG}" width="300" height="200" style="display:block"><div style="padding:8px">VISIBLEo17 ${ORDINARY_TEXT}</div></div><p style="background-color:#ffffff">VISIBLEo17b</p>`, differs: { body: GROWS_TO_ITS_WORDS, "body/0": GROWS_TO_ITS_WORDS } },
  { name: "ordinary 7 · o18 list items fixed height 20 with 14px text", html: `<ul>${Array.from({ length: 5 }, (_, i) => `<li style="height:20px">VISIBLEo18i${i} Punkt</li>`).join("")}</ul>` },
  { name: "ordinary 7 · o19 inline span line-height 0.3 inside a paragraph", html: `<p style="font-size:14px;line-height:20px">VISIBLEo19 Text <span style="font-size:30px;line-height:8px">GROSS</span> weiter</p>` },
  { name: "ordinary 7 · o20 table-free card grid inline-block height 150", html: `<div>${Array.from({ length: 3 }, (_, i) => `<div style="display:inline-block;width:180px;height:150px;vertical-align:top;margin:4px;background-color:#f6f6f6;padding:8px"><b>VISIBLEo20t${i}</b><br>Kurzer Teaser ${i}</div>`).join("")}</div>` },
];

export const MAIL_CORPUS: MailCorpusCase[] = [
  // Heroes, shadings, glass cards (R1).
  { name: "R1 glass card over a hero picture", html: `<div style="background:url(${REMOTE}/dark.jpg);color:#fff"><p style="background-color:rgba(0,0,0,0.05)">VISIBLEa1 ${LINE}</p></div>`, differs: { "body/0": PICTURE_BOX } },
  { name: "R1 glass card in a picture cell", html: `<table><tr><td background="${REMOTE}/dark.jpg" style="color:#ffffff"><div style="background-color:rgba(255,255,255,0.1);padding:10px">VISIBLEa2</div></td></tr></table>`, differs: { "body/0/0/0/0": GLASS_CELL, "body/0/0/0/0/0": GLASS_CELL } },
  { name: "R1 shading gradient over a hero", html: `<div style="background-image:url(${REMOTE}/hero.jpg);color:#ffffff"><div style="background-image:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,0.1))">VISIBLEa3</div></div>`, differs: { "body/0": PICTURE_BOX } },
  { name: "hero on a dark colour with a shading", html: `<table width="100%" bgcolor="#102030"><tr><td style="padding:32px;color:#ffffff;background-image:linear-gradient(rgba(0,0,0,0.2),rgba(0,0,0,0.4))"><h1 style="margin:0;font-size:28px">VISIBLEh1 Neu im Herbst</h1><p style="background-color:rgba(255,255,255,0.12);padding:12px;border-radius:6px">VISIBLEh2 ${LINE}</p></td></tr></table>` },

  // Pictures (R2).
  { name: "R2 fluid logo with max-width", html: `<table width="600"><tr><td><img src="${GIF}" width="200" style="display:block;width:100%;max-width:200px;height:auto" alt="Logo"></td></tr><tr><td>VISIBLEi1</td></tr></table>` },
  { name: "R2 icon in a link", html: `<table width="600"><tr><td align="center"><a href="https://x.example.com/fb"><img src="${GIF}" style="width:100%;max-width:32px" alt="fb"></a> VISIBLEi2</td></tr></table>` },
  { name: "R2 wide hero picture held to 600", html: `<img src="${GIF}" width="1200" height="600" style="width:100%;max-width:600px;height:auto"><p>VISIBLEi3</p>` },
  { name: "remote logo with size attributes", html: `<table width="600"><tr><td><img src="${REMOTE}/logo.png" width="120" height="40" alt="Shop" style="display:block;border:0"></td><td align="right">VISIBLEi4</td></tr></table>` },
  { name: "icon row", html: `<p><img src="${GIF}" width="24" height="24" style="vertical-align:middle"> <img src="${GIF}" width="24" height="24" style="vertical-align:middle"> VISIBLEi5</p>` },

  // Lines, bars, dots, spacers (R3).
  { name: "R3 dividing line", html: `<p>VISIBLEd1</p><div style="height:1px;background-color:#e0e0e0"></div><p>VISIBLEd2</p>` },
  { name: "R3 colour bar", html: `<div style="height:4px;background-color:#ff6600;max-width:600px;margin:0 auto"></div><p>VISIBLEd3</p>` },
  { name: "R3 status dot", html: `<p><span style="display:inline-block;width:8px;height:8px;background-color:#ff0000;border-radius:50%"></span> VISIBLEd4 Status</p>` },
  { name: "spacer cell with a no-break space", html: `<table width="600"><tr><td height="24" style="font-size:1px;line-height:1px">&nbsp;</td></tr><tr><td bgcolor="#eeeeee" height="2" style="font-size:0;line-height:0">&nbsp;</td></tr><tr><td>VISIBLEd5</td></tr></table>` },
  { name: "hr with a colour", html: `<p>VISIBLEd6</p><hr style="border:0;border-top:1px solid #dddddd;margin:16px 0">` },

  // Buttons.
  { name: "button as a link", html: `<p><a href="https://x.example.com/b" style="background-color:#0066cc;color:#ffffff;padding:12px 24px;display:inline-block;border-radius:4px;text-decoration:none">VISIBLEb1</a></p>` },
  { name: "button as a cell", html: `<table><tr><td bgcolor="#0066cc" style="border-radius:4px;padding:10px 20px"><a href="https://x.example.com/c" style="color:#ffffff;text-decoration:none;font-weight:bold">VISIBLEb2</a></td></tr></table>` },
  { name: "button with a height", html: `<div style="background-color:#222222;color:#ffffff;height:40px;line-height:40px;width:200px;text-align:center">VISIBLEb3</div>` },

  // Footers with inherited colours (R4).
  { name: "R4 footer links inherit in a dark cell", html: `<table bgcolor="#1a1a1a"><tr><td style="color:#ffffff"><span style="color:inherit">VISIBLEf1</span> <a href="https://x.example.com/u" style="color:inherit!important">VISIBLEf2</a></td></tr></table>` },
  { name: "R4 link inherits", html: `<table><tr><td style="background-color:#333333;color:#ffffff"><a href="https://e.example.com/u" style="color:inherit;text-decoration:none">VISIBLEf3</a></td></tr></table>` },
  { name: "R4 currentColor", html: `<div style="background-color:#000;color:#fff"><span style="color:currentColor">VISIBLEf4</span></div>` },
  { name: "R4 var with a fallback", html: `<div style="background-color:#ffffff"><span style="color:var(--c, #333)">VISIBLEf5</span></div>` },
  { name: "R4 inherit in a plain mail", html: `<p>Hallo <a href="https://e.example.com" style="color:inherit">VISIBLEf6</a></p>` },

  // Light on dark, a dark theme.
  { name: "light words on a dark cell", html: `<table width="600"><tr><td bgcolor="#000000"><font color="#ffffff">VISIBLEl1</font></td><td style="background-color:#333;color:#eee">VISIBLEl2</td></tr></table>` },
  { name: "dark theme newsletter", html: `<body bgcolor="#111111"><table width="600" bgcolor="#1a1a1a" style="color:#eeeeee"><tr><td style="padding:20px"><h2 style="color:#ffffff">VISIBLEt1</h2><p>VISIBLEt2 ${LINE}</p><p style="color:#999999;font-size:12px">VISIBLEt3</p></td></tr></table></body>` },

  // Lines and words.
  { name: "Korean kept whole with keep-all", html: `<div style="word-break:keep-all;width:300px">VISIBLEk1 ${"한국어 문장은 띄어쓰기 단위로 줄을 바꿉니다 ".repeat(6)}</div>` },
  { name: "price that keeps its line", html: `<table width="600"><tr><td>VISIBLEn1 Artikel</td><td style="white-space:nowrap" align="right">19,99 €</td></tr></table>` },
  { name: "two columns of 600", html: `<table width="600" cellpadding="0" cellspacing="0"><tr><td width="290" valign="top" style="padding:0 10px 0 0">VISIBLEc1 ${LINE}</td><td width="290" valign="top" style="padding:0 0 0 10px">VISIBLEc2 ${LINE}</td></tr></table>` },
  ...REVIEW_4,
  ...ORDINARY_6,
  ...ORDINARY_7,
];
