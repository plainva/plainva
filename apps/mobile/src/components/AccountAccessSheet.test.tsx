// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { GOOGLE_PHONE_CLIENT_ANCHOR, setPlatformServices } from "@plainva/ui";

/**
 * The phone's editor of its own Google client (issue 142).
 *
 * A Desktop-type client fails on the phone with redirect_uri_mismatch on
 * Google's own error page — Plainva never hears of it. So the editor says it in
 * advance: the type the phone needs, what the error means, and a link to the
 * guide's section on the iOS client (the desktop's side:
 * apps/desktop/src/googleClientType.test.tsx). When the answer does reach the
 * app, the toast names the phone's type and carries the same link.
 */

const platform = vi.hoisted(() => ({ value: "android" as "android" | "ios" }));
vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Capacitor: { getPlatform: () => platform.value, isNativePlatform: () => true },
}));
vi.mock("../services/accountSignIn", () => ({
  devicePlatform: () => platform.value,
  readDeviceAccess: vi.fn(async () => ({ source: "own", clientId: "" })),
  saveDeviceAccess: vi.fn(async () => {}),
}));

const opened: string[] = [];
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  opened.length = 0;
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async (url: string) => { opened.push(url); },
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the phone's own Google client", () => {
  for (const device of ["android", "ios"] as const) {
    it(`asks for an iOS client, explains redirect_uri_mismatch and links the guide's phone section (${device})`, async () => {
      platform.value = device;
      const { AccountAccessSheet } = await import("./AccountAccessSheet");
      await act(async () => {
        root.render(<AccountAccessSheet family="google" onCancel={vi.fn()} onSaved={vi.fn()} />);
      });
      await act(async () => {});
      const text = container.textContent ?? "";
      expect(text).toContain(i18n.t("accountAccess.ownType.ios"));
      expect(text).toContain(i18n.t("accountAccess.ownTypeMismatch.ios"));
      const link = container.querySelector<HTMLButtonElement>('[data-testid="oauth-access-google-guide"]');
      expect(link?.textContent).toBe(i18n.t("cloudAccounts.providerHelp", { provider: "Google" }));
      await act(async () => { link!.click(); });
      expect(opened).toEqual([`https://plainva.com/docs/google-drive-byo-guide#${GOOGLE_PHONE_CLIENT_ANCHOR}`]);
    });
  }

  it("names the phone's type in the toast of a refused client and offers the same guide", async () => {
    platform.value = "android";
    const { connectionFailureToast } = await import("../services/connectionToast");
    const [message, action] = connectionFailureToast(new Error("redirect_uri_mismatch"));
    expect(message).toBe(i18n.t("connection.googleClientWrongTypePhone"));
    expect(action?.label).toBe(i18n.t("cloudAccounts.providerHelp", { provider: "Google" }));
    action!.run();
    await act(async () => {});
    expect(opened).toEqual([`https://plainva.com/docs/google-drive-byo-guide#${GOOGLE_PHONE_CLIENT_ANCHOR}`]);
    // Any other failure keeps its sentence and gets no button.
    expect(connectionFailureToast(new Error("access_denied"))).toHaveLength(1);
  });
});
