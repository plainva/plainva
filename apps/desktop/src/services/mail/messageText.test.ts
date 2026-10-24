// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The text of a message that has no plain-text part (finding 2026-10-09).
 *
 * A reply's quote, a forward, the reply note and the filed note each read
 * `message.text` on their own. Two backends never fill it for an HTML mail:
 * Microsoft Graph hands a body over as HTML unless the request asks for text
 * (`Prefer: outlook.body-content-type="text"`, which Plainva does not send, so
 * that is every message of a Microsoft mailbox), and the phone's MIME parser
 * takes a `text/plain` part or nothing. The reply quoted nothing, the forward
 * carried its header block alone, and the filed note was properties and a
 * heading.
 *
 * What is held here: ONE place says what the text of a message is
 * (`mailMessageText`), each of the four reads it, and it holds for a message as
 * each backend delivers it.
 */

vi.mock("@plainva/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/core")>();
  return {
    ...actual,
    refreshOneDriveAccessToken: vi.fn(async () => ({ accessToken: "ACCESS", expiresIn: 3600 })),
    // The real one, watched: a test below asks which parser read a message.
    htmlToVisibleText: vi.fn(actual.htmlToVisibleText),
  };
});

import { htmlToVisibleText, readFrontmatterPath } from "@plainva/core";
import { setPlatformServices } from "@plainva/ui";
import {
  buildEmailNoteContent,
  buildForwardBody,
  buildReplyBody,
  buildReplyNoteContent,
  captureMailAsNote,
  fetchMessage,
  forgetGraphMailRuntime,
  mailMessageText,
  mailSecretKey,
  parseMessage,
  quotedOriginalStart,
  sanitizeEmailHtml,
  setMailPlatform,
  FORWARD_SEPARATOR,
  type MailAccountConfig,
  type MailCaptureAdapter,
  type MailMessage,
  type MailTransport,
} from "@plainva/ui/mail";

/** What a sender hides above the message so that a mail list shows it as the preview. */
const PREHEADER = "Nur heute: 50 % Rabatt";
const HTML =
  `<html><head><title>Rechnung</title><style>p { margin: 0 }</style></head><body>` +
  `<div style="display:none;max-height:0;overflow:hidden">${PREHEADER}</div>` +
  `<p>Hallo Marco,</p><p>anbei die <b>Rechnung</b> f&uuml;r Oktober.</p>` +
  `<img src="https://tracker.example.org/pixel.gif" width="1" height="1">` +
  `</body></html>`;
const TEXT = "Hallo Marco,\n\nanbei die Rechnung für Oktober.";

function htmlOnly(partial: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "AAMk-html-1",
    subject: "Rechnung Oktober",
    from: "Anna Beispiel <anna@example.org>",
    to: "marco@example.org",
    dateTs: new Date(2026, 9, 9, 9, 30).getTime(),
    text: null,
    html: HTML,
    attachments: [],
    ...partial,
  };
}

describe("mailMessageText", () => {
  it("is the plain-text part where the message has one", () => {
    expect(mailMessageText({ text: "Der Text des Absenders.", html: "<p>Etwas anderes</p>" })).toBe("Der Text des Absenders.");
  });

  it("is the text of the HTML part, as the reader shows it, where there is no plain-text part", () => {
    expect(mailMessageText({ text: null, html: HTML })).toBe(TEXT);
    // A part of nothing but blanks is no text either.
    expect(mailMessageText({ text: " \r\n\r\n", html: HTML })).toBe(TEXT);
  });

  it("is empty for a message that brought neither", () => {
    expect(mailMessageText({ text: null, html: null })).toBe("");
    expect(mailMessageText({ text: "", html: "" })).toBe("");
  });

  it("has line ends of \\n whichever part it came from", () => {
    expect(mailMessageText({ text: "Hallo,\r\n\r\nbis morgen.\r\n", html: null })).toBe("Hallo,\n\nbis morgen.\n");
    expect(mailMessageText({ text: null, html: "<pre>eins\r\nzwei</pre>" })).toBe("eins\nzwei");
  });

  it("reads the HTML part with the platform's own parser, and gets what the portable one gets", () => {
    // This file runs with a DOM: `mailMessageText` takes the tree from `DOMParser`,
    // as it does in both shells. The core's own tests walk parse5's tree.
    expect(typeof DOMParser).toBe("function");
    const layout =
      '<html><body style="display:none"><table><tr><td style="font-size:0px"><div style="font-size:13px">Hello World</div></td></tr></table>' +
      '<blockquote type="cite"><p>Wie besprochen.</p></blockquote><ul><li>eins</li><li>zwei</li></ul><dialog open>Hinweis</dialog></body></html>';
    expect(mailMessageText({ text: null, html: layout })).toBe("Hello World\n\n> Wie besprochen.\n\n- eins\n- zwei\n\nHinweis");
    for (const html of [HTML, layout, "<p>eins<br>zwei</p><pre> drei\n  vier</pre>", "nur Text", ""]) {
      expect(mailMessageText({ text: null, html })).toBe(htmlToVisibleText(html));
    }
  });
});

/**
 * The tree of a parsed document answers to names the MARKUP chose (finding
 * 2026-10-12): a form to the names of its controls, the document to the names
 * of its images and forms. The text was read off the tree of the RAW markup,
 * by asking each node for `childNodes`, `nodeName` and its attributes — so a
 * message could decide what the answers were. With a control named `nodeName`
 * the walk threw and the portable parser read the message instead: the one
 * whose work a sender can drive up with nesting, and one that reads a form the
 * reader's sanitizer takes out whole. Two things hold now. The text is read
 * from the markup the reader's frame is given, and that tree is asked through
 * the prototypes and copied into plain objects first.
 *
 * In a browser a form answers to its controls and this test DOM's does not, so
 * what a browser does with such a form is held by the E2E of both shells.
 */
describe("a message cannot rename what its own tree answers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the markup the reader's frame is given, whatever the message names its elements", () => {
    const markups = [
      // An image named like the document's body: in this DOM `document.body` answers the image.
      '<p>A</p><img name="body" src="cid:x"><p>B</p>',
      '<form name="body"><p>Formular</p></form><p>B</p>',
      '<p>A</p><form><input name="childNodes"><input name="nodeName"><input name="getAttribute"><p>Formular</p></form><p>B</p>',
      // What the sanitizer takes out with its content is not in the text either.
      "<p>A</p><xmp><b>roh</b></xmp><noembed>ohne Einbettung</noembed><p>B</p>",
      HTML,
    ];
    for (const html of markups) {
      expect(mailMessageText({ text: null, html })).toBe(htmlToVisibleText(sanitizeEmailHtml(html).html));
    }
    expect(mailMessageText({ text: null, html: markups[0] })).toBe("A\n\nB");
    expect(mailMessageText({ text: null, html: markups[1] })).toBe("Formular\n\nB");
  });

  it("asks the tree through the prototypes: nodes that answer to every name it uses change nothing, and the portable parser is not called", () => {
    // The worst a tree can do: every element answers `childNodes`, `nodeName`,
    // `nodeType`, `getAttribute` and the rest with something else, and so does
    // the document for `body`.
    const Platform = DOMParser;
    class Renamed {
      parseFromString(html: string, type: DOMParserSupportedType): Document {
        const page = new Platform().parseFromString(html, type);
        const decoy = page.createElement("input");
        for (const element of Array.from(page.querySelectorAll("*"))) {
          for (const name of ["childNodes", "nodeName", "nodeType", "getAttribute", "attrs", "value", "data"]) {
            Object.defineProperty(element, name, { value: decoy, configurable: true });
          }
        }
        Object.defineProperty(page, "body", { value: decoy, configurable: true });
        Object.defineProperty(page, "getElementsByTagName", { value: decoy, configurable: true });
        return page;
      }
    }
    vi.stubGlobal("DOMParser", Renamed);
    const reads = vi.mocked(htmlToVisibleText);
    reads.mockClear();
    const html = '<p>A</p><div style="display:none">Versteckt</div><div><ol start="3"><li>Mitte</li></ol></div><p>B</p>';
    expect(mailMessageText({ text: null, html })).toBe("A\n\n3. Mitte\n\nB");
    // One read, and it was handed the platform's tree.
    expect(reads.mock.calls.map((call) => typeof call[1])).toEqual(["function"]);
  });
});

describe("a message without a plain-text part, at each place that reads its text", () => {
  it("a reply quotes it under the attribution line", () => {
    const body = buildReplyBody(htmlOnly(), "Am 09.10.2026 schrieb Anna Beispiel:");
    expect(body).toBe("\n\nAm 09.10.2026 schrieb Anna Beispiel:\n> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");
    expect(body).not.toContain(PREHEADER);
    // The block still begins where the signature has to go above it.
    expect(body.slice(quotedOriginalStart(body))).toMatch(/^Am 09\.10\.2026 schrieb/);
  });

  it("a forward carries it under the header block", () => {
    const body = buildForwardBody(htmlOnly());
    expect(body.startsWith(`\n\n${FORWARD_SEPARATOR}\nFrom: Anna Beispiel <anna@example.org>\n`)).toBe(true);
    expect(body.endsWith(`Subject: Rechnung Oktober\n\n${TEXT}\n`)).toBe(true);
    expect(body).not.toContain(PREHEADER);
  });

  it("the reply note quotes it", () => {
    const content = buildReplyNoteContent(htmlOnly(), "2026-10-09");
    expect(readFrontmatterPath(content, ["to"])).toBe("Anna Beispiel <anna@example.org>");
    expect(content).toContain("> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");
    expect(content).not.toContain(PREHEADER);
  });

  it("the filed note holds it under the subject", () => {
    const content = buildEmailNoteContent(htmlOnly(), "acc1", "INBOX", "2026-10-09");
    expect(content.endsWith(`# Rechnung Oktober\n\n${TEXT}\n`)).toBe(true);
    expect(content).not.toContain(PREHEADER);
    expect(content).not.toContain("tracker.example.org");
  });

  it("the rule action that files a message writes the same note", async () => {
    const files = new Map<string, string>();
    const adapter: MailCaptureAdapter = {
      readTextFile: async (path) => {
        const content = files.get(path);
        if (content === undefined) throw new Error("not found: " + path);
        return content;
      },
      writeTextFile: async (path, content) => {
        files.set(path, content);
      },
      exists: async (path) => files.has(path),
      createDir: async () => {},
    };
    const filed = await captureMailAsNote({ adapter, message: htmlOnly(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(filed).toEqual({ path: "Mail/2026-10-09 Rechnung Oktober.md", created: true });
    expect(files.get(filed.path)).toBe(buildEmailNoteContent(htmlOnly(), "acc1", "INBOX", "2026-10-09"));
    expect(files.get(filed.path)).toContain(TEXT);
  });

  it("a text part off the wire keeps no carriage returns in a note or a quote", () => {
    const wire = htmlOnly({ text: "Hallo Marco,\r\n\r\nanbei die Rechnung für Oktober.\r\n", html: null });
    expect(buildEmailNoteContent(wire, "acc1", "INBOX", "2026-10-09")).not.toContain("\r");
    expect(buildReplyBody(wire, "Anna:")).toBe("\n\nAnna:\n> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");
    expect(buildForwardBody(wire)).not.toContain("\r");
    expect(buildReplyNoteContent(wire, "2026-10-09")).not.toContain("\r");
  });
});

describe("a message without a plain-text part, as each backend delivers it", () => {
  const graphAccount: MailAccountConfig = { id: "ms1", label: "me@outlook.com", host: "", port: 993, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };
  const secrets = new Map<string, unknown>();
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];

  beforeEach(() => {
    requests.length = 0;
    forgetGraphMailRuntime("/vault", graphAccount.id);
    secrets.clear();
    secrets.set(mailSecretKey("/vault", graphAccount.id), { refreshToken: "REFRESH" });
    setPlatformServices({
      loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
      credentials: {
        readSecret: async <T,>(key: string) => (secrets.get(key) as T) ?? null,
        writeSecret: async <T,>(key: string, value: T) => { secrets.set(key, value); },
        removeSecret: async (key: string) => { secrets.delete(key); },
      },
      openExternal: async () => {},
    });
    // The message as Microsoft's reference for "Get message" describes it: the
    // body comes as HTML unless the request carries the Prefer header for text.
    const graph = async (url: string, init?: { headers?: Record<string, string> }) => {
      const headers = init?.headers ?? {};
      requests.push({ url, headers });
      const wantsText = /outlook\.body-content-type="text"/.test(headers.Prefer ?? headers.prefer ?? "");
      return new Response(
        JSON.stringify({
          id: "AAMk-html-1",
          subject: "Rechnung Oktober",
          from: { emailAddress: { name: "Anna Beispiel", address: "anna@example.org" } },
          toRecipients: [{ emailAddress: { address: "me@outlook.com" } }],
          receivedDateTime: "2026-10-09T07:30:00Z",
          body: wantsText ? { contentType: "text", content: TEXT } : { contentType: "html", content: HTML },
          hasAttachments: false,
          internetMessageId: "<rechnung@example.org>",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const transport = new Proxy({} as MailTransport, {
      get: () => () => { throw new Error("the Graph backend must not use the IMAP transport"); },
    });
    setMailPlatform({ transport, http: { api: graph as unknown as typeof fetch, token: graph as unknown as typeof fetch } });
  });

  it("Microsoft Graph: the body arrives as HTML, and a reply, a forward and the filed note have its text", async () => {
    const message = await fetchMessage("/vault", graphAccount, "INBOX", "AAMk-html-1");
    // The request is the one the app sends today — no Prefer header — and the
    // message therefore has an HTML part and no text part.
    expect(requests.some((request) => request.url.includes("/me/messages/AAMk-html-1") && !("Prefer" in request.headers))).toBe(true);
    expect(message.text).toBeNull();
    expect(message.html).toBe(HTML);

    expect(buildReplyBody(message, "Anna:")).toBe("\n\nAnna:\n> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");
    expect(buildForwardBody(message)).toContain(`\n\n${TEXT}\n`);
    expect(buildEmailNoteContent(message, graphAccount.id, "INBOX", "2026-10-09")).toContain(`\n\n${TEXT}\n`);
    expect(buildReplyNoteContent(message, "2026-10-09")).toContain("> anbei die Rechnung für Oktober.");
  });

  it("the phone's MIME parser: an HTML-only mail has no text part, and the four have its text all the same", () => {
    const raw = [
      "From: Anna Beispiel <anna@example.org>",
      "To: marco@example.org",
      "Subject: Rechnung Oktober",
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<div style=3D"display:none">Nur heute: 50 % Rabatt</div><p>Hallo Marco,</p>=',
      "<p>anbei die <b>Rechnung</b> f=C3=BCr Oktober.</p>",
      "",
    ].join("\r\n");
    const parsed = parseMessage(raw);
    expect(parsed.text).toBeNull();
    expect(parsed.html).toContain("für Oktober");

    const message = htmlOnly({ text: parsed.text, html: parsed.html });
    expect(buildReplyBody(message, "Anna:")).toBe("\n\nAnna:\n> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");
    expect(buildForwardBody(message)).toContain(`\n\n${TEXT}\n`);
    expect(buildEmailNoteContent(message, "acc1", "INBOX", "2026-10-09")).toContain(`\n\n${TEXT}\n`);
    expect(buildReplyNoteContent(message, "2026-10-09")).toContain("> anbei die Rechnung für Oktober.");
  });

  it("the phone's MIME parser: a footer a mailing list hangs under an HTML mail is not the mail's text", () => {
    // multipart/mixed with the HTML body first and a plain-text part behind it.
    // The desktop's parser reads the body as the first part and reports no
    // text part for it; the phone took the first text/plain anywhere — the
    // footer — and a reply quoted the footer instead of the mail.
    const raw = [
      "Subject: [liste] Rechnung Oktober",
      'Content-Type: multipart/mixed; boundary="m"',
      "",
      "--m",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Hallo Marco,</p><p>anbei die Rechnung für Oktober.</p>",
      "--m",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Disposition: inline",
      "",
      "_______________________________________________",
      "liste mailing list",
      "--m--",
      "",
    ].join("\r\n");
    const parsed = parseMessage(raw);
    expect(parsed.text).toBeNull();
    expect(buildReplyBody(htmlOnly({ text: parsed.text, html: parsed.html }), "Anna:")).toBe("\n\nAnna:\n> Hallo Marco,\n> \n> anbei die Rechnung für Oktober.\n");

    // The two versions of one body are still one body, whichever comes first.
    const alternative = (first: string[], second: string[]) =>
      ["Subject: Rechnung", 'Content-Type: multipart/alternative; boundary="a"', "", "--a", ...first, "--a", ...second, "--a--", ""].join("\r\n");
    const plain = ["Content-Type: text/plain; charset=utf-8", "", "Der Text des Absenders."];
    const html = ["Content-Type: text/html; charset=utf-8", "", "<p>Der Text des Absenders.</p>"];
    expect(parseMessage(alternative(plain, html)).text).toBe("Der Text des Absenders.");
    expect(parseMessage(alternative(html, plain)).text).toBe("Der Text des Absenders.");

    // A text part BESIDE the HTML inside one branch is a second piece of that
    // version, not another version of the body (finding 2026-10-12): the
    // desktop's parser reports no text part there, and so does this one.
    const beside = ["Content-Type: text/plain; charset=utf-8", "", "Text daneben"];
    const inOneBranch = [
      "Subject: Rechnung",
      'Content-Type: multipart/alternative; boundary="a"',
      "",
      "--a",
      'Content-Type: multipart/mixed; boundary="m"',
      "",
      "--m",
      ...html,
      "--m",
      ...beside,
      "--m--",
      "--a--",
      "",
    ].join("\r\n");
    const sameBranch = parseMessage(inOneBranch);
    expect(sameBranch.text).toBeNull();
    expect(sameBranch.html).toBe("<p>Der Text des Absenders.</p>");
    // The other version may stand one level further out.
    const calendar = ["Content-Type: text/calendar; charset=utf-8", "", "BEGIN:VCALENDAR"];
    const inner = ['Content-Type: multipart/alternative; boundary="b"', "", "--b", ...html, "--b", ...calendar, "--b--"];
    expect(parseMessage(alternative(inner, plain)).text).toBe("Der Text des Absenders.");
  });
});

/**
 * "As the reader shows it" is a promise about two pieces of code: the sanitizer
 * that prepares a message for the reader's frame, and the text taken from the
 * same HTML. If the sanitizer ever stopped keeping the inline style that hides
 * an element, the reader would show it and the quote would still leave it out —
 * so the pair is pinned against each other here.
 */
describe("what the reader hides, the text leaves out", () => {
  const inFrame = (html: string): HTMLElement => {
    const body = document.createElement("div");
    body.innerHTML = sanitizeEmailHtml(html).html;
    return body;
  };

  it("an element hidden by its own style stays hidden in the reader's frame, and is not in the text", () => {
    const html = '<div id="pre" style="display:none">Versteckt</div><p>Sichtbar</p>';
    expect(inFrame(html).querySelector<HTMLElement>("#pre")?.style.display).toBe("none");
    expect(mailMessageText({ text: null, html })).toBe("Sichtbar");

    const attribute = '<div id="pre" hidden>Versteckt</div><p>Sichtbar</p>';
    expect(inFrame(attribute).querySelector<HTMLElement>("#pre")?.hidden).toBe(true);
    expect(mailMessageText({ text: null, html: attribute })).toBe("Sichtbar");
  });

  it("a style the sanitizer removes hides nothing in the reader, and the text has the element", () => {
    const html = '<div id="pre" style="display:none;background:url(https://tracker.example.org/p.gif)">Doch sichtbar</div><p>Sichtbar</p>';
    expect(inFrame(html).querySelector("#pre")?.hasAttribute("style")).toBe(false);
    expect(mailMessageText({ text: null, html })).toBe("Doch sichtbar\n\nSichtbar");
  });

  it("a style sheet is gone from the reader's frame, so a class hides nothing and the text has the element", () => {
    const html = '<style>.pre { display: none }</style><div class="pre">Im Leser zu sehen</div><p>Sichtbar</p>';
    expect(inFrame(html).querySelector("style")).toBeNull();
    expect(mailMessageText({ text: null, html })).toBe("Im Leser zu sehen\n\nSichtbar");
  });
});
