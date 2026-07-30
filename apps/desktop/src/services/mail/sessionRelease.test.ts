import { describe, expect, it, vi } from "vitest";
import { releaseMailSessions, setMailPlatform, type MailTransport } from "@plainva/ui/mail";

/**
 * P7.2: the desktop transport pools ONE idle IMAP session per account, and the
 * mail view hands it back when it stops needing it. `releaseMailSessions` is the
 * seam in between — housekeeping that must never turn into a mail error and must
 * stay silent on a transport that has no pool (the phone opens per operation
 * until P7.3).
 */
function platform(transport: Partial<MailTransport>) {
  setMailPlatform({
    transport: transport as MailTransport,
    http: { api: fetch, token: fetch },
  });
}

describe("releaseMailSessions", () => {
  it("passes the account through to the transport", async () => {
    const releaseSessions = vi.fn().mockResolvedValue(undefined);
    platform({ releaseSessions });
    await releaseMailSessions("ada@example.org");
    expect(releaseSessions).toHaveBeenCalledWith("ada@example.org");
  });

  it("releases everything when no account is named", async () => {
    const releaseSessions = vi.fn().mockResolvedValue(undefined);
    platform({ releaseSessions });
    await releaseMailSessions();
    expect(releaseSessions).toHaveBeenCalledWith(undefined);
  });

  it("does nothing on a transport without a pool", async () => {
    // The method is optional on purpose: a transport that opens a connection per
    // operation has nothing to release, and the caller must not have to know.
    platform({});
    await expect(releaseMailSessions("ada@example.org")).resolves.toBeUndefined();
  });

  it("swallows a failing release", async () => {
    // A release that fails is a leaked socket at worst — never a reason to show
    // the user an error while they are switching accounts.
    const releaseSessions = vi.fn().mockRejectedValue(new Error("connection reset"));
    platform({ releaseSessions });
    await expect(releaseMailSessions()).resolves.toBeUndefined();
    expect(releaseSessions).toHaveBeenCalled();
  });
});
