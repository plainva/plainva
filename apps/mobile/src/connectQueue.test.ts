import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ settings: new Map<string, unknown>(), fail: false }));
vi.mock("@plainva/ui", async original => ({ ...await original<typeof import("@plainva/ui")>(), getPlatformServices: () => ({ loadSettings: async () => ({
  get: async (key: string) => structuredClone(state.settings.get(key) ?? null),
  set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
  delete: async (key: string) => { state.settings.delete(key); },
  save: async () => { if (state.fail) throw Error("storage unavailable"); },
}) }) }));
vi.mock("./services/vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ id: "vault" }) }));
import { buildQueue, withCompleted, nextService, isExpired, QUEUE_TTL_MS, outcomeBelongsToRun, startConnectQueue, loadConnectQueue, recordConnectOutcome, advanceOnAccountsChanged, confirmConnectSelection, clearConnectQueue, skipConnectStep, runServices, prepareConnectVault, releaseConnectVault, markConnectSignedIn } from "./services/connectQueue";

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
  it("skips only the step on screen, keeps it in the run's services, and ends with an empty queue for the summary (E6)", async () => {
    await startConnectQueue("google", ["files", "calendar"], { vaultId: "vault", cloudAccountId: "account" });
    await skipConnectStep("calendar");
    expect((await loadConnectQueue())?.pending).toEqual(["files", "calendar"]);
    await skipConnectStep("files");
    let q = (await loadConnectQueue())!;
    expect(q.pending).toEqual(["calendar"]);
    expect(q.skipped).toEqual(["files"]);
    await skipConnectStep("calendar");
    q = (await loadConnectQueue())!;
    expect(q.pending).toEqual([]);
    expect(q.skipped).toEqual(["files", "calendar"]);
    // The consent scope of the run does not change because a step was skipped.
    expect(runServices(q)).toEqual(["files", "calendar"]);
  });
  it("a finished run's summary expires after the limit, counted from its last step; a prepared destination keeps only an unfinished run", () => {
    const q = buildQueue("google", ["files"], 1, { vaultId: "vault" })!;
    expect(isExpired({ ...q, preparedVaultId: "p" }, 1 + QUEUE_TTL_MS)).toBe(false);
    expect(isExpired({ ...q, preparedVaultId: "p", pending: [], done: ["files"] }, 1 + QUEUE_TTL_MS)).toBe(true);
  });
  it("releasing a turned-down destination forgets it, its old outcome, and restarts the time limit", async () => {
    await startConnectQueue("google", ["files"], { vaultId: "vault", cloudAccountId: "account" });
    let q = (await loadConnectQueue())!;
    await prepareConnectVault(q.context, "prepared", "key-a");
    await recordConnectOutcome(q.context, "files", { state: "cancelled" });
    const before = (await loadConnectQueue())!.createdAt;
    await releaseConnectVault(q.context, "prepared");
    q = (await loadConnectQueue())!;
    expect(q.preparedVaultId).toBeUndefined();
    expect(q.preparedDestinationKey).toBeUndefined();
    expect(q.outcomes.files).toBeUndefined();
    expect(q.createdAt).toBeGreaterThanOrEqual(before);
    // Another folder prepares its own destination now.
    await prepareConnectVault(q.context, "prepared-2", "key-b");
    expect((await loadConnectQueue())?.preparedVaultId).toBe("prepared-2");
  });
  it("reads a run saved before skipping existed", async () => {
    const q = buildQueue("google", ["calendar"], Date.now(), { vaultId: "vault" })!;
    const old = { ...q } as Partial<typeof q>;
    delete old.skipped;
    state.settings.set("mobileConnectQueue", old);
    await clearConnectQueue().catch(() => {});
    state.settings.set("mobileConnectQueue", old);
    await skipConnectStep("calendar");
    expect((await loadConnectQueue())?.skipped).toEqual(["calendar"]);
  });
  it("does not claim durable progress when storage fails", async () => {
    await startConnectQueue("google", ["calendar"]);
    const context = (await loadConnectQueue())!.context;
    state.fail = true;
    await expect(recordConnectOutcome(context, "calendar", { state: "connected", bindingId: "calendar" })).rejects.toThrow("storage unavailable");
    expect((await loadConnectQueue())!.outcomes).toEqual({});
  });
});

describe("the sign-in of a run that starts before it (settings plan 2026-10-29)", () => {
  it("is marked once it happened, for its own run only", async () => {
    await startConnectQueue("dropbox", ["files"], undefined, { signedIn: false });
    const run = (await loadConnectQueue())!;
    expect(run.signedIn).toBe(false);
    await markConnectSignedIn({ ...run.context, runId: "another" });
    expect((await loadConnectQueue())!.signedIn).toBe(false);
    await markConnectSignedIn(run.context);
    expect((await loadConnectQueue())!.signedIn).toBe(true);
  });
});
