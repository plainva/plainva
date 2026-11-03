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
vi.mock("@plainva/ui", () => ({ toast: { info: vi.fn(), progress: vi.fn(), dismiss: vi.fn(), error: vi.fn() } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));

import { checkForAppUpdate, getUpdatesManagedBy } from "./appUpdate";

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
