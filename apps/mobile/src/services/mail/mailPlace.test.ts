import { describe, expect, it } from "vitest";
import { resolveMailAccount, resolveMailbox } from "./mailPlace";

/**
 * The resolution behind device report B1: going back out of a message must
 * land where the user was. These two functions carry the whole rule, so they
 * are the place to pin it — a regression here is the reported bug returning.
 */
describe("remembered mailbox resolution (B1)", () => {
  const accounts = [{ id: "work" }, { id: "private" }];

  it("keeps the remembered account while it exists", () => {
    expect(resolveMailAccount("private", accounts)).toBe("private");
  });

  it("falls back to the first account only when the remembered one is gone", () => {
    expect(resolveMailAccount("removed", accounts)).toBe("work");
    expect(resolveMailAccount(null, accounts)).toBe("work");
  });

  it("has no account to offer when none is connected", () => {
    expect(resolveMailAccount("work", [])).toBeNull();
  });

  it("keeps the remembered folder, and prefers the inbox otherwise", () => {
    const names = ["INBOX", "Archive", "Sent"];
    expect(resolveMailbox("Archive", names)).toBe("Archive");
    expect(resolveMailbox("Gone", names)).toBe("INBOX");
    expect(resolveMailbox(null, names)).toBe("INBOX");
  });

  it("takes the first folder when the server has no inbox by that name", () => {
    expect(resolveMailbox(null, ["Alle Nachrichten", "Papierkorb"])).toBe("Alle Nachrichten");
    expect(resolveMailbox(null, [])).toBeNull();
  });
});
