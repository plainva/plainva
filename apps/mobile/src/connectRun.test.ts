import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  caldavUrlFromFiles,
  clearConnectSecrets,
  getConnectSecrets,
  rememberConnectSecrets,
} from "./services/connectSecrets";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The connect wizard, from step 2 onwards (finding 2026-08-21).
 *
 * The maintainer's report was three symptoms — provider chooser folds back out,
 * Google asks for the client id again, mail lands on the generic IMAP form —
 * and one cause: the family stopped travelling after the first hop. The prefill
 * table (`familyTarget.ts`) was never wrong, it was never reached.
 */
describe("a run keeps its provider on every hop", () => {
  /**
   * A source guard rather than a rendered test on purpose: the push happens in
   * an event handler inside a hook that only runs inside the shell, and what
   * has to hold is one property on the entry. Red counter-check: dropping
   * `family` from the pushEntry call fails this.
   */
  it("pushes the next screen WITH the family", () => {
    const src = read("./hooks/useConnectRun.ts");
    expect(src).toContain("pushEntry(st, entry)");
    expect(src).toMatch(/kind: screenForService\([^;]+family: q.family/);
  });

  /** Every screen the run can open must read the family it is handed. */
  it("has all three target screens read the family", () => {
    for (const file of [
      "./AddVaultScreen.tsx",
      "./screens/PimAccountsScreen.tsx",
      "./screens/MailAccountsScreen.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} reads the family`).toMatch(/family\?: CloudProviderFamily/);
      expect(src, `${file} asks the shared prefill table`).toMatch(/TargetForFamily\(family\)/);
    }
  });
});

describe("credentials collected by one step reach the next", () => {
  beforeEach(() => clearConnectSecrets());

  it("merges what a step collected, and an empty field never wins", () => {
    rememberConnectSecrets({ baseUrl: "https://cloud.example.com/remote.php/dav/files/ada/", user: "ada" });
    rememberConnectSecrets({ password: "  app-pw  ", user: "   " });
    expect(getConnectSecrets()).toEqual({
      baseUrl: "https://cloud.example.com/remote.php/dav/files/ada/",
      user: "ada",
      password: "app-pw",
    });
  });

  it("keeps nothing once the run ends", () => {
    rememberConnectSecrets({ password: "app-pw" });
    clearConnectSecrets();
    expect(getConnectSecrets()).toEqual({});
  });

  /**
   * The run must not outlive itself. `persist(null)` is the single point where
   * a queue disappears — cancelled, expired or finished — so the teardown hangs
   * there rather than on each of the three call sites.
   */
  it("is cleared wherever the queue is dropped", () => {
    const src = read("./services/connectQueue.ts");
    const persist = /async function persist\([^)]*\): Promise<void> \{([\s\S]*?)\n\}/.exec(src);
    expect(persist).not.toBeNull();
    expect(persist![1]).toContain("clearConnectSecrets()");
  });

  it("derives the CalDAV endpoint from a Nextcloud file URL", () => {
    expect(caldavUrlFromFiles("https://cloud.example.com/remote.php/dav/files/ada/Vault", "ada")).toBe(
      "https://cloud.example.com/remote.php/dav",
    );
  });

  /** A guessed path looks answered, which is worse than an empty field. */
  it("stays silent for anything that is not a Nextcloud file root", () => {
    expect(caldavUrlFromFiles("https://webdav.fastmail.com", "ada@example.com")).toBeNull();
    expect(caldavUrlFromFiles(undefined, "ada")).toBeNull();
    expect(caldavUrlFromFiles("https://cloud.example.com/remote.php/dav/files/ada/", undefined)).toBeNull();
  });
});

/**
 * Google and Microsoft calendars sign in with this device's access through the
 * one account sign-in (account sign-in plan K4b). The form used to look a
 * client id up along a chain of its own and offer a field for it - a second
 * way to sign in beside the card's.
 */
describe("the add-calendar form signs in through the card", () => {
  it("shows this device's access instead of a client-id field", () => {
    const src = read("./screens/PimAccountsScreen.tsx");
    expect(src).toContain('data-testid="pim-access"');
    expect(src).not.toContain("lookupOAuthClientForNewAccount");
    expect(src).not.toContain("setGClientId");
    expect(src).not.toContain("beginPimOAuth(");
  });

  it("adds the calendar through the one sign-in", () => {
    const src = read("./screens/PimAccountsScreen.tsx");
    expect(src).toMatch(/beginMobileSignIn\(vaultId, \{ family: provider, \.\.\.\(cardId \? \{ cardId \} : \{\}\), add: \["calendar"\] \}\)/);
  });
});
