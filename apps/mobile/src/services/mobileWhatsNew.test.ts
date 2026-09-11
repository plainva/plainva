import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Which release dialog a start owes the user (BS5).
 *
 * This had no test, and that is how two welcomes ended up in a row: the sheet
 * carried a `firstRun` branch that could only appear right AFTER the onboarding
 * screen — which is itself the welcome on this platform. The rules below are
 * the merge: the onboarding welcomes, this sheet only ever says what changed.
 */

const store = {
  values: new Map<string, unknown>(),
  get: vi.fn(async (k: string) => store.values.get(k)),
  set: vi.fn(async (k: string, v: unknown) => void store.values.set(k, v)),
  save: vi.fn(async () => undefined),
  delete: vi.fn(async (k: string) => void store.values.delete(k)),
};

const appInfo = vi.hoisted(() => ({ version: "9.9.9", release: "9.9.9", revision: undefined as string | undefined }));

vi.mock("@plainva/ui", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui")>("@plainva/ui");
  return {
    ...actual,
    getPlatformServices: () => ({ loadSettings: async () => store }),
    getLatestWhatsNew: () => ({ ...actual.getLatestWhatsNew(), version: appInfo.release, contentRevision: appInfo.revision }),
  };
});

vi.mock("@capacitor/app", () => ({
  App: { getInfo: async () => ({ version: appInfo.version }) },
}));

import { pendingReleaseDialog, markReleaseDialogSeen, resetMobileWhatsNew } from "./mobileWhatsNew";

beforeEach(() => {
  store.values.clear();
  appInfo.version = "9.9.9";
  appInfo.release = "9.9.9";
  appInfo.revision = undefined;
});

describe("pendingReleaseDialog", () => {
  it("shows changed internal-build copy once without changing the marketing version", async () => {
    store.values.set("whatsNewSeenReleaseMobile", "9.9.9");
    appInfo.revision = "accounts";
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });
  it("says nothing to a fresh install — the onboarding screen is the welcome", async () => {
    expect(await pendingReleaseDialog(false)).toBe("none");
  });

  it("shows the highlights to someone who was here before the marker existed", async () => {
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
  });

  it("shows them once after an update, then not again", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.8");
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");

    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("stays quiet when the onboarding finished and marked the version seen", async () => {
    // What finishOnboarding does: mark, then set the flag.
    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("treats a four-part Android test build as its three-part release", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.9");
    appInfo.version = "9.9.9.4";

    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("shows the next release after a four-part Android test build", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.9.4");
    appInfo.version = "9.9.10";
    appInfo.release = "9.9.10";

    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
  });

  it("never blocks the start when the store cannot be read", async () => {
    store.get.mockRejectedValueOnce(new Error("locked"));
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("shows each catalog release once while iOS keeps marketing version 1.0", async () => {
    appInfo.version = "1.0";
    store.values.set("whatsNewSeenVersionMobile", "1.0");
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
    await markReleaseDialogSeen();
    expect(store.values.get("whatsNewSeenReleaseMobile")).toBe("9.9.9");
    expect(await pendingReleaseDialog(true)).toBe("none");
    appInfo.release = "9.9.10";
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
    await markReleaseDialogSeen();
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("migrates a matching legacy Android marker without repeating the dialog", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.9.4");
    expect(await pendingReleaseDialog(true)).toBe("none");
    expect(store.values.get("whatsNewSeenReleaseMobile")).toBe("9.9.9");
    appInfo.version = "9.9.9.5";
    expect(await pendingReleaseDialog(true)).toBe("none");
  });

  it("clears both markers when the user requests the highlights again", async () => {
    store.values.set("whatsNewSeenVersionMobile", "9.9.9");
    await markReleaseDialogSeen();
    await resetMobileWhatsNew();
    expect(await pendingReleaseDialog(true)).toBe("whatsNew");
    expect(await pendingReleaseDialog(false)).toBe("none");
  });
});
