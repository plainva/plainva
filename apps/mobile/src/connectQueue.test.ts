import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ settings: new Map<string, unknown>(), fail: false }));
vi.mock("@plainva/ui", async original => ({ ...await original<typeof import("@plainva/ui")>(), getPlatformServices: () => ({ loadSettings: async () => ({
  get: async (key: string) => structuredClone(state.settings.get(key) ?? null),
  set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
  delete: async (key: string) => { state.settings.delete(key); },
  save: async () => { if (state.fail) throw Error("storage unavailable"); },
}) }) }));
vi.mock("./services/vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "vault" }) }));
import { buildQueue, withCompleted, nextService, isExpired, QUEUE_TTL_MS, outcomeBelongsToRun, startConnectQueue, loadConnectQueue, recordConnectOutcome, advanceOnAccountsChanged, confirmConnectSelection, clearConnectQueue } from "./services/connectQueue";

beforeEach(async () => { state.fail = false; await clearConnectQueue(); });
describe("exact account connection progress", () => {
  it("keeps provider capability filtering and files first", () => {
    expect(buildQueue("google", ["mail", "calendar", "files"], 1)?.pending).toEqual(["files", "calendar", "mail"]);
    expect(buildQueue("apple", ["mail", "calendar", "files"], 1)?.pending).toEqual(["calendar", "mail"]);
    expect(buildQueue("dropbox", ["calendar"], 1)).toBeNull();
  });
  it("retains a completed run for the result screen and rejects out-of-order completion", () => {
    const q = buildQueue("google", ["calendar", "mail"], 1)!;
    expect(withCompleted(q, "mail")).toBe(q);
    const done = withCompleted(withCompleted(q, "calendar"), "mail")!;
    expect(nextService(done)).toBeNull(); expect(done.done).toEqual(["calendar", "mail"]);
  });
  it("expires stale and future-clock runs", () => {
    const q = buildQueue("google", ["calendar"], 10)!;
    expect(isExpired(q, 10 + QUEUE_TTL_MS)).toBe(true);
    expect(isExpired(q, 9)).toBe(true);
    expect(isExpired(q, 11)).toBe(false);
  });
  it("only accepts results from the exact run, vault, account and step", () => {
    const q = buildQueue("google", ["calendar"], 1, { vaultId: "vault", cloudAccountId: "account" })!;
    expect(outcomeBelongsToRun(q, q.context, "calendar")).toBe(true);
    for (const changed of [{ vaultId: "other" }, { cloudAccountId: "other" }, { runId: "other" }]) expect(outcomeBelongsToRun(q, { ...q.context, ...changed }, "calendar")).toBe(false);
    expect(outcomeBelongsToRun(q, q.context, "mail")).toBe(false);
  });
  it("does not advance from a list event; an existing account succeeds without list growth", async () => {
    await startConnectQueue("google", ["calendar", "mail"], { vaultId: "vault", cloudAccountId: "account" });
    const q = (await loadConnectQueue())!;
    expect((await advanceOnAccountsChanged("calendar")).advanced).toBe(false);
    await recordConnectOutcome(q.context, "calendar", { state: "alreadyConnected", bindingId: "existing-calendar" });
    expect((await advanceOnAccountsChanged("calendar")).advanced).toBe(false);
    await confirmConnectSelection();
    expect((await advanceOnAccountsChanged("calendar")).next).toBe("mail");
    expect((await advanceOnAccountsChanged("calendar")).advanced).toBe(false);
    expect((await loadConnectQueue())?.outcomes.calendar).toEqual({ state: "alreadyConnected", bindingId: "existing-calendar" });
  });
  it("keeps an error on its step and ignores a late result from an abandoned run", async () => {
    await startConnectQueue("google", ["calendar"]);
    const context = (await loadConnectQueue())!.context;
    await recordConnectOutcome(context, "calendar", { state: "needsConsent" });
    expect((await advanceOnAccountsChanged("calendar")).advanced).toBe(false);
    await clearConnectQueue(); await startConnectQueue("google", ["calendar"]);
    await recordConnectOutcome(context, "calendar", { state: "connected", bindingId: "late" });
    expect((await loadConnectQueue())!.outcomes).toEqual({});
  });
  it("does not claim durable progress when storage fails", async () => {
    await startConnectQueue("google", ["calendar"]);
    const context = (await loadConnectQueue())!.context;
    state.fail = true;
    await expect(recordConnectOutcome(context, "calendar", { state: "connected", bindingId: "calendar" })).rejects.toThrow("storage unavailable");
    expect((await loadConnectQueue())!.outcomes).toEqual({});
  });
});
