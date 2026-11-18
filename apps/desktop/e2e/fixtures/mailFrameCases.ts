/**
 * The mails of the review rounds of 2026-11-16 and 2026-11-17 (Fehlerliste
 * 0.9.0 C9/F23) and ordinary newsletter forms, each with the marker words the
 * reader of `main` (f9e91bad8; the cases of review 4 ee8f2a950, 2026-11-17) showed at a phone width
 * (343 px) and a desktop width (760 px), judged in Chromium by
 * `mailFrameJudge.ts`. Frozen: every word `main` showed is one the reader
 * shows now (`mailFrameEquality.spec.ts`). A word marked SECRET may be hidden;
 * a word marked VISIBLE is meant to be read. Every later finding becomes a case
 * here. Generated once; edit by hand only to add a case.
 */
export interface MailFrameCaseEntry {
  name: string;
  html: string;
  /** The marker words the reader of `main` showed, per frame width. */
  mainSeen: Record<"343" | "760", string[]>;
  /** Why an expectation differs from what `main` showed. */
  note?: string;
}

export const MAIL_FRAME_CASES: MailFrameCaseEntry[] = [
 {
  "name": "review 3 · c1 bgcolor on div",
  "html": "<div bgcolor=\"#000000\" style=\"color:#ffffff\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c2 bgcolor on p + font",
  "html": "<p bgcolor=\"black\"><font color=\"white\">SECRET</font></p>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c3 a without href",
  "html": "<p style=\"color:#ffffff\"><a name=\"n\">SECRET</a></p>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c4 a href stripped",
  "html": "<p style=\"color:#ffffff\"><a href=\"javascript:alert(1)\">SECRET</a></p>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c5 display contents bg",
  "html": "<div style=\"display:contents;background-color:#000000;color:#ffffff\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c6 bg box height 0",
  "html": "<div style=\"background-color:#000000;color:#ffffff;height:0\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c7 bg box 16px, 2nd line",
  "html": "<div style=\"background-color:#000000;color:#ffffff;height:16px\">first line<br>SECRET</div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c8 bg box max-width 0",
  "html": "<div style=\"background-color:#000000;color:#ffffff;max-width:0\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c9 bg box line-height 10",
  "html": "<div style=\"background-color:#000000;color:#ffffff;height:14px;line-height:10\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c10 caption outside table bg",
  "html": "<table bgcolor=\"#000000\"><caption style=\"color:#ffffff\">SECRET</caption><tr><td style=\"color:#ffffff\">cell</td></tr></table>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c11 img 2000 pushes cell",
  "html": "<table><tr><td><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" width=\"2000\" height=\"10\" style=\"max-width:none\"></td><td>SECRET</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c12 long token word-break normal",
  "html": "<div style=\"word-break:normal\">AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c13 font 160px word",
  "html": "<div style=\"font-size:160px;word-break:normal\">LONGWORDLONGSECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c14 hidden until-found + display",
  "html": "<div hidden=\"until-found\" style=\"display:block\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c15 visibility collapse row",
  "html": "<table><tr style=\"visibility:collapse\"><td>SECRET</td></tr><tr><td>x</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c16 text-indent -9999",
  "html": "<div style=\"text-indent:-9999px\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c17 line-height 0",
  "html": "<div style=\"line-height:0;font-size:14px\">SECRET</div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c18 height0 overflow hidden",
  "html": "<div style=\"height:0;overflow:hidden\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c19 abs neg offsets",
  "html": "<div style=\"position:absolute;left:-500px;top:-500px\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c20 transform scale0",
  "html": "<div style=\"transform:scale(0)\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c21 mix-blend-mode",
  "html": "<div style=\"background-color:#ffffff\"><span style=\"color:#000000;mix-blend-mode:screen\">SECRET</span></div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c22 clip-path",
  "html": "<div style=\"clip-path:inset(50%)\">SECRET</div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c23 display none !important then block",
  "html": "<div style=\"display:none !important;display:block !important\">SECRET</div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c24 aria-hidden",
  "html": "<div aria-hidden=\"true\">SECRETARIA</div>",
  "mainSeen": {
   "343": [
    "SECRETARIA"
   ],
   "760": [
    "SECRETARIA"
   ]
  }
 },
 {
  "name": "review 3 · c25 title template noscript",
  "html": "<title>SECRET</title><template>SECRET</template><noscript>SECRET</noscript>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c26 mso comment",
  "html": "<!--[if mso]><div>SECRET</div><![endif]--><!--[if !mso]><!--><div>nonmso</div><!--<![endif]-->",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c27 preheader zwnj",
  "html": "<div style=\"display:none;max-height:0;overflow:hidden\">SECRET&zwnj;&nbsp;&zwnj;&nbsp;</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c28 ancestor colour over lost picture",
  "html": "<div style=\"color:#ffffff\"><table background=\"https://x.example.com/dark.jpg\"><tr><td>SECRET</td></tr></table></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c29 near colour f8 on fff",
  "html": "<div style=\"background-color:#ffffff;color:#f4f4f4\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c30 font color on td bgcolor via span bg",
  "html": "<table bgcolor=\"#ffffff\"><tr><td><span style=\"background-color:#000000\"></span><font color=\"#ffffff\">SECRET</font></td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c31 float in h0 bg",
  "html": "<div style=\"background-color:#000000;color:#ffffff;height:0\"><span style=\"float:left\">SECRET</span></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c32 inline-block w0 bg",
  "html": "<span style=\"display:inline-block;width:0;background-color:#000000;color:#ffffff\">SECRET</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c33 link img max-width0 (link list)",
  "html": "<a href=\"https://evil.example.com/z\"><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" style=\"max-width:0\"></a>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c34 color-scheme dark",
  "html": "<div style=\"color-scheme:dark;color:canvastext\">SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c35 tbody bgcolor",
  "html": "<table><tbody bgcolor=\"#000000\"><tr><td style=\"color:#ffffff\">VISIBLE</td></tr></tbody></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · c11b img width 2000 in cell",
  "html": "<table><tr><td><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" width=\"2000\" height=\"10\"></td><td>SECRET</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c11c img min-width 2000",
  "html": "<table><tr><td><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" style=\"min-width:2000px;height:10px\"></td><td>SECRET</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c11d img min-width in div",
  "html": "<div><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" style=\"min-width:2000px;height:10px\"><span>SECRET</span></div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · c38 keep-all CJK",
  "html": "<div style=\"word-break:keep-all\">中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中中SECRET</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · c39 table-caption div in bg table",
  "html": "<table bgcolor=\"#000000\"><tr><td style=\"color:#ffffff\">cell</td></tr></table><div style=\"display:table;background-color:#000000\"><div style=\"display:table-caption;color:#ffffff\">SECRET</div></div>",
  "mainSeen": {
   "343": [
    "SECRET"
   ],
   "760": [
    "SECRET"
   ]
  }
 },
 {
  "name": "review 3 · r1 td background:none in dark table",
  "html": "<table bgcolor=\"#000000\"><tr><td style=\"background:none;color:#ffffff\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r2 td background-image:none",
  "html": "<table bgcolor=\"#000000\"><tr><td style=\"background-image:none;color:#ffffff\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r3 text colour oklch on kept bg",
  "html": "<table><tr><td style=\"background-color:#000000;color:oklch(1 0 0)\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · r4 bg oklch, colour on ancestor",
  "html": "<div style=\"color:#ffffff\"><div style=\"background-color:oklch(0.2 0 0)\">VISIBLE</div></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 3 · r5 bg -webkit-gradient, colour on ancestor",
  "html": "<table style=\"color:#ffffff\"><tr><td style=\"background-image:-webkit-linear-gradient(top,#333333,#000000)\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r6 font color fff no hash",
  "html": "<table bgcolor=\"#ffffff\"><tr><td><font color=\"fff\">VISIBLE</font></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r7 bgcolor eee no hash + white",
  "html": "<table bgcolor=\"eee\"><tr><td style=\"color:#ffffff\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r8 color var() on dark",
  "html": "<td style=\"background-color:#000000;color:var(--light,#ffffff)\">VISIBLE</td>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r9 text-fill-color",
  "html": "<div style=\"background-color:#000000;color:#000000;-webkit-text-fill-color:#ffffff\">VISIBLE</div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r10 bg hwb, colour same el",
  "html": "<div style=\"background-color:hwb(0 0% 100%);color:#ffffff\">VISIBLE</div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r11 body style dark",
  "html": "<body style=\"background-color:#000000;color:#ffffff\"><p>VISIBLE</p></body>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r12 td bg:none, colour on table",
  "html": "<table bgcolor=\"#000000\" style=\"color:#ffffff\"><tr><td style=\"background:none\">VISIBLE</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r13 url style keeps display none",
  "html": "<div style=\"display:none;background-image:url(https://t.example.com/p.gif)\">VISIBLEPRE</div>",
  "mainSeen": {
   "343": [],
   "760": []
  },
  "note": "main showed it only because a style with an address was dropped whole there; it says display:none, and the branch hides it rightly"
 },
 {
  "name": "review 3 · r14 color initial on dark",
  "html": "<div style=\"background-color:#ffffff\"><div style=\"color:#ffffff\"><span style=\"color:initial\">VISIBLE</span></div></div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r15 rgb with 4 commas",
  "html": "<div style=\"background-color:#000000;color:rgb(255,255,255,0.9)\">VISIBLE</div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r16 hsl with deg commas",
  "html": "<div style=\"background-color:hsl(210deg, 50%, 10%);color:#ffffff\">VISIBLE</div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r17 hex upper important",
  "html": "<div style=\"BACKGROUND-COLOR:#000000 !IMPORTANT;COLOR:#FFFFFF !IMPORTANT\">VISIBLE</div>",
  "mainSeen": {
   "343": [
    "VISIBLE"
   ],
   "760": [
    "VISIBLE"
   ]
  }
 },
 {
  "name": "review 3 · r18 button link background:none",
  "html": "<table><tr><td bgcolor=\"#0066cc\" style=\"padding:12px\"><a href=\"https://shop.example.com/\" style=\"color:#ffffff;background:none;text-decoration:none\">VISIBLEBUTTON</a></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEBUTTON"
   ],
   "760": [
    "VISIBLEBUTTON"
   ]
  }
 },
 {
  "name": "review 2 · font shorthand 0/0",
  "html": "<span style=\"font:0/0 a\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · css escape display",
  "html": "<div style=\"display:n\\one\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · css escape hex",
  "html": "<div style=\"display:\\6e one\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · opacity -1",
  "html": "<div style=\"opacity:-1\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · opacity calc(0)",
  "html": "<div style=\"opacity:calc(0)\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · opacity 0.001",
  "html": "<div style=\"opacity:0.001\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · overflow scroll h0",
  "html": "<div style=\"height:0;overflow:scroll\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · overflow hidden hidden",
  "html": "<div style=\"height:0;overflow:hidden hidden\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · position offscreen",
  "html": "<div style=\"position:absolute;left:-9999px\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · text-indent -9999",
  "html": "<div style=\"text-indent:-9999px;overflow:hidden;white-space:nowrap\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · clip rect",
  "html": "<div style=\"position:absolute;clip:rect(0 0 0 0)\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · clip-path",
  "html": "<div style=\"clip-path:inset(50%)\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · transform scale0",
  "html": "<div style=\"transform:scale(0)\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · color transparent",
  "html": "<span style=\"color:transparent\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font-size 0.01em",
  "html": "<span style=\"font-size:0.01em\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font-size 1%",
  "html": "<span style=\"font-size:1%\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · content-visibility",
  "html": "<div style=\"content-visibility:hidden\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · display none",
  "html": "<div style=\"display:none\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · display none !important",
  "html": "<div style=\"display:none !important\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · display NONE upper",
  "html": "<div style=\"DISPLAY:NONE\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · display none, later block",
  "html": "<div style=\"display:none;display:block\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · display none!important, later block",
  "html": "<div style=\"display:none!important;display:block\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · comment in value",
  "html": "<div style=\"display:/**/none\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · style block class",
  "html": "<style>.x{display:none}</style><div class=\"x\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · style block media",
  "html": "<style>@media screen{.x{display:none}}</style><div class=\"x\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · visibility collapse",
  "html": "<div style=\"visibility:collapse\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · visibility hidden, child visible",
  "html": "<div style=\"visibility:hidden\"><span style=\"visibility:visible\">SECRETWORD</span></div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · hidden attr",
  "html": "<div hidden>SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · hidden attr + display block",
  "html": "<div hidden style=\"display:block\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · hidden=until-found + display block",
  "html": "<div hidden=\"until-found\" style=\"display:block\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · aria-hidden",
  "html": "<div aria-hidden=\"true\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · w0 h0 overflow hidden",
  "html": "<div style=\"width:0;height:0;overflow:hidden\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · max-height 0 overflow hidden",
  "html": "<div style=\"max-height:0;overflow:hidden\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · color = background",
  "html": "<div style=\"background:#ffffff\"><span style=\"color:#ffffff\">SECRETWORD</span></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font color white on bgcolor white",
  "html": "<table bgcolor=\"#ffffff\"><tr><td><font color=\"#ffffff\">SECRETWORD</font></td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · color: canvas",
  "html": "<span style=\"color:canvas\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · color rgba alpha 0",
  "html": "<span style=\"color:rgba(0,0,0,0)\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font-size 0",
  "html": "<span style=\"font-size:0\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font-size 1px",
  "html": "<span style=\"font-size:1px\">SECRETWORD</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font-size 0 parent, 14px child",
  "html": "<div style=\"font-size:0\"><span style=\"font-size:14px\">SECRETWORD</span></div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · line-height 0",
  "html": "<div style=\"line-height:0\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · nested small x8",
  "html": "<small><small><small><small><small><small><small><small>SECRETWORD</small></small></small></small></small></small></small></small>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · nested sub x8",
  "html": "<sub><sub><sub><sub><sub><sub><sub><sub>SECRETWORD</sub></sub></sub></sub></sub></sub></sub></sub>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · font size=1 + 35%",
  "html": "<font size=\"1\"><span style=\"font-size:35%\">SECRETWORD</span></font>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · margin-left 500% nowrap",
  "html": "<div style=\"margin-left:500%;white-space:nowrap\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · nested margins 3x2000px",
  "html": "<div style=\"margin-left:2000px\"><div style=\"margin-left:2000px\"><div style=\"margin-left:2000px;white-space:nowrap\">SECRETWORD</div></div></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · td width 2000 pushes cell",
  "html": "<table><tr><td style=\"width:2000px\">&nbsp;</td><td style=\"white-space:nowrap\">SECRETWORD</td></tr></table>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · col visibility collapse",
  "html": "<table><colgroup><col style=\"visibility:collapse\"><col></colgroup><tr><td>SECRETWORD</td><td>other</td></tr></table>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · details closed",
  "html": "<details><summary>Sum</summary>SECRETWORD</details>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · details open",
  "html": "<details open><summary>Sum</summary>SECRETWORD</details>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · dialog closed",
  "html": "<dialog>SECRETWORD</dialog>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · popover",
  "html": "<div popover>SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · comment",
  "html": "<!-- SECRETWORD -->",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · conditional mso",
  "html": "<!--[if mso]><p>SECRETWORD</p><![endif]-->",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · template",
  "html": "<template><p>SECRETWORD</p></template>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · noscript",
  "html": "<noscript><p>SECRETWORD</p></noscript>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · canvas fallback",
  "html": "<canvas>SECRETWORD</canvas>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · video fallback",
  "html": "<video>SECRETWORD</video>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · title",
  "html": "<title>SECRETWORD</title>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · svg text",
  "html": "<svg><text>SECRETWORD</text></svg>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · img alt (src blocked)",
  "html": "<img src=\"https://x.example.com/a.png\" alt=\"SECRETWORD\">",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · img alt data src",
  "html": "<img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" alt=\"SECRETWORD\">",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · img title",
  "html": "<img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" title=\"SECRETWORD\">",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · mso-hide all",
  "html": "<div style=\"mso-hide:all\">SECRETWORD</div>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · zero width chars",
  "html": "<p>S​E​C</p><p>SECRETWORD</p>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · css content",
  "html": "<style>p::after{content:\"SECRETWORD\"}</style><p>x</p>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · rp",
  "html": "<ruby>a<rp>SECRETWORD</rp><rt>b</rt></ruby>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · meter",
  "html": "<meter>SECRETWORD</meter>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · textarea",
  "html": "<textarea>SECRETWORD</textarea>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · option outside select",
  "html": "<option>SECRETWORD</option>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · object fallback",
  "html": "<object>SECRETWORD</object>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · frameset/noframes",
  "html": "<noframes>SECRETWORD</noframes>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · marquee",
  "html": "<marquee>SECRETWORD</marquee>",
  "mainSeen": {
   "343": [
    "SECRETWORD"
   ],
   "760": [
    "SECRETWORD"
   ]
  }
 },
 {
  "name": "review 2 · preheader litmus",
  "html": "<div style=\"display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · preheader max-height only",
  "html": "<div style=\"max-height:0;overflow:hidden;mso-hide:all\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · opacity 0.09",
  "html": "<div style=\"opacity:0.09\">SECRETWORD</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 · opacity .5 nested x4",
  "html": "<div style=\"opacity:.5\"><div style=\"opacity:.5\"><div style=\"opacity:.5\"><div style=\"opacity:.5\">SECRETWORD</div></div></div></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 newsletter · light rgba text on dark bg",
  "html": "<table><tr><td style=\"background-color:#111111\"><p style=\"color:rgba(255,255,255,0.85)\">VISIBLEREAL</p></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · light rgb(/) text on dark bg",
  "html": "<div style=\"background-color:#000\"><span style=\"color:rgb(255 255 255 / 90%)\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · 8-digit hex text on dark",
  "html": "<div style=\"background-color:#0b1f33\"><span style=\"color:#ffffffe6\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · white text, gradient bg",
  "html": "<div style=\"background:linear-gradient(#000,#333);color:#ffffff\">VISIBLEREAL</div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · white text, bg shorthand 2 tokens",
  "html": "<div style=\"background:#000000 none;color:#fff\">VISIBLEREAL</div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · white text, bgcolor attr",
  "html": "<table bgcolor=\"#000000\"><tr><td style=\"color:#fff\">VISIBLEREAL</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + font shorthand child",
  "html": "<table><tr><td style=\"font-size:0\"><div style=\"display:inline-block;font:16px/22px Arial,sans-serif\">VISIBLEREAL</div></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + calc child",
  "html": "<div style=\"font-size:0\"><span style=\"display:inline-block;font-size:calc(14px + 0.2vw)\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + clamp child",
  "html": "<div style=\"font-size:0\"><span style=\"font-size:clamp(14px,2vw,18px)\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + 14PX upper",
  "html": "<div style=\"font-size:0\"><span style=\"font-size:14PX\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + ex child",
  "html": "<div style=\"font-size:0\"><span style=\"font-size:2ex\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 2 newsletter · font-size 0 wrapper + 16px!important",
  "html": "<div style=\"font-size:0\"><span style=\"font-size:16px!important\">VISIBLEREAL</span></div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · display -webkit-box with hidden",
  "html": "<div hidden style=\"display:-webkit-box\">VISIBLEREAL</div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "review 2 newsletter · mobile-only block h0 overflow",
  "html": "<div class=\"m\" style=\"display:block;max-height:0;overflow:hidden\">SECRETMOBILE</div><div>VISIBLEREAL</div>",
  "mainSeen": {
   "343": [
    "VISIBLEREAL"
   ],
   "760": [
    "VISIBLEREAL"
   ]
  }
 },
 {
  "name": "newsletter · darkAlpha",
  "html": "<table width=\"100%\" bgcolor=\"#0b1f33\"><tr><td style=\"background-color:#0b1f33;padding:24px\"><h1 style=\"color:#ffffff;font:bold 28px/34px Georgia,serif\">VISIBLEDarkTitle</h1><p style=\"color:rgba(255,255,255,0.85);font-size:16px\">VISIBLEDarkAlpha</p><p style=\"color:rgb(255 255 255 / 70%)\">VISIBLEDarkSlash</p><p style=\"color:#ffffffcc\">VISIBLEDarkHex8</p><p style=\"color:hsla(0,0%,100%,.6)\">VISIBLEDarkHsla</p></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEDarkAlpha",
    "VISIBLEDarkHex8",
    "VISIBLEDarkHsla",
    "VISIBLEDarkSlash",
    "VISIBLEDarkTitle"
   ],
   "760": [
    "VISIBLEDarkAlpha",
    "VISIBLEDarkHex8",
    "VISIBLEDarkHsla",
    "VISIBLEDarkSlash",
    "VISIBLEDarkTitle"
   ]
  }
 },
 {
  "name": "newsletter · gradientHero",
  "html": "<div style=\"background:linear-gradient(135deg,#1e3c72 0%,#2a5298 100%);padding:40px;color:#ffffff;text-align:center\"><h1 style=\"margin:0;font-size:32px\">VISIBLEGradTitle</h1><p style=\"color:rgba(255,255,255,.9)\">VISIBLEGradText</p></div>",
  "mainSeen": {
   "343": [
    "VISIBLEGradText",
    "VISIBLEGradTitle"
   ],
   "760": [
    "VISIBLEGradText",
    "VISIBLEGradTitle"
   ]
  }
 },
 {
  "name": "newsletter · heroImageFallback",
  "html": "<table width=\"100%\"><tr><td background=\"https://cdn.example.com/hero.jpg\" bgcolor=\"#333333\" style=\"background:#333333 url(https://cdn.example.com/hero.jpg) center/cover no-repeat;padding:60px 30px\"><p style=\"color:#ffffff;font-size:22px\">VISIBLEHeroFallback</p></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEHeroFallback"
   ],
   "760": [
    "VISIBLEHeroFallback"
   ]
  }
 },
 {
  "name": "newsletter · heroImageOnly",
  "html": "<table width=\"100%\"><tr><td style=\"background-image:url(https://cdn.example.com/hero.jpg);background-size:cover;padding:60px 30px\"><p style=\"color:#ffffff;font-size:22px\">VISIBLEHeroOnly</p><font color=\"#ffffff\">VISIBLEHeroFont</font></td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · mjmlColumns",
  "html": "<div style=\"margin:0px auto;max-width:600px\"><table align=\"center\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\" style=\"width:100%\"><tbody><tr><td style=\"direction:ltr;font-size:0px;padding:20px 0;text-align:center\"><div class=\"mj-column-per-50\" style=\"font-size:0px;text-align:left;direction:ltr;display:inline-block;vertical-align:top;width:100%\"><table border=\"0\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\" style=\"vertical-align:top\" width=\"100%\"><tr><td align=\"left\" style=\"font-size:0px;padding:10px 25px;word-break:break-word\"><div style=\"font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:13px;line-height:1;text-align:left;color:#000000\">VISIBLEMjmlLeft</div></td></tr></table></div><div class=\"mj-column-per-50\" style=\"font-size:0px;display:inline-block;width:100%\"><div style=\"font:16px/22px Arial,sans-serif;color:#333\">VISIBLEMjmlShorthand</div><div style=\"font-size:calc(14px + 0.2vw)\">VISIBLEMjmlCalc</div><div style=\"font-size:clamp(14px,2vw,18px)\">VISIBLEMjmlClamp</div><div style=\"font-size:max(13px, 1em)\">VISIBLEMjmlMax</div></div></td></tr></tbody></table></div>",
  "mainSeen": {
   "343": [
    "VISIBLEMjmlCalc",
    "VISIBLEMjmlClamp",
    "VISIBLEMjmlLeft",
    "VISIBLEMjmlMax",
    "VISIBLEMjmlShorthand"
   ],
   "760": [
    "VISIBLEMjmlCalc",
    "VISIBLEMjmlClamp",
    "VISIBLEMjmlLeft",
    "VISIBLEMjmlMax",
    "VISIBLEMjmlShorthand"
   ]
  }
 },
 {
  "name": "newsletter · productGrid",
  "html": "<table width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 auto\"><tr><td width=\"200\" style=\"padding:10px\"><img src=\"https://cdn.example.com/p1.jpg\" width=\"180\"><p>VISIBLEGrid1</p></td><td width=\"200\" style=\"padding:10px\"><img src=\"https://cdn.example.com/p2.jpg\" width=\"180\"><p>VISIBLEGrid2</p></td><td width=\"200\" style=\"padding:10px\"><img src=\"https://cdn.example.com/p3.jpg\" width=\"180\"><p>VISIBLEGrid3</p></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEGrid1",
    "VISIBLEGrid2",
    "VISIBLEGrid3"
   ],
   "760": [
    "VISIBLEGrid1",
    "VISIBLEGrid2",
    "VISIBLEGrid3"
   ]
  }
 },
 {
  "name": "newsletter · wideTable",
  "html": "<table width=\"700\" style=\"width:700px;margin:0 auto\"><tr><td style=\"padding:0 40px\"><p style=\"font-size:16px\">VISIBLEWide700</p></td></tr></table><table width=\"800\"><tr><td width=\"400\">VISIBLEWide800a</td><td width=\"400\">VISIBLEWide800b</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEWide700",
    "VISIBLEWide800a",
    "VISIBLEWide800b"
   ],
   "760": [
    "VISIBLEWide700",
    "VISIBLEWide800a",
    "VISIBLEWide800b"
   ]
  }
 },
 {
  "name": "newsletter · buttonsNowrap",
  "html": "<table style=\"margin:0 auto\"><tr><td style=\"border-radius:3px;background:#e91e63;text-align:center\"><a href=\"https://example.com/x\" style=\"display:inline-block;padding:12px 24px;color:#ffffff;white-space:nowrap;font-size:16px;text-decoration:none;letter-spacing:1px\">VISIBLEButtonText &rarr;</a></td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEButtonText"
   ],
   "760": [
    "VISIBLEButtonText"
   ]
  }
 },
 {
  "name": "newsletter · replyChain",
  "html": "<div>VISIBLEReplyTop</div><blockquote style=\"margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex\"><div>VISIBLEQuote1</div><blockquote style=\"margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex\"><div>VISIBLEQuote2</div><blockquote type=\"cite\"><div>VISIBLEQuote3</div></blockquote></blockquote></blockquote>",
  "mainSeen": {
   "343": [
    "VISIBLEQuote1",
    "VISIBLEQuote2",
    "VISIBLEQuote3",
    "VISIBLEReplyTop"
   ],
   "760": [
    "VISIBLEQuote1",
    "VISIBLEQuote2",
    "VISIBLEQuote3",
    "VISIBLEReplyTop"
   ]
  }
 },
 {
  "name": "newsletter · footerGrey",
  "html": "<p style=\"font-size:11px;color:#999999;line-height:16px\">VISIBLEFooterGrey</p><p style=\"font-size:10px;color:#b3b3b3\">VISIBLEFooterLight</p><p style=\"font-size:12px;color:#cccccc\">VISIBLEFooterCCC</p><table bgcolor=\"#f4f4f4\"><tr><td style=\"color:#888888;font-size:12px\">VISIBLEFooterOnGrey</td></tr></table>",
  "mainSeen": {
   "343": [
    "VISIBLEFooterCCC",
    "VISIBLEFooterGrey",
    "VISIBLEFooterLight",
    "VISIBLEFooterOnGrey"
   ],
   "760": [
    "VISIBLEFooterCCC",
    "VISIBLEFooterGrey",
    "VISIBLEFooterLight",
    "VISIBLEFooterOnGrey"
   ]
  }
 },
 {
  "name": "newsletter · codeBlock",
  "html": "<pre style=\"background:#f6f8fa;padding:16px;font-size:12px;line-height:1.45;overflow:auto\">VISIBLECodeLine const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour);</pre><code>VISIBLEInlineCode</code>",
  "mainSeen": {
   "343": [
    "VISIBLECodeLine",
    "VISIBLEInlineCode"
   ],
   "760": [
    "VISIBLECodeLine",
    "VISIBLEInlineCode"
   ]
  }
 },
 {
  "name": "newsletter · smallPrint",
  "html": "<p><small>VISIBLESmall1</small> <small><small>VISIBLESmall2</small></small> <sub>VISIBLESub1</sub> <sup>VISIBLESup1</sup> <font size=\"1\">VISIBLEFontSize1</font> <font size=\"2\">VISIBLEFontSize2</font></p>",
  "mainSeen": {
   "343": [
    "VISIBLEFontSize1",
    "VISIBLEFontSize2",
    "VISIBLESmall1",
    "VISIBLESmall2",
    "VISIBLESub1",
    "VISIBLESup1"
   ],
   "760": [
    "VISIBLEFontSize1",
    "VISIBLEFontSize2",
    "VISIBLESmall1",
    "VISIBLESmall2",
    "VISIBLESub1",
    "VISIBLESup1"
   ]
  }
 },
 {
  "name": "newsletter · mobileOnly",
  "html": "<div class=\"mobile-only\" style=\"display:none;max-height:0;overflow:hidden;mso-hide:all\">VISIBLEMobileHidden</div><div class=\"mobile-only\" style=\"max-height:0;overflow:hidden\">VISIBLEMobileClip</div><p>VISIBLEAfterMobile</p>",
  "mainSeen": {
   "343": [
    "VISIBLEAfterMobile"
   ],
   "760": [
    "VISIBLEAfterMobile"
   ]
  }
 },
 {
  "name": "newsletter · markAndLinks",
  "html": "<div style=\"background:#000;color:#fff;padding:10px\">VISIBLEOnBlack <a href=\"https://example.com/a\">VISIBLELinkOnBlack</a> <mark>VISIBLEMarked</mark></div>",
  "mainSeen": {
   "343": [
    "VISIBLELinkOnBlack",
    "VISIBLEMarked",
    "VISIBLEOnBlack"
   ],
   "760": [
    "VISIBLELinkOnBlack",
    "VISIBLEMarked",
    "VISIBLEOnBlack"
   ]
  }
 },
 {
  "name": "newsletter · transparentBg",
  "html": "<table style=\"background-color:rgba(0,0,0,0.05)\"><tr><td style=\"color:#333\">VISIBLETintedCell</td></tr></table><div style=\"background:transparent;color:#444\">VISIBLETransparentBg</div>",
  "mainSeen": {
   "343": [
    "VISIBLETintedCell",
    "VISIBLETransparentBg"
   ],
   "760": [
    "VISIBLETintedCell",
    "VISIBLETransparentBg"
   ]
  }
 },
 {
  "name": "newsletter · bodyBg",
  "html": "<html><body style=\"background:#111;color:#eee\" bgcolor=\"#111111\" text=\"#eeeeee\"><p style=\"color:#eeeeee\">VISIBLEBodyDark</p><p>VISIBLEBodyDefault</p></body></html>",
  "mainSeen": {
   "343": [
    "VISIBLEBodyDefault"
   ],
   "760": [
    "VISIBLEBodyDefault"
   ]
  }
 },
 {
  "name": "newsletter · letterSpacing",
  "html": "<h2 style=\"letter-spacing:4px;text-transform:uppercase;font-size:14px;color:#666\">VISIBLESpaced</h2><p style=\"word-spacing:2px;text-indent:20px\">VISIBLEIndented</p>",
  "mainSeen": {
   "343": [
    "VISIBLEIndented",
    "VISIBLESpaced"
   ],
   "760": [
    "VISIBLEIndented",
    "VISIBLESpaced"
   ]
  }
 },
 {
  "name": "newsletter · longUrl",
  "html": "<p style=\"font-size:13px\">VISIBLEUrlLead https://example.com/a/very/long/path/that/never/breaks/with/a/query?utm_source=newsletter&utm_medium=email&utm_campaign=autumn-sale-2026-with-a-long-name VISIBLEUrlTail</p>",
  "mainSeen": {
   "343": [
    "VISIBLEUrlLead",
    "VISIBLEUrlTail"
   ],
   "760": [
    "VISIBLEUrlLead",
    "VISIBLEUrlTail"
   ]
  }
 },
 {
  "name": "newsletter · mailchimp",
  "html": "<span class=\"mcnPreviewText\" style=\"display:none !important;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;\">Preview words here</span>\n<center><table align=\"center\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" height=\"100%\" width=\"100%\" id=\"bodyTable\" style=\"border-collapse:collapse;height:100%;margin:0;padding:0;width:100%;background-color:#FAFAFA;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%\">\n<tr><td align=\"center\" valign=\"top\" id=\"bodyCell\" style=\"height:100%;margin:0;padding:10px;width:100%;border-top:0;mso-line-height-rule:exactly\">\n<table border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" class=\"templateContainer\" style=\"border-collapse:collapse;border:0;max-width:600px !important\">\n<tr><td valign=\"top\" class=\"mcnTextContent\" style=\"padding-top:9px;padding-right:18px;padding-bottom:9px;padding-left:18px;word-break:break-word;color:#202020;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%\">\n<h1 style=\"display:block;margin:0;padding:0;color:#202020;font-family:Helvetica;font-size:26px;font-style:normal;font-weight:bold;line-height:125%;letter-spacing:normal;text-align:left\">Our September news</h1>\n<p style=\"margin:10px 0;padding:0;mso-line-height-rule:exactly;color:#202020;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left\">Hello, this is the body.</p>\n<img align=\"center\" alt=\"\" src=\"https://cdn.example.com/a.png\" width=\"564\" style=\"max-width:1200px;padding-bottom:0;display:inline !important;vertical-align:bottom;border:0;height:auto;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic\" class=\"mcnImage\">\n<a href=\"https://example.com\" style=\"mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;color:#007C89;font-weight:normal;text-decoration:underline\">Read more</a>\n</td></tr></table></td></tr></table></center>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · litmusPreheader",
  "html": "<div style=\"display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;font-family:sans-serif;\">Hidden preheader text&zwnj;&nbsp;&zwnj;&nbsp;</div>\n<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" width=\"100%\" style=\"margin:auto;max-width:600px\">\n<tr><td style=\"background-color:#ffffff;padding:20px;font-family:sans-serif;font-size:15px;line-height:20px;color:#555555;\">\n<h1 style=\"margin:0 0 10px 0;font-family:sans-serif;font-size:25px;line-height:30px;color:#333333;font-weight:normal;\">Praesent laoreet</h1>\n<p style=\"margin:0;\">Maecenas sed ante pellentesque.</p>\n<table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" border=\"0\" style=\"margin:auto\"><tr><td class=\"button-td button-td-primary\" style=\"border-radius:4px;background:#222222;\">\n<a class=\"button-a button-a-primary\" href=\"https://example.com/\" style=\"background:#222222;border:1px solid #000000;font-family:sans-serif;font-size:15px;line-height:15px;text-decoration:none;padding:13px 17px;color:#ffffff;display:block;border-radius:4px;\">Primary Button</a></td></tr></table>\n</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · campaignMonitor",
  "html": "<div style=\"font-size:0px;color:transparent;line-height:0px;max-height:0;overflow:hidden\">CM preheader</div>\n<table style=\"border-collapse:collapse;table-layout:fixed;Margin-left:auto;Margin-right:auto;overflow-wrap:break-word;word-wrap:break-word;word-break:break-word;background-color:#fff\" align=\"center\"><tr>\n<td style=\"padding:0;vertical-align:top;font-family:sans-serif;font-size:14px;line-height:21px;color:#565656\">\n<div style=\"Margin-left:20px;Margin-right:20px;Margin-top:24px\"><div style=\"mso-line-height-rule:exactly;line-height:20px;font-size:1px\">&nbsp;</div></div>\n<div style=\"Margin-left:20px;Margin-right:20px\"><p style=\"Margin-top:0;Margin-bottom:20px\">Campaign body text.</p></div>\n</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · outlook",
  "html": "<div class=\"WordSection1\"><p class=\"MsoNormal\"><span style=\"font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif;color:#1F497D;mso-fareast-language:EN-US\">Hi Anna,<o:p></o:p></span></p>\n<p class=\"MsoNormal\" style=\"margin:0cm;margin-bottom:.0001pt\"><span style=\"font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif\">Thanks for the update.<o:p></o:p></span></p>\n<div style=\"border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm\"><p class=\"MsoNormal\"><b><span lang=\"DE\" style=\"font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif\">Von:</span></b><span lang=\"DE\" style=\"font-size:11.0pt;font-family:&quot;Calibri&quot;,sans-serif\"> Ben<o:p></o:p></span></p></div>\n<p class=\"MsoNormal\" style=\"text-autospace:none;tab-stops:36.0pt\"><span style=\"font-size:10.0pt;font-family:&quot;Arial&quot;,sans-serif;color:black;background:white\">Footer</span></p></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · gmail",
  "html": "<div dir=\"ltr\"><div>Hi,</div><div><br></div><div>see below.</div><div><font face=\"arial, sans-serif\" color=\"#000000\">Coloured</font></div><br><div class=\"gmail_quote\"><div dir=\"ltr\" class=\"gmail_attr\">On Mon, Anna wrote:<br></div><blockquote class=\"gmail_quote\" style=\"margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex\">Earlier words</blockquote></div></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · appleMail",
  "html": "<html><body style=\"word-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;\"><div style=\"font-family: -apple-system, Helvetica Neue;\">Sent from my Mac</div><div><br><blockquote type=\"cite\"><div style=\"font-family: Helvetica; font-size: 12px; font-style: normal; font-variant-caps: normal; font-weight: normal; letter-spacing: normal; text-align: start; text-indent: 0px; text-transform: none; white-space: normal; word-spacing: 0px; -webkit-text-stroke-width: 0px; text-decoration: none;\">Quoted</div></blockquote></div></body></html>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · transactional",
  "html": "<table width=\"100%\" style=\"font: 15px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; color:#32325d\"><tr><td>\n<div style=\"border-radius:8px;overflow:hidden;width:48px;height:48px\"><img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" width=\"48\" height=\"48\" style=\"display:block;border:0\"></div>\n<h2 style=\"font-size:20px;letter-spacing:-0.5px;margin:16px 0 8px\">Receipt from Shop</h2>\n<p style=\"position:relative;margin:0\">Amount paid <strong>€20.00</strong></p>\n<p style=\"text-overflow:ellipsis;white-space:nowrap;overflow:hidden;max-width:300px\">A very long description of the item that would be cut</p>\n<td style=\"width:50%;padding:0 8px;vertical-align:top;margin:0 -8px\">Column</td>\n<a href=\"https://example.com/r\" style=\"display:inline-block;padding:12px 24px;background-color:#635bff;color:#fff;border-radius:6px;text-decoration:none;font-weight:600\">View receipt</a>\n</td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · github",
  "html": "<p style=\"font-size:small;-webkit-text-size-adjust:none;color:#666;\">—<br>Reply to this email directly, <a href=\"https://github.com/x\">view it on GitHub</a>.<span style=\"color: transparent; font-size: 0; display: none; visibility: hidden; overflow: hidden; opacity: 0; width: 0; height: 0; max-width: 0; max-height: 0; mso-hide: all\">You are receiving this because you were mentioned.</span></p>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "newsletter · hubspot",
  "html": "<div style=\"display:none!important\" class=\"hidden-preheader\">HubSpot preview</div><table cellpadding=\"0\" cellspacing=\"0\" style=\"font-family:Arial, sans-serif;font-size:15px;color:#23496d;word-break:break-word;direction:ltr\"><tr><td style=\"padding:10px 20px;text-align:center;-ms-text-size-adjust:100%\"><p style=\"margin:0;mso-line-height-alt:24px;line-height:1.75\">Body text</p><div style=\"height:0;overflow:hidden;font-size:0;line-height:0\">mobile only</div></td></tr></table>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 4 · p24 bgcolor div with font white",
  "html": "<div bgcolor=\"#000000\"><font color=\"#ffffff\">SECRET24</font></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 4 · p25 height fixed bg box two lines",
  "html": "<div style=\"background-color:#000;color:#fff;height:16px\">line1<br>SECRET25</div>",
  "mainSeen": {
   "343": [
    "SECRET25"
   ],
   "760": [
    "SECRET25"
   ]
  }
 },
 {
  "name": "review 4 · p35 r13 display none bg url",
  "html": "<div style=\"display:none;background-image:url(https://t.example.com/p.gif)\">SECRETPRE</div><p>VISIBLEp35</p>",
  "mainSeen": {
   "343": [
    "VISIBLEp35"
   ],
   "760": [
    "VISIBLEp35"
   ]
  },
  "note": "main shows SECRETPRE because it drops the whole style of a box that names a picture, display:none with it; the reader keeps display:none (r13, agreed 2026-11-17 as no regression)."
 },
 {
  "name": "review 4 · p36 hidden div with display:contents",
  "html": "<div hidden style=\"display:contents\">SECRET36</div>",
  "mainSeen": {
   "343": [
    "SECRET36"
   ],
   "760": [
    "SECRET36"
   ]
  }
 },
 {
  "name": "review 4 · p37 -webkit-box line clamp hidden",
  "html": "<div style=\"display:-webkit-box;overflow:hidden;height:0\">SECRET37</div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 4 · p38 float in bg h0",
  "html": "<div style=\"background-color:#000;color:#fff;height:0\"><span style=\"float:left\">SECRET38</span></div>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 4 · p39 inline-block h0 overflow hidden bg",
  "html": "<span style=\"display:inline-block;height:0;overflow:hidden;background-color:#000;color:#fff\">SECRET39</span>",
  "mainSeen": {
   "343": [],
   "760": []
  }
 },
 {
  "name": "review 4 · p40 max-height 0 overflow hidden bg",
  "html": "<div style=\"max-height:0;overflow:hidden;background-color:#fff;color:#000\">SECRET40</div>",
  "mainSeen": {
   "343": [],
   "760": []
  },
  "note": "A painted block folded away on purpose (max-height:0;overflow:hidden) opens for the reader and the assistant alike: when in doubt, visible to both (agreed 2026-11-17)."
 }
];
