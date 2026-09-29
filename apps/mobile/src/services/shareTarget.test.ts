import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { fixtureShareTarget, listPendingShares, shareTarget, type PendingShare, type ShareTargetPort } from "./shareTarget";

/**
 * The share inbox's seam for production-bundle test runs (plan Befunde
 * 2026-09-24, E28) — the twin of the fixture SQLite bridge. Pinned here: in a
 * real build the seam is ABSENT. Without the runner's inbox a web build lists
 * nothing and never reaches for the plugin (on the web the plugin has no
 * implementation, so a call would reject), and on a device the plugin answers
 * even when something sits under the fixture key.
 */

const KEY = "__plainvaFixtureShareTarget";
const entry: PendingShare = { version: 1, id: "aaaaaaaa-1111-2222-3333-444444444444", createdAt: 1, status: "ready", text: "Buy stamps", subject: "", files: [] };

function install(port: Partial<ShareTargetPort>) {
  (globalThis as Record<string, unknown>)[KEY] = port;
}

function completeInbox() {
  return {
    listPendingShares: vi.fn(async () => ({ entries: [entry] })),
    readFileChunk: vi.fn(async () => ({ data: "" })),
    beginImport: vi.fn(async () => ({ entry })),
    markImported: vi.fn(async () => {}),
    finishShare: vi.fn(async () => {}),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[KEY];
  vi.restoreAllMocks();
});

describe("the share inbox of a test run", () => {
  it("is absent in a web build nobody installed it in: nothing is pending, the plugin is never asked", async () => {
    expect(fixtureShareTarget()).toBeNull();
    await expect(listPendingShares()).resolves.toEqual([]);
  });

  it("ignores a half-built inbox rather than trusting it", async () => {
    install({ listPendingShares: async () => ({ entries: [entry] }) });
    expect(fixtureShareTarget()).toBeNull();
    await expect(listPendingShares()).resolves.toEqual([]);
  });

  it("takes every call once a runner installed a complete inbox", async () => {
    const inbox = completeInbox();
    install(inbox);
    await expect(listPendingShares()).resolves.toEqual([entry]);
    await shareTarget.beginImport({ id: entry.id, plan: { version: 1, vaultId: "local", notePath: "Inbox/Buy stamps.md", noteText: "# Buy stamps\n", files: [] } });
    await shareTarget.markImported({ id: entry.id, note: true });
    await shareTarget.finishShare({ id: entry.id });
    expect(inbox.beginImport).toHaveBeenCalledTimes(1);
    expect(inbox.markImported).toHaveBeenCalledWith({ id: entry.id, note: true });
    expect(inbox.finishShare).toHaveBeenCalledWith({ id: entry.id });
  });

  it("never stands in for the native inbox on a device", () => {
    install(completeInbox());
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    expect(fixtureShareTarget()).toBeNull();
  });
});
