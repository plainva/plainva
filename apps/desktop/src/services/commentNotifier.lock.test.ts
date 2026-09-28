// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceCommentRecord } from "@plainva/core";
import type { CommentLockState, CommentNotificationNote } from "@plainva/ui";

/**
 * The desktop notifier on a locked vault, and with two vaults in one window
 * (plan Befunde 24.09., E7). The shared cycle has its own test; this one runs
 * the desktop's real wiring — its settings keys, its ledger, its tray line and
 * the system notification — against a store that lists nothing while locked,
 * the way the real stores do.
 */

const state = vi.hoisted(() => ({ settings: new Map<string, unknown>(), tray: [] as Array<[string, number]> }));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => structuredClone(state.settings.get(key)),
    set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
    delete: async (key: string) => state.settings.delete(key),
    keys: async () => [...state.settings.keys()],
    save: async () => {},
  }),
}));
vi.mock("./trayNext", () => ({ reportTrayComments: (vault: string, count: number) => { state.tray.push([vault, count]); } }));
const notification = vi.hoisted(() => ({ sendNotification: vi.fn(), isPermissionGranted: vi.fn(async () => true), requestPermission: vi.fn(async () => "granted") }));
vi.mock("@tauri-apps/plugin-notification", () => notification);

import { drawCommentBaseline, releaseCommentNotifierDeps, runCommentNotifications, setCommentNotifierDeps } from "./commentNotifier";
import { loadSeenComments, saveCommentNotificationSettings } from "./commentNotificationSettings";
import { getSettingsStore } from "./settingsStore";

function remark(commentId: string): WorkspaceCommentRecord {
  return {
    commentId,
    targetObjectId: "notes/Report.md",
    parentCommentId: null,
    authorMemberId: "them",
    authorDeviceId: "device-them",
    body: "The figure in paragraph three does not match",
    anchor: null,
    suggestion: null,
    createdAt: "2026-09-24T10:00:00.000Z",
    resolvedCommentId: null,
    resolvedAt: null,
  } as WorkspaceCommentRecord;
}

const VAULT = "C:/Vaults/Work";
let lock: CommentLockState = "open";
let comments: WorkspaceCommentRecord[] = [];

function register(vaultPath = VAULT) {
  setCommentNotifierDeps({
    vaultPath,
    lockState: async () => lock,
    // What a locked store answers: no remarks at all.
    listNotes: async (): Promise<CommentNotificationNote[]> => (lock === "locked" ? [] : [{ path: "notes/Report.md", comments }]),
    listNames: async () => new Map(),
    identity: async () => ({ memberId: "me", deviceId: null }),
    openComment: () => {},
    openOverview: () => {},
    isForeground: () => false,
  });
}

beforeEach(async () => {
  state.settings.clear();
  state.tray.length = 0;
  notification.sendNotification.mockClear();
  lock = "open";
  comments = [remark("c1")];
  const store = await getSettingsStore();
  await saveCommentNotificationSettings(store, VAULT, { enabled: true, level: "all", preview: true, mutedPaths: [] });
});

describe("desktop comment notifier", () => {
  it("c1 -> locked -> c1 again announces nothing the second time", async () => {
    register();
    expect((await runCommentNotifications(VAULT))?.kind).toBe("single");
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);

    lock = "locked";
    await runCommentNotifications(VAULT);
    expect([...(await loadSeenComments(await getSettingsStore(), VAULT))]).toEqual(["c1"]);

    lock = "open";
    expect((await runCommentNotifications(VAULT))?.kind).toBe("none");
    expect(notification.sendNotification).toHaveBeenCalledTimes(1);
  });

  it("a locked run leaves no tray line", async () => {
    register();
    lock = "locked";
    expect(await runCommentNotifications(VAULT)).toBeNull();
    expect(state.tray).toEqual([]);
  });

  it("switching on while locked draws no baseline", async () => {
    register();
    await drawCommentBaseline(VAULT);
    lock = "locked";
    await drawCommentBaseline(VAULT);
    expect([...(await loadSeenComments(await getSettingsStore(), VAULT))]).toEqual(["c1"]);
  });

  it("a cycle of another vault in the same window neither reads nor writes this vault's answers", async () => {
    register();
    const other = "C:/Vaults/Other";
    const store = await getSettingsStore();
    await saveCommentNotificationSettings(store, other, { enabled: true, level: "all", preview: true, mutedPaths: [] });
    expect(await runCommentNotifications(other)).toBeNull();
    expect([...(await loadSeenComments(store, other))]).toEqual([]);
    expect(notification.sendNotification).not.toHaveBeenCalled();
    expect(state.tray).toEqual([]);
  });

  it("the old vault's cleanup cannot remove the next vault's answers", async () => {
    register("C:/Vaults/Other");
    register(VAULT);
    releaseCommentNotifierDeps("C:/Vaults/Other");
    expect((await runCommentNotifications(VAULT))?.kind).toBe("single");
  });
});
