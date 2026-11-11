import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which installation may update itself.
 *
 * A copy that a package manager installed (the Nix package sets
 * `PLAINVA_UPDATES_MANAGED_BY` in its wrapper) carries the release identifier
 * but lives where the app cannot write. Every way to an update — the quiet
 * check at start-up and the button in the settings — goes through
 * `checkForAppUpdate`, so that one function must not even ask the update feed
 * for such a copy: no offer means nothing to install over itself.
 */

const invoke = vi.hoisted(() => vi.fn());
const getIdentifier = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/app", () => ({ getIdentifier }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("./settingsStore", () => ({ getSettingsStore: vi.fn() }));
vi.mock("@plainva/ui", () => ({ logDiagnostic: vi.fn(), toast: { info: vi.fn(), progress: vi.fn(), dismiss: vi.fn(), error: vi.fn() } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));

import { checkForAppUpdate, classifyUpdateFailure, describeUpdateFailure, getUpdatesManagedBy, resetStartupUpdateCheckForTests, scheduleStartupUpdateCheck } from "./appUpdate";
import { logDiagnostic, toast } from "@plainva/ui";

const release = { version: "9.9.9" };

beforeEach(() => {
  invoke.mockReset();
  getIdentifier.mockReset().mockResolvedValue("com.plainva.desktop");
  check.mockReset().mockResolvedValue(release);
});

describe("app update check", () => {
  it("never asks the update feed when a package manager updates this installation", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "app_updates_managed_by" ? "Nix" : undefined));
    const result = await checkForAppUpdate();
    expect(result).toEqual({ status: "managed", by: "Nix" });
    expect(check).not.toHaveBeenCalled();
  });

  it("offers a release to a release installation that updates itself", async () => {
    invoke.mockResolvedValue(null);
    const result = await checkForAppUpdate();
    expect(result).toEqual({ status: "available", update: release });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("treats a shell that cannot answer as one that updates itself", async () => {
    // An older shell without the command: the release identifier still decides.
    invoke.mockRejectedValue(new Error("command app_updates_managed_by not found"));
    expect(await getUpdatesManagedBy()).toBeNull();
    expect(await checkForAppUpdate()).toEqual({ status: "available", update: release });
  });

  it("does not offer a release to a dev or Labs build, managed or not", async () => {
    getIdentifier.mockResolvedValue("com.plainva.desktop.labs");
    invoke.mockResolvedValue(null);
    expect(await checkForAppUpdate()).toEqual({ status: "no-release" });
    expect(check).not.toHaveBeenCalled();
  });
});

/**
 * What the person reads when an update fails (R11). The words are the plugin's
 * own (tauri-plugin-updater 2.13, minisign-verify 0.2.5) as the updater
 * signature test records them from the built app; a refusal gets Plainva's
 * sentence, a missing connection its own, anything else the plugin's words.
 */
describe("a failed update, in words", () => {
  const t = (key: string, options?: Record<string, unknown>) => (options?.error ? `${key}|${String(options.error)}` : key);
  const refused = [
    "The signature verification failed",
    "The signature was created with a different key than the one provided",
    "The update was signed for version 9.9.8 but the update endpoint announced version 9.9.9. The endpoint response may have been tampered with to force installing a different release.",
    "The update signature does not specify the version it was signed for, which `requireSignedVersion` requires. Re-sign and re-publish this release, or disable `requireSignedVersion`.",
    "Invalid encoding in minisign data",
  ];

  it.each(refused)("names Plainva's refusal for: %s", (words) => {
    expect(classifyUpdateFailure(words)).toBe("refused");
    expect(describeUpdateFailure(words, "install", t)).toBe("settings.updateRefused");
    // The words of an Error object read the same as the plain string the IPC hands back.
    expect(describeUpdateFailure(new Error(words), "install", t)).toBe("settings.updateRefused");
  });

  it.each([
    "error sending request for url (https://github.com/plainva/plainva/releases/download/updater/latest.json)",
    "Network Error: Download request failed with status: 404 Not Found",
    "error sending request for url (http://127.0.0.1:1479/files/x): client error (Connect): tcp connect error: Connection refused (os error 111)",
  ])("names a missing connection for: %s", (words) => {
    expect(classifyUpdateFailure(words)).toBe("network");
    expect(describeUpdateFailure(words, "check", t)).toBe("settings.updateNoConnection");
  });

  it("keeps the plugin's own words for anything else, per step", () => {
    const words = "failed to replace the program: permission denied";
    expect(classifyUpdateFailure(words)).toBe("other");
    expect(describeUpdateFailure(words, "install", t)).toBe(`settings.updateInstallError|${words}`);
    expect(describeUpdateFailure(words, "check", t)).toBe(`settings.updateCheckError|${words}`);
  });

  it("never reads a refusal into an empty or unknown failure", () => {
    expect(classifyUpdateFailure("")).toBe("other");
    expect(classifyUpdateFailure(undefined)).toBe("other");
    expect(classifyUpdateFailure({})).toBe("other");
  });
});

describe("the start-up prompt, refused", () => {
  it("shows Plainva's refusal instead of the plugin's words and keeps them in the diagnostics", async () => {
    vi.useFakeTimers();
    // The schedule uses the window's timer; this suite runs without a DOM.
    vi.stubGlobal("window", globalThis);
    try {
      resetStartupUpdateCheckForTests();
      invoke.mockResolvedValue(null);
      const downloadAndInstall = vi.fn().mockRejectedValue("The signature verification failed");
      check.mockResolvedValue({ version: "9.9.9", downloadAndInstall });
      scheduleStartupUpdateCheck();
      await vi.advanceTimersByTimeAsync(10_000);
      const info = vi.mocked(toast.info);
      expect(info).toHaveBeenCalledTimes(1);
      const action = info.mock.calls[0][1] as { run: () => void };
      action.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(downloadAndInstall).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith("settings.updateRefused");
      expect(logDiagnostic).toHaveBeenCalledWith("update.install", "The signature verification failed");
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
