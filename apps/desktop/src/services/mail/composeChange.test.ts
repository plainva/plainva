// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { composeChanged, createComposeSession, splitRecipients, withSignature, type ComposeContent, type MailAttachment } from "@plainva/ui/mail";

/**
 * "Was this draft changed?" — the rule both composers ask before a message is
 * dropped without a word (finding 2026-10-09).
 *
 * The phone measured against the wrong thing and the desktop did not ask, so
 * what is pinned here is the measure itself: what counts as something a person
 * would lose, and what merely looks different.
 */

const note: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };
const sketch: MailAttachment = { name: "Skizze.png", mime: "image/png", contentBase64: "iVBORw0KGgo=" };

const opened: ComposeContent = {
  to: "Anna Beispiel <anna@example.org>",
  cc: "",
  bcc: "",
  subject: "Angebot",
  body: "Hallo Anna,\n\n-- \nMarco\n",
  attachments: [note],
};
const now = (over: Partial<ComposeContent> = {}): ComposeContent => ({ ...opened, ...over });

describe("an untouched draft", () => {
  it("is unchanged — with the signature the composer put in and the file it arrived with", () => {
    expect(composeChanged(opened, now())).toBe(false);
  });

  it("stays unchanged when the same content stands in other objects", () => {
    // What the composer holds after it moved to a window of its own: every
    // string and every file is a copy, none is the object it started as.
    const copy: ComposeContent = JSON.parse(JSON.stringify(opened));
    expect(copy.attachments[0]).not.toBe(note);
    expect(composeChanged(opened, copy)).toBe(false);
  });
});

describe("what a person changed", () => {
  it("counts every field someone can write into", () => {
    expect(composeChanged(opened, now({ to: "" }))).toBe(true);
    expect(composeChanged(opened, now({ cc: "ben@example.org" }))).toBe(true);
    expect(composeChanged(opened, now({ bcc: "ben@example.org" }))).toBe(true);
    expect(composeChanged(opened, now({ subject: "Angebot (neu)" }))).toBe(true);
    expect(composeChanged(opened, now({ body: `Kurz vorab: ${opened.body}` }))).toBe(true);
  });

  it("counts a file put on by hand, and one taken off", () => {
    expect(composeChanged(opened, now({ attachments: [note, sketch] }))).toBe(true);
    expect(composeChanged(opened, now({ attachments: [] }))).toBe(true);
    // Same number of files, another file.
    expect(composeChanged(opened, now({ attachments: [sketch] }))).toBe(true);
  });

  it("no longer counts a file once it is off again", () => {
    expect(composeChanged(opened, now({ attachments: [note] }))).toBe(false);
  });

  it("tells two files of one name apart by what is in them", () => {
    expect(composeChanged(opened, now({ attachments: [{ ...note, contentBase64: "IyBBbmRlcmVzCg==" }] }))).toBe(true);
    expect(composeChanged(opened, now({ attachments: [{ ...note, mime: "text/plain" }] }))).toBe(true);
  });
});

describe("recipients are the list they name", () => {
  it("splits on comma, semicolon and line break, and keeps a display name whole", () => {
    expect(splitRecipients("Anna Beispiel <anna@example.org>; ben@example.org,\ncarla@example.org, ")).toEqual([
      "Anna Beispiel <anna@example.org>",
      "ben@example.org",
      "carla@example.org",
    ]);
  });

  it("does not count how the list is written", () => {
    const two = now({ to: "anna@example.org;ben@example.org" });
    // The desktop's chips join a list again with ", " — the same two people.
    expect(composeChanged(two, { ...two, to: "anna@example.org, ben@example.org" })).toBe(false);
    // A trailing separator is somebody still typing, not a recipient.
    expect(composeChanged(two, { ...two, to: "anna@example.org, ben@example.org, " })).toBe(false);
  });

  it("counts another recipient, another order and another spelling of a name", () => {
    const two = now({ to: "anna@example.org, ben@example.org" });
    expect(composeChanged(two, { ...two, to: "anna@example.org, ben@example.org, carla@example.org" })).toBe(true);
    expect(composeChanged(two, { ...two, to: "ben@example.org, anna@example.org" })).toBe(true);
    expect(composeChanged(two, { ...two, to: "Anna <anna@example.org>, ben@example.org" })).toBe(true);
    // A recipient that is typed and not yet confirmed is still one.
    expect(composeChanged(two, { ...two, to: "anna@example.org, ben@example.org, car" })).toBe(true);
  });
});

describe("the body through the editor", () => {
  it("is the same text whatever its line breaks are written as", () => {
    const windows = now({ body: "Hallo Anna,\r\n\r\n> Zitat\r\n" });
    expect(composeChanged(windows, { ...windows, body: "Hallo Anna,\n\n> Zitat\n" })).toBe(false);
    expect(composeChanged(windows, { ...windows, body: "Hallo Anna,\n\n> Zitat!\n" })).toBe(true);
  });

  it("holds for what the real editor hands back once the composer signs the body", () => {
    // The whole reason line breaks are not compared: the editor keeps lines.
    // A body that arrives with Windows line breaks — a quoted mail, a note
    // written on Windows — is handed back with plain ones as soon as the
    // composer puts the signature in. Nobody typed anything.
    const account = { id: "m1", label: "marco@example.org", host: "", port: 0, user: "marco@example.org", signature: "Marco" };
    const arrived = "Hallo Anna,\r\n\r\n> Am Montag schrieb Anna:\r\n> Passt der Termin?\r\n";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    let seen = arrived;
    const session = createComposeSession({ parent, doc: arrived, onChange: (v) => (seen = v) });

    const signed = withSignature(arrived, account);
    session.applyExternalText(signed);

    expect(seen, "the editor rewrote the line breaks").not.toBe(signed);
    expect(seen).not.toContain("\r");
    expect(composeChanged(now({ body: signed }), now({ body: seen }))).toBe(false);
    session.destroy();
    parent.remove();
  });
});
