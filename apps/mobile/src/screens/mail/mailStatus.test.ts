import { describe, expect, it } from "vitest";
import { mailStatus } from "./mailStatus";

/**
 * One line, ranked (S30). The screen used to render a banner per condition,
 * each unaware of the others; an "all inboxes" view with a stale cache and
 * three failed accounts filled the first screenful with notices.
 */
describe("mail status line", () => {
  const none = { error: null, unifiedErrors: [], stale: false, refreshing: false };

  it("says nothing when there is nothing to say", () => {
    expect(mailStatus(none)).toBeNull();
  });

  it("lets an outright failure speak alone", () => {
    // Everything else is moot when the list could not be read at all.
    const s = mailStatus({ ...none, error: "no route to host", stale: true, unifiedErrors: [{ label: "A", message: "x" }] });
    expect(s).toEqual({ kind: "error", key: "", raw: "no route to host" });
  });

  it("names a single unreachable account and its reason", () => {
    const s = mailStatus({ ...none, unifiedErrors: [{ label: "work@example.com", message: "timeout" }] });
    expect(s?.key).toBe("mail.accountUnreachable");
    expect(s?.values).toEqual({ label: "work@example.com", message: "timeout" });
  });

  it("counts several instead of listing them", () => {
    // Five names with five reasons is a wall, not a warning.
    const s = mailStatus({
      ...none,
      unifiedErrors: [
        { label: "a", message: "x" },
        { label: "b", message: "y" },
        { label: "c", message: "z" },
      ],
    });
    expect(s?.key).toBe("mail.accountsUnreachable");
    expect(s?.values).toEqual({ count: 3 });
  });

  it("prefers the incomplete list over the merely old one", () => {
    // Missing accounts change WHAT you see; a stale cache only changes when.
    const s = mailStatus({ ...none, stale: true, unifiedErrors: [{ label: "a", message: "x" }] });
    expect(s?.key).toBe("mail.accountUnreachable");
  });

  it("distinguishes a stale copy from one being refreshed", () => {
    expect(mailStatus({ ...none, stale: true })?.key).toBe("mail.offlineCopy");
    expect(mailStatus({ ...none, stale: true, refreshing: true })?.key).toBe("mail.cachedRefreshing");
  });
});
