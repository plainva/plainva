import { describe, expect, it } from "vitest";
import { shippedSources } from "../../test-sourceTree";

/**
 * Every place that hosts the composer hosts it the same way (finding
 * 2026-10-09).
 *
 * A compose request used to be a plain state update, and the composer under it
 * a component without a key: a second request handed new properties to a
 * mounted composer that reads them once, and nothing happened. `useComposeHost`
 * closes that — for the hosts that go through it. What the two of today do
 * with a second request is walked through in
 * components/mail/composeSecondRequest.test.tsx and in e2e/mail.spec.ts. This
 * scan is for the third, the one nobody has written yet, where the old pattern
 * would come back: a module that answers the compose event takes its draft
 * from the host, and a composer that is handed a draft is rendered under the
 * host's key and closed through the host.
 */

const sources = shippedSources(["apps/desktop/src"]);
const name = (rel: string) => rel.replace("apps/desktop/src/", "");

describe("who answers a compose request", () => {
  const listeners = sources.filter(({ text }) => /addEventListener\(\s*"plainva-compose-mail"/.test(text));

  it("is the host beside the shell and the auxiliary window's bridge", () => {
    // A scan that lost one of them would pass for the wrong reason.
    expect(listeners.map(({ rel }) => name(rel)).sort()).toEqual(["components/mail/MailComposeHost.tsx", "hooks/useAuxBridge.tsx"]);
  });

  for (const { rel, text } of listeners) {
    it(`${name(rel)} takes its draft from the compose host`, () => {
      expect(text, "a compose request goes through useComposeHost, not into a state of its own").toMatch(/useComposeHost</);
    });
  }
});

describe("where a composer is rendered", () => {
  /** The opening tag of every `<MailDraftModal …>` in a file. */
  const composerTags = (text: string) => [...text.matchAll(/<MailDraftModal\b[\s\S]*?\/>/g)].map((m) => m[0]);
  const hosts = sources.filter(({ text }) => composerTags(text).length > 0);

  it("is the two hosts and the composer's own window", () => {
    expect(hosts.map(({ rel }) => name(rel)).sort()).toEqual(["AuxApp.tsx", "components/mail/ComposeWindow.tsx", "components/mail/MailComposeHost.tsx"]);
  });

  for (const { rel, text } of hosts) {
    it(`${name(rel)}: a composer that is handed a draft is a new composer for every draft`, () => {
      for (const tag of composerTags(text)) {
        // The composer in a window of its own restores one snapshot and is that
        // window: nothing can ask it for another message.
        if (/\brestore=/.test(tag)) continue;
        expect(tag, "rendered under the host's key, so a new draft is not new properties on an old composer").toMatch(/\bkey=\{(bridge\.)?mailDraftKey\}/);
        expect(tag, "closed through the host, so a replaced composer cannot close its successor").toMatch(/\bonClose=\{(bridge\.)?closeMailDraft\}/);
      }
    });
  }
});
