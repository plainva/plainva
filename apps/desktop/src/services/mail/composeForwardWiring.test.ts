// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shippedSources } from "../../test-sourceTree";

/**
 * The message a forward was made from has to reach the composer in EVERY
 * window that hosts one.
 *
 * The mail view names the message when it asks for the composer (`forward`, a
 * reference — `carriedFiles.ts`), and the composer loads the original's files
 * by it. In between stands whatever hosts the composer in that window, and a
 * host does two things by hand: it copies the request into its own state, and
 * it spells the composer's properties out one by one. A host that leaves the
 * reference out of either step does not fail. Its composer opens with the text
 * of the original and says nothing about the files — which is what every
 * forward did until 2026-10, and with a message that has no attachments nobody
 * can tell.
 *
 * The central window's host is held end to end by the E2E (`e2e/mail.spec.ts`,
 * "a forward carries the text of the original and its files"), the auxiliary
 * window's first step by `hooks/useAuxBridge.test.tsx`. This scan holds both
 * steps for all of them, and it lists none: where the composer is rendered and
 * where the request is answered is found, so a host that moves, or one nobody
 * has written yet, is read too.
 *
 * A source scan, not a type: an optional property that is not passed is valid
 * TypeScript.
 */

const sources = shippedSources(["apps/desktop/src"]);
const name = (rel: string) => rel.replace("apps/desktop/src/", "");

/** Every self-closing `<MailDraftModal … />`, with the file it stands in. */
const composerTags = sources.flatMap(({ rel, text }) =>
  [...text.matchAll(/<MailDraftModal\b[\s\S]*?\/>/g)].map((m) => ({ rel, tag: m[0] })),
);

/** Every file that answers a request for the composer. */
const listeners = sources.filter(({ text }) => /addEventListener\(\s*["'`]plainva-compose-mail["'`]/.test(text));

describe("every window hands its composer the message a forward was made from", () => {
  it("finds the hosts", () => {
    // A scan that found nothing would pass for the wrong reason. Three kinds of
    // window render a composer — one that draws the whole shell, an auxiliary
    // one, and the composer as a window of its own —, and the first two answer
    // the request.
    expect(new Set(composerTags.map(({ rel }) => rel)).size).toBeGreaterThanOrEqual(3);
    expect(listeners.length).toBeGreaterThanOrEqual(2);
  });

  it("passes the reference wherever the composer is rendered", () => {
    for (const { rel, tag } of composerTags) {
      // A composer in a window of its own brings its files in the snapshot it
      // is restored from, loaded or not; every other one has to be told the
      // message of the request it was opened for.
      const told = /\brestore=\{/.test(tag) || /\bforward=\{[^}]*\bforward\}/.test(tag);
      expect(told, `${name(rel)} renders the composer without the message a forward was made from:\n${tag}`).toBe(true);
    }
  });

  it("keeps the reference when a request for the composer is taken in", () => {
    for (const { rel, text } of listeners) {
      expect(
        /\bforward:\s*\w+\.forward\b/.test(text),
        `${name(rel)} answers "plainva-compose-mail" and drops the message a forward was made from (forward)`,
      ).toBe(true);
    }
  });
});
