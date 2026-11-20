import { beforeEach, describe, expect, it, vi } from "vitest";

const sheet = vi.hoisted(() => ({ answer: null as string | null, last: null as null | { title: string; message?: string; options: Array<{ value: string; label: string; desc?: string }> } }));
const platform = vi.hoisted(() => ({ name: "android" as "android" | "ios" | null, folder: true }));

vi.mock("./mobileDialogs", () => ({
  mActions: vi.fn(async (opts: typeof sheet.last) => {
    sheet.last = opts;
    return sheet.answer;
  }),
}));
vi.mock("../platform/vaultFolder", () => ({
  currentVaultFolderPlatform: () => platform.name,
  isVaultFolderSupported: () => platform.folder,
}));

import i18n from "@plainva/ui/i18n";
import { chooseExistingVault, pickVaultTemplate } from "./firstStart";

beforeEach(() => {
  sheet.answer = null;
  sheet.last = null;
  platform.name = "android";
  platform.folder = true;
});

describe("pickVaultTemplate", () => {
  it("leads with the tour, marked as the recommended way in, then empty, then the rest", async () => {
    await pickVaultTemplate();
    const options = sheet.last!.options;
    expect(options[0].value).toBe("plainva");
    expect(options[0].desc).toBeTruthy();
    expect(options[1].value).toBe("");
    expect(options.slice(2).every((o) => o.value !== "plainva" && !o.desc)).toBe(true);
  });

  it("answers the tour's definition for the tour, and none for an empty vault", async () => {
    sheet.answer = "plainva";
    expect((await pickVaultTemplate())?.def?.id).toBe("plainva");
    sheet.answer = "";
    expect(await pickVaultTemplate()).toEqual({ id: "", def: null });
  });

  it("says nothing was chosen when the sheet is dismissed", async () => {
    expect(await pickVaultTemplate()).toBeNull();
  });
});

describe("chooseExistingVault", () => {
  it("on Android offers the folder and the cloud, with the Android guide", async () => {
    sheet.answer = "folder";
    expect(await chooseExistingVault()).toBe("folder");
    expect(sheet.last!.options.map((o) => o.value)).toEqual(["folder", "cloud"]);
    expect(sheet.last!.message).toBe(i18n.t("mobile.existingVaultGuideAndroid"));
    expect(sheet.last!.options[0].desc).toBe(i18n.t("mobile.existingVaultFolderAndroid"));
  });

  it("on iOS names the Files app instead", async () => {
    platform.name = "ios";
    await chooseExistingVault();
    expect(sheet.last!.message).toBe(i18n.t("mobile.existingVaultGuideIos"));
    expect(sheet.last!.options[0].desc).toBe(i18n.t("mobile.existingVaultFolderIos"));
  });

  it("without folder access offers only the cloud, and the guide says so", async () => {
    platform.name = null;
    platform.folder = false;
    sheet.answer = "cloud";
    expect(await chooseExistingVault()).toBe("cloud");
    expect(sheet.last!.options.map((o) => o.value)).toEqual(["cloud"]);
    expect(sheet.last!.message).toBe(i18n.t("mobile.existingVaultGuideCloudOnly"));
  });

  it("a dismissed sheet is no way in", async () => {
    expect(await chooseExistingVault()).toBeNull();
  });
});
