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
];
