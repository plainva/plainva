import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { MailAttachment } from "@plainva/ui/mail";
import type { NavEntry } from "./navigation";
import { PUSHED_ROUTES, TAB_ROUTES, type RouteContext } from "./routes";
import type { MailDraft } from "./screens/MailComposeScreen";
import type { MailRef } from "./screens/mail/mailNavRefs";

/**
 * What one mail route pushes is what the next one reads (finding 2026-10-09).
 *
 * A message and a draft cross the nav stack as JSON in the entry's path: one
 * route writes it, another reads it, and nothing held the two together. They
 * came apart twice, each time in a commit that taught one side a new field:
 *
 *  - "Send this note as an attachment" opened the composer WITHOUT the
 *    attachment. The note route wrote the file into the path (2026-08-20) and
 *    the composer's reader never learned to take it out again.
 *  - A message opened from the mail TAB was marked read again on every visit,
 *    and its menu offered "mark read" for a message that was. The pushed mail
 *    screen wrote the read state (2026-08-09); the tab's copy of the same
 *    handler did not.
 *
 * The codec's own tests hold reader and writer together. These hold the ROUTES
 * to the codec, through the real tables: building an element does not call the
 * component, so a stub context is enough (see tabRoutes.test.ts).
 */
function shell() {
  const pushed: NavEntry[] = [];
  const ctx = { push: (entry: NavEntry) => void pushed.push(entry), vault: { vaultId: "local" } } as unknown as RouteContext;
  return { ctx, pushed };
}

const propsOf = <P>(node: unknown): P => (node as ReactElement<P>).props;

const file: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };

type NoteProps = { onComposeMail: (draft: { subject: string; body: string; attachments?: MailAttachment[] }) => void };
type ListProps = {
  onOpenMessage: (accountId: string, mailbox: string, id: string, flagged: boolean, seen: boolean) => void;
  onCompose: (accountId: string) => void;
};
type MessageProps = MailRef & { onReply: (draft: MailDraft) => void };

/** The draft the composer is rendered with for the entry that was pushed last. */
function composed(pushed: NavEntry[], ctx: RouteContext): MailDraft {
  const entry = pushed[pushed.length - 1];
  expect(entry?.kind).toBe("mailcompose");
  return propsOf<{ draft: MailDraft }>(PUSHED_ROUTES.mailcompose(entry, ctx)).draft;
}

describe("a draft reaches the composer as it left", () => {
  it("from a note, with the note attached as a file", () => {
    const { ctx, pushed } = shell();
    const note = propsOf<NoteProps>(PUSHED_ROUTES.note({ kind: "note", path: "Angebot.md" }, ctx));
    note.onComposeMail({ subject: "Angebot", body: "", attachments: [file] });
    expect(composed(pushed, ctx)).toEqual({ accountId: "", to: "", subject: "Angebot", body: "", attachments: [file] });
  });

  it("from a note, with the note as the message", () => {
    const { ctx, pushed } = shell();
    const note = propsOf<NoteProps>(PUSHED_ROUTES.note({ kind: "note", path: "Angebot.md" }, ctx));
    note.onComposeMail({ subject: "Angebot", body: "Der Text der Notiz." });
    expect(composed(pushed, ctx)).toEqual({ accountId: "", to: "", subject: "Angebot", body: "Der Text der Notiz." });
  });

  it("from a message: reply, forward and a tapped address", () => {
    const { ctx, pushed } = shell();
    const entry: NavEntry = { kind: "mailmsg", path: JSON.stringify({ a: "acc", m: "INBOX", id: "7", f: false, s: true }) };
    const draft: MailDraft = { accountId: "acc", to: "ben@example.org", subject: "Re: Angebot", body: "\n\n> zitiert" };
    propsOf<MessageProps>(PUSHED_ROUTES.mailmsg(entry, ctx)).onReply(draft);
    expect(composed(pushed, ctx)).toEqual(draft);
  });

  for (const [name, list] of [
    ["the pushed mail screen", (ctx: RouteContext) => PUSHED_ROUTES.mail({ kind: "mail", path: "" }, ctx)],
    ["the mail tab", (ctx: RouteContext) => TAB_ROUTES.mail(ctx)],
  ] as const) {
    it(`from ${name}: a new message for the open mailbox`, () => {
      const { ctx, pushed } = shell();
      propsOf<ListProps>(list(ctx)).onCompose("acc");
      expect(composed(pushed, ctx)).toEqual({ accountId: "acc", to: "", subject: "", body: "" });
    });
  }
});

describe("the route tables leave the spelling to the codec", () => {
  it("push no path they spelled themselves", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "routes.tsx"), "utf8");
    expect(
      source,
      "a nav path written as an object literal in a route is checked against nothing: give its reader a writer " +
        "that takes the type (screens/mail/mailNavRefs.ts, screens/base/pinboardEntryRef.ts) and call that",
    ).not.toContain("JSON.stringify(");
  });
});

describe("a message opens as the list showed it", () => {
  for (const [name, list] of [
    ["the pushed mail screen", (ctx: RouteContext) => PUSHED_ROUTES.mail({ kind: "mail", path: "" }, ctx)],
    ["the mail tab", (ctx: RouteContext) => TAB_ROUTES.mail(ctx)],
  ] as const) {
    it(`from ${name}: account, folder, id, flag and read state`, () => {
      const { ctx, pushed } = shell();
      // A folder name may hold any character; it must come back unchanged.
      propsOf<ListProps>(list(ctx)).onOpenMessage("acc", 'Projekte/"Nord" & Süd', "7", true, true);
      expect(pushed).toHaveLength(1);
      expect(pushed[0].kind).toBe("mailmsg");
      const message = propsOf<MessageProps>(PUSHED_ROUTES.mailmsg(pushed[0], ctx));
      expect({ accountId: message.accountId, mailbox: message.mailbox, messageId: message.messageId, flagged: message.flagged, seen: message.seen }).toEqual({
        accountId: "acc",
        mailbox: 'Projekte/"Nord" & Süd',
        messageId: "7",
        flagged: true,
        seen: true,
      });
    });
  }
});
