import { describe, expect, it, vi } from "vitest";
import { buildGraphRules, buildRulesSection, runRules, type MailRule } from "@plainva/ui/mail";

/**
 * The rule action that files a message as a note (S17).
 *
 * It is the action no mail program has — and the one a mail SERVER cannot have
 * either, because it writes into the vault rather than into a mailbox. That has
 * a consequence worth pinning: a rule carrying it must stay local as a WHOLE.
 */

const rule = (over: Partial<MailRule> = {}): MailRule => ({
  id: "r1",
  name: "Rechnungen ablegen",
  enabled: true,
  match: "all",
  conditions: [{ field: "subject", op: "contains", value: "Rechnung" }],
  actions: [{ kind: "capture" }],
  ...over,
});

const ops = () => ({
  moveTo: vi.fn(async () => {}),
  markRead: vi.fn(async () => {}),
  flag: vi.fn(async () => {}),
  junk: vi.fn(async () => {}),
  trash: vi.fn(async () => {}),
  capture: vi.fn(async () => {}),
});

describe("running it", () => {
  it("files the matching message", async () => {
    const o = ops();
    const result = await runRules([rule()], [{ id: "1", subject: "Ihre Rechnung" }, { id: "2", subject: "Hallo" }], o);
    expect(o.capture).toHaveBeenCalledTimes(1);
    expect(o.capture).toHaveBeenCalledWith("1");
    expect(result.acted).toEqual(["1"]);
  });

  it("leaves the message in the folder, so the rest of the rule still applies", async () => {
    // Filing a COPY is not a move. Treating it as removing would swallow every
    // action that follows it.
    const o = ops();
    const result = await runRules([rule({ actions: [{ kind: "capture" }, { kind: "markRead" }] })], [{ id: "1", subject: "Rechnung" }], o);
    expect(o.markRead).toHaveBeenCalledTimes(1);
    expect(result.removed).toEqual([]);
  });

  it("fails only that message when the vault cannot be reached", async () => {
    const o = ops();
    o.capture.mockImplementationOnce(async () => { throw new Error("disk full"); });
    const result = await runRules([rule()], [{ id: "1", subject: "Rechnung" }, { id: "2", subject: "Rechnung" }], o);
    expect(result.acted).toEqual(["2"]);
  });

  it("says so instead of pretending, where filing is not available at all", async () => {
    const o = ops() as Partial<ReturnType<typeof ops>>;
    delete o.capture;
    const result = await runRules([rule()], [{ id: "1", subject: "Rechnung" }], o as never);
    expect(result.acted).toEqual([]);
  });
});

describe("it never goes to the server", () => {
  it("keeps a Sieve rule whole and local rather than uploading it without the filing", () => {
    // Uploading the rest would let the server move the message first and leave
    // nothing to file.
    const out = buildRulesSection([rule({ actions: [{ kind: "capture" }, { kind: "moveTo", mailbox: "Ablage" }] })]);
    expect(out.body).toBe("");
    expect(out.skipped).toEqual([{ id: "r1", reason: "localAction" }]);
  });

  it("does the same on Graph", () => {
    const out = buildGraphRules([rule({ actions: [{ kind: "capture" }, { kind: "markRead" }] })], new Map());
    expect(out.rules).toEqual([]);
    expect(out.skipped).toEqual([{ id: "r1", reason: "localAction" }]);
  });

  it("names it apart from what the server simply cannot do", () => {
    // Not "unsupported": the server lacks nothing. The action is Plainva's own.
    const server = buildRulesSection([rule({ actions: [{ kind: "junk" }] })], {});
    expect(server.skipped[0].reason).toBe("noMailbox");
  });
});
