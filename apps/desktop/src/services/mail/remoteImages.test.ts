import { describe, expect, it } from "vitest";
import {
  isJunkFolder,
  mailboxRoles,
  messageJunkState,
  pickJunkFolder,
  remoteImagesDecision,
  specialUseRole,
  type MessageJunkState,
} from "@plainva/ui/mail";

/**
 * May remote images load? (plan Befunde 06.10., M2.) The rule was written
 * twice — `always || once` in each shell — and neither copy looked at the
 * folder, so "always load" also loaded the tracking pixels of spam.
 */

describe("the one rule for remote images", () => {
  // All eight combinations of the two switches and the folder, plus the four
  // of the state in which the folder is not known yet.
  const cases: Array<[always: boolean, once: boolean, folder: MessageJunkState, allow: boolean, blockedAsJunk: boolean]> = [
    [false, false, "notJunk", false, false],
    [false, true, "notJunk", true, false],
    [true, false, "notJunk", true, false],
    [true, true, "notJunk", true, false],
    [false, false, "junk", false, true],
    [false, true, "junk", true, false],
    // The case the rule exists for: "always" does not reach into the junk folder.
    [true, false, "junk", false, true],
    [true, true, "junk", true, false],
    [false, false, "unknown", false, false],
    [false, true, "unknown", true, false],
    // Not known yet counts as junk — but the hint does not CLAIM it is junk.
    [true, false, "unknown", false, false],
    [true, true, "unknown", true, false],
  ];
  for (const [always, once, folder, allow, blockedAsJunk] of cases) {
    it(`always=${always} once=${once} folder=${folder} → ${allow ? "load" : "block"}`, () => {
      expect(remoteImagesDecision({ always, once, folder })).toEqual({ allow, blockedAsJunk });
    });
  }
});

describe("which folder a message is in", () => {
  const boxes = [{ name: "INBOX" }, { name: "Junk" }, { name: "Gesendet" }];

  it("asks the folder the MESSAGE came from", () => {
    expect(messageJunkState({ accountId: "a", mailbox: "Junk" }, { accountId: "a", boxes })).toBe("junk");
    expect(messageJunkState({ accountId: "a", mailbox: "INBOX" }, { accountId: "a", boxes })).toBe("notJunk");
  });

  it("does not know before the folder list has arrived", () => {
    expect(messageJunkState({ accountId: "a", mailbox: "INBOX" }, null)).toBe("unknown");
    expect(messageJunkState({ accountId: "a", mailbox: "INBOX" }, { accountId: "a", boxes: [] })).toBe("unknown");
    expect(messageJunkState(null, { accountId: "a", boxes })).toBe("unknown");
  });

  it("does not read another account's folder list", () => {
    // The list that was on screen a moment ago belongs to the account that was
    // open then; its "INBOX" says nothing about this message's folder.
    expect(messageJunkState({ accountId: "b", mailbox: "INBOX" }, { accountId: "a", boxes })).toBe("unknown");
  });

  it("trusts a stated role over the name", () => {
    // Graph names the folder in the account's language and states the role.
    const graph = [{ name: "Posteingang", role: "inbox" }, { name: "Junk-E-Mail", role: "junk" }, { name: "Spamverdacht prüfen", role: "archive" }];
    expect(messageJunkState({ accountId: "a", mailbox: "Junk-E-Mail" }, { accountId: "a", boxes: graph })).toBe("junk");
    expect(messageJunkState({ accountId: "a", mailbox: "Spamverdacht prüfen" }, { accountId: "a", boxes: graph })).toBe("notJunk");
  });
});

describe("the special-use attribute of a LIST reply", () => {
  it("reads the server's own word", () => {
    expect(specialUseRole(["\\hasnochildren", "\\junk"])).toBe("junk");
    expect(specialUseRole(["\\HasNoChildren", "\\Junk"])).toBe("junk");
    expect(specialUseRole(["\\Trash"])).toBe("trash");
    expect(specialUseRole(["\\Sent"])).toBe("sent");
    expect(specialUseRole(["\\Drafts"])).toBe("drafts");
    expect(specialUseRole(["\\Archive"])).toBe("archive");
  });

  it("states no role for views and for plain keywords", () => {
    expect(specialUseRole(["\\All"])).toBeNull();
    expect(specialUseRole(["\\Flagged", "\\Important", "\\HasChildren"])).toBeNull();
    // Without the backslash it is a keyword somebody set, not a system flag.
    expect(specialUseRole(["junk"])).toBeNull();
    expect(specialUseRole([])).toBeNull();
  });

  it("recognises Gmail's spam folder in a language the name list does not know", () => {
    // A Gmail account shown in Turkish: the name says nothing, the attribute does.
    const boxes = mailboxRoles([
      { name: "INBOX", delimiter: "/", attributes: ["\\hasnochildren"] },
      { name: "[Gmail]/Gereksiz", delimiter: "/", attributes: ["\\hasnochildren", "\\junk"] },
      { name: "[Gmail]/Tüm Postalar", delimiter: "/", attributes: ["\\all", "\\hasnochildren"] },
    ]);
    expect(boxes.map((b) => b.role)).toEqual(["inbox", "junk", undefined]);
    expect(isJunkFolder("[Gmail]/Gereksiz", boxes)).toBe(true);
    expect(pickJunkFolder(boxes)).toBe("[Gmail]/Gereksiz");
  });

  it("falls back to the name where the server states nothing", () => {
    const boxes = mailboxRoles([
      { name: "INBOX", delimiter: ".", attributes: [] },
      { name: "INBOX.Spam", delimiter: ".", attributes: [] },
    ]);
    expect(boxes.map((b) => b.role)).toEqual(["inbox", "junk"]);
  });

  it("the stated junk folder is THE junk folder, even beside an older one called Junk", () => {
    const boxes = mailboxRoles([
      { name: "Junk", delimiter: "/", attributes: [] },
      { name: "Unerwünscht", delimiter: "/", attributes: ["\\junk"] },
    ]);
    expect(pickJunkFolder(boxes)).toBe("Unerwünscht");
    // For blocking images, one folder too many is the safe side.
    expect(isJunkFolder("Junk", boxes)).toBe(true);
    expect(isJunkFolder("Unerwünscht", boxes)).toBe(true);
  });
});
