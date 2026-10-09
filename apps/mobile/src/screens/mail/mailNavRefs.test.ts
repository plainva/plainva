import { describe, expect, it } from "vitest";
import type { MailAttachment } from "@plainva/ui/mail";
import type { MailDraft } from "../MailComposeScreen";
import { draftPath, mailRefPath, parseDraft, parseMailRef, type MailRef } from "./mailNavRefs";

/**
 * A draft and a message cross the nav stack as the JSON in their entry's path
 * (finding 2026-10-09): what the writer puts in, the reader has to give back.
 *
 * The fixtures are typed `Required<…>` on purpose. A field added to `MailDraft`
 * or `MailRef` does not compile here until the fixture names it — and then the
 * round trip fails until the reader carries it. That is the step that was
 * missing when `attachments` joined the draft and the reader went on returning
 * four fields.
 */
const file: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };

const fullDraft: Required<MailDraft> = {
  accountId: "acc-1",
  to: "Ben Beispiel <ben@example.org>",
  subject: 'Angebot "Nord" — Stand 10/2026',
  body: "Hallo Ben,\n\nanbei das Angebot.\n\n> zitiert\n",
  attachments: [file, { name: "Skizze.png", mime: "image/png", contentBase64: "iVBORw0KGgo=" }],
};

const fullRef: Required<MailRef> = {
  accountId: "acc-1",
  // A folder name may hold any character, which is why the path is JSON.
  mailbox: 'Projekte/"Nord" & Süd',
  messageId: "AAMkAD=/+7",
  flagged: true,
  seen: true,
};

describe("a draft through the nav path", () => {
  it("comes back as it went in, every field", () => {
    expect(parseDraft(draftPath(fullDraft))).toEqual(fullDraft);
  });

  it("carries a note as a file — the hand-off that arrived empty", () => {
    const sent: MailDraft = { accountId: "", to: "", subject: "Angebot", body: "", attachments: [file] };
    expect(parseDraft(draftPath(sent)).attachments).toEqual([file]);
    // The same through a bare JSON.stringify: the reader does not depend on
    // who wrote the path.
    expect(parseDraft(JSON.stringify(sent)).attachments).toEqual([file]);
  });

  it("stays without files when it had none", () => {
    const plain: MailDraft = { accountId: "acc-1", to: "", subject: "", body: "" };
    expect(parseDraft(draftPath(plain))).toEqual(plain);
    expect("attachments" in parseDraft(draftPath(plain))).toBe(false);
    expect(parseDraft(draftPath({ ...plain, attachments: undefined }))).toEqual(plain);
    expect(parseDraft(draftPath({ ...plain, attachments: [] })).attachments).toEqual([]);
  });

  it("drops attachments that are not a list", () => {
    for (const attachments of ["Angebot.md", 7, true, null, { 0: file, length: 1 }]) {
      const draft = parseDraft(JSON.stringify({ accountId: "", to: "", subject: "", body: "", attachments }));
      expect(draft.attachments, JSON.stringify(attachments)).toBeUndefined();
    }
  });

  it("drops the entries that are not a file, and keeps the ones that are", () => {
    // The composer encodes and sends whatever it is handed, unseen — so a
    // half-formed entry must not reach it as if it were a file.
    const broken = [
      null,
      "Angebot.md",
      ["Angebot.md", "text/markdown", "IyBB"],
      { name: "Angebot.md", mime: "text/markdown" },
      { name: "Angebot.md", contentBase64: "IyBB" },
      { mime: "text/markdown", contentBase64: "IyBB" },
      { name: 7, mime: "text/markdown", contentBase64: "IyBB" },
      { name: "Angebot.md", mime: null, contentBase64: "IyBB" },
      { name: "Angebot.md", mime: "text/markdown", contentBase64: [35, 32] },
    ];
    const path = JSON.stringify({ accountId: "", to: "", subject: "", body: "", attachments: [...broken, file] });
    expect(parseDraft(path).attachments).toEqual([file]);
    expect(parseDraft(JSON.stringify({ attachments: broken })).attachments).toEqual([]);
  });

  it("is total: a path that is no draft opens an empty one", () => {
    const empty = { accountId: "", to: "", subject: "", body: "" };
    for (const path of ["", "{not json", "null", "7", '"text"', "[]", "{}"]) expect(parseDraft(path), path).toEqual(empty);
  });
});

describe("a message through the nav path", () => {
  it("comes back as it went in, every field", () => {
    expect(parseMailRef(mailRefPath(fullRef))).toEqual(fullRef);
    const unread: MailRef = { ...fullRef, flagged: false, seen: false };
    expect(parseMailRef(mailRefPath(unread))).toEqual(unread);
  });

  it("still reads a path an older build stored", () => {
    // An open message comes back after a restart, so its path outlives the
    // build that wrote it: the short keys are the format, and a path from
    // before the read state travelled opens as unread, as it did then.
    expect(mailRefPath(fullRef)).toBe(JSON.stringify({ a: fullRef.accountId, m: fullRef.mailbox, id: fullRef.messageId, f: true, s: true }));
    expect(parseMailRef('{"a":"acc-1","m":"INBOX","id":"7","f":true}')).toEqual({ accountId: "acc-1", mailbox: "INBOX", messageId: "7", flagged: true, seen: false });
  });

  it("is total: a path that is no message yields empty values", () => {
    const empty = { accountId: "", mailbox: "", messageId: "", flagged: false, seen: false };
    for (const path of ["", "{not json", "null", "[]", "{}"]) expect(parseMailRef(path), path).toEqual(empty);
  });
});
