import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveMailRules, setMailPlatform, vacationSupport, writeVacation, type MailAccountConfig } from "@plainva/ui/mail";
import { setPlatformServices } from "@plainva/ui";

/**
 * The out-of-office notice (S13).
 *
 * One rule decides whether this feature is honest: it is offered ONLY where it
 * survives the machine being switched off. A switch that needs Plainva running
 * is a promise that breaks when someone closes the lid — so an account with
 * neither Sieve nor Graph must not get one.
 */

const imap = (over: Partial<MailAccountConfig> = {}): MailAccountConfig =>
  ({ id: "a1", label: "Mail", host: "imap.example.org", port: 993, user: "u@example.org", ...over }) as MailAccountConfig;

const creds = { host: "imap.example.org", port: 993, user: "u@example.org", pass: "pw" };

describe("where the notice is offered", () => {
  it("is not offered for a plain IMAP account", () => {
    // No Sieve, no Graph — nothing on the server would keep answering.
    expect(vacationSupport(imap())).toEqual({ kind: "none" });
  });

  it("uses Sieve when the account was told about a server", () => {
    expect(vacationSupport(imap({ sieveHost: "sieve.example.org" }))).toEqual({
      kind: "sieve",
      host: "sieve.example.org",
      port: 4190,
    });
  });

  it("does not GUESS a Sieve server from the IMAP host", () => {
    // A guessed host produces a switch that looks like it works and writes
    // nowhere — the one failure this feature must not have.
    expect(vacationSupport(imap({ host: "mail.mailbox.org" })).kind).toBe("none");
  });

  it("uses Graph for a Microsoft account", () => {
    expect(vacationSupport(imap({ kind: "microsoft" }))).toEqual({ kind: "graph" });
  });
});

describe("writing it", () => {
  const transport = {
    sieveGet: vi.fn(async (): Promise<{ name: string; body: string }> => ({ name: "work", body: "" })),
    sievePut: vi.fn(async (_creds: unknown, _args: { host: string; port: number; name: string; body: string }) => {}),
  };

  // Writing the notice now renders the WHOLE Plainva section (S15), so it has
  // to read the rules — which means this path needs a settings store.
  const store = new Map<string, unknown>();

  beforeEach(() => {
    store.clear();
    setPlatformServices({
      loadSettings: async () => ({
        get: async (k: string) => store.get(k),
        set: async (k: string, v: unknown) => void store.set(k, v),
        delete: async (k: string) => void store.delete(k),
        keys: async () => [...store.keys()],
        save: async () => {},
      }),
      credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
      openExternal: async () => {},
    } as never);
    transport.sieveGet.mockClear();
    transport.sievePut.mockClear();
    transport.sieveGet.mockImplementation(async () => ({ name: "work", body: "" }));
    setMailPlatform({
      transport: transport as never,
      http: { api: fetch, token: fetch },
    });
  });

  it("writes back into the script it read, not into one of its own", async () => {
    // Only the ACTIVE script runs; a second one would look like it worked.
    expect(await writeVacation("/v", imap({ sieveHost: "s.example.org" }), creds, { enabled: true, message: "weg" })).toBe(true);
    expect(transport.sievePut).toHaveBeenCalledWith(creds, expect.objectContaining({ name: "work" }));
  });

  it("carries a hand-written rule through untouched", async () => {
    transport.sieveGet.mockImplementation(async () => ({ name: "work", body: 'if header :contains "from" "chef" { fileinto "Wichtig"; }' }));
    await writeVacation("/v", imap({ sieveHost: "s.example.org" }), creds, { enabled: true, message: "weg" });
    const body = transport.sievePut.mock.calls[0][1].body;
    expect(body).toContain("chef");
    expect(body).toContain("vacation");
  });

  it("writes NOTHING into a script it cannot parse", async () => {
    // An unterminated marker means the file is in a state Plainva did not
    // produce. Overwriting it would eat whatever follows.
    transport.sieveGet.mockImplementation(async () => ({ name: "work", body: "# --- BEGIN PLAINVA (do not edit this section) ---\nvacation \"x\";" }));
    expect(await writeVacation("/v", imap({ sieveHost: "s.example.org" }), creds, { enabled: true, message: "weg" })).toBe(false);
    expect(transport.sievePut).not.toHaveBeenCalled();
  });

  it("refuses an account that has no server-side reply at all", async () => {
    expect(await writeVacation("/v", imap(), creds, { enabled: true, message: "weg" })).toBe(false);
    expect(transport.sievePut).not.toHaveBeenCalled();
  });

  it("keeps the server-side rules when the notice is switched off", async () => {
      // The reason S15 composes the section in one place: switching the notice
      // off used to render that half alone, which would delete every rule the
      // user had put on the server.
      await saveMailRules("/vault", [
        {
          id: "r1",
          name: "Newsletter",
          enabled: true,
          match: "all",
          conditions: [{ field: "from", op: "contains", value: "newsletter@" }],
          actions: [{ kind: "moveTo", mailbox: "Lesen" }],
        },
      ]);
      transport.sieveGet.mockImplementation(async () => ({ name: "work", body: "", capabilities: ["fileinto"] }));

      await writeVacation("/vault", imap({ sieveHost: "sieve.example.org" }), creds, { enabled: false, message: "" });

      const written = transport.sievePut.mock.calls[0][1].body;
      expect(written).toContain("fileinto");
      expect(written).toContain("newsletter@");
  });
});
