// @vitest-environment node
import { describe, it, expect } from "vitest";
import { shippedSources } from "../../test-sourceTree";

/**
 * The mailbox a draft is written from has to reach the composer in EVERY
 * window that hosts one (finding 2026-10-09).
 *
 * The mail view names the mailbox when it asks for the composer, and the
 * composer starts with the one it is told (`initialAccountId`). In between
 * stands whatever hosts the composer in that window, and each host does two
 * things by hand: it copies the request into its own state, and it spells the
 * composer's properties out one by one. A host that leaves the mailbox out of
 * either step does not fail — its composer quietly starts with the first
 * mailbox that is stored, which is the fault this was, and with one mailbox
 * nobody can tell.
 *
 * The central window's host is held end to end by the E2E (`e2e/mail.spec.ts`,
 * two mailboxes), the auxiliary window's first step by `useAuxBridge.test.tsx`.
 * This scan holds both steps for all of them, including a host that does not
 * exist yet — and it lists none: where the composer is rendered and where the
 * request is answered is found, so moving a host breaks nothing here.
 *
 * A source scan, not a type: an optional property that is not passed is valid
 * TypeScript. The shapes it reads — a self-closing `<MailDraftModal … />`, a
 * listener registered by the event's name, a handler declared as a named
 * arrow function — are the ones every host has today. One written another way
 * is red here and says so, and whoever writes it teaches the scan its shape.
 */

const sources = shippedSources(["apps/desktop/src"]);

/** Every place the composer is rendered: file and the tag as it is written. */
function composerTags(): Array<{ file: string; tag: string }> {
  const out: Array<{ file: string; tag: string }> = [];
  for (const { rel, text } of sources) {
    for (const m of text.matchAll(/<MailDraftModal\b[\s\S]*?\/>/g)) out.push({ file: rel, tag: m[0] });
  }
  return out;
}

const LISTENS = /addEventListener\(\s*["'`]plainva-compose-mail["'`]\s*,\s*(\w+)?/;

/** Every file that answers a request for the composer. */
const composeListeners = () => sources.filter(({ text }) => LISTENS.test(text));

/**
 * The handler a file registers for the request, whole: from its declaration to
 * the brace that closes it. `null` when it is not a named arrow function.
 */
function handlerSource(text: string): string | null {
  const name = LISTENS.exec(text)?.[1];
  if (!name) return null;
  const declared = new RegExp(`\\bconst ${name} = [^=]*=>\\s*\\{`).exec(text);
  if (!declared) return null;
  let depth = 0;
  for (let i = declared.index + declared[0].length - 1; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && --depth === 0) return text.slice(declared.index, i + 1);
  }
  return null;
}

describe("every window tells its composer which mailbox the draft is written from", () => {
  it("finds the hosts", () => {
    // A scan that found nothing would pass for the wrong reason. Three kinds of
    // window render a composer — one that draws the whole shell, an auxiliary
    // one, and the composer as a window of its own —, and the first two answer
    // the request.
    expect(new Set(composerTags().map((t) => t.file)).size).toBeGreaterThanOrEqual(3);
    expect(composeListeners().length).toBeGreaterThanOrEqual(2);
  });

  it("passes the mailbox wherever the composer is rendered", () => {
    for (const { file, tag } of composerTags()) {
      // A composer that was lifted into its own window knows its sender from
      // the snapshot it is restored from; every other one has to be told the
      // mailbox of the request it was opened for.
      const told = /\brestore=\{/.test(tag) || /\binitialAccountId=\{[^}]*\baccountId\}/.test(tag);
      expect(told, `${file} renders the composer without the mailbox the draft is written from:\n${tag}`).toBe(true);
    }
  });

  it("keeps the mailbox when a request for the composer is taken in", () => {
    for (const { rel, text } of composeListeners()) {
      const handler = handlerSource(text);
      expect(
        handler,
        `${rel} answers "plainva-compose-mail" in a way this scan cannot read (it expects a handler declared as \`const name = (e) => { … }\`)`,
      ).not.toBeNull();
      expect(
        /\baccountId:\s*\w+\.accountId\b/.test(handler ?? ""),
        `${rel} answers "plainva-compose-mail" and drops the mailbox the request names (accountId):\n${handler}`,
      ).toBe(true);
    }
  });
});
