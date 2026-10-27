// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import i18n from "@plainva/ui/i18n";
import {
  APP_LANGUAGES,
  GDRIVE_BYO_GUIDE,
  GOOGLE_PHONE_CLIENT_ANCHOR,
  OAuthAccessEditor,
  googleClientGuideUrl,
  isGoogleClientProblem,
  ownAccessGuideUrl,
  serviceConnectionMessage,
  setPlatformServices,
} from "@plainva/ui";
import { oauthErrorText } from "./services/oauthLoopback";

/**
 * A user's own Google client of the wrong type (issue 142).
 *
 * The phone returns through the app's scheme, which only an "iOS" client
 * allows; the desktop through a loopback port, which only a "Desktop app"
 * client allows. Google answers the wrong one with `redirect_uri_mismatch` —
 * and until now Plainva said "check the client type in the Google guide"
 * without naming the type or linking the guide. Now the sentence names the
 * type for the device, and the editor of the own client links the guide's
 * section for it in both shells (the phone's editor: AccountAccessSheet.test).
 */

const key = (k: string) => k;
const ROOT = join(__dirname, "..", "..", "..");

describe("the sentence for a Google client of the wrong type", () => {
  it("names the type this device needs", () => {
    const raw = "oauth error in redirect: redirect_uri_mismatch";
    expect(serviceConnectionMessage(raw, key, { platform: "desktop" })).toBe("connection.googleClientWrongTypeDesktop");
    expect(serviceConnectionMessage(raw, key, { platform: "android" })).toBe("connection.googleClientWrongTypePhone");
    expect(serviceConnectionMessage(new Error("Error 400: redirect_uri_mismatch"), key, { platform: "ios" })).toBe("connection.googleClientWrongTypePhone");
    // Without the device, both types are named.
    expect(serviceConnectionMessage("redirect_uri_mismatch", key)).toBe("connection.googleClientWrongType");
    // The desktop's one translation passes its platform.
    expect(oauthErrorText("oauth error in redirect: redirect_uri_mismatch")).toBe(i18n.t("connection.googleClientWrongTypeDesktop"));
  });

  it("keeps the other registration failures on their sentence, and marks all of them for the guide", () => {
    expect(serviceConnectionMessage("invalid_client", key)).toBe("connection.googleClientUnsupported");
    expect(serviceConnectionMessage("Custom URI scheme is not enabled for your Android client.", key)).toBe("connection.googleClientUnsupported");
    for (const raw of ["redirect_uri_mismatch", "invalid_client", "Custom URI scheme is not enabled"]) expect(isGoogleClientProblem(new Error(raw))).toBe(true);
    for (const raw of ["access_denied", "oauth loopback timed out", ""]) expect(isGoogleClientProblem(raw)).toBe(false);
  });
});

describe("the guide for an own Google client", () => {
  beforeEach(async () => { await i18n.changeLanguage("en"); });

  it("points a computer at the step-by-step guide and a phone at its iOS section", async () => {
    expect(googleClientGuideUrl("desktop")).toBe("https://plainva.com/docs/google-drive-byo-guide");
    expect(googleClientGuideUrl("android")).toBe(`https://plainva.com/docs/google-drive-byo-guide#${GOOGLE_PHONE_CLIENT_ANCHOR}`);
    expect(googleClientGuideUrl("ios", "de")).toBe(`https://plainva.com/de/docs/google-drive-byo-guide#${GOOGLE_PHONE_CLIENT_ANCHOR}`);
    expect(ownAccessGuideUrl("microsoft", "android")).toBe("https://plainva.com/docs/onedrive-and-dropbox-byo-guide");
  });

  it("finds the anchor's heading in every language of the handbook", () => {
    // github-slugger, as the website renders headings: lower case, punctuation
    // other than "-" dropped, every space a "-".
    const slug = (heading: string) => heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
    for (const { code } of APP_LANGUAGES) {
      const page = readFileSync(join(ROOT, "docs", "user", code, GDRIVE_BYO_GUIDE), "utf8");
      const headings = page.split("\n").filter((line) => line.startsWith("## ")).map((line) => slug(line.slice(3).trim()));
      expect(headings, `${code}: the phone section's heading`).toContain(GOOGLE_PHONE_CLIENT_ANCHOR);
      expect(page, `${code}: the section names the error`).toContain("redirect_uri_mismatch");
    }
  });
});

describe("the editor of the own client, on the desktop", () => {
  let container: HTMLDivElement;
  let root: Root;
  const opened: string[] = [];

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

  it("states the Desktop type, what redirect_uri_mismatch means, and links the guide", async () => {
    await act(async () => {
      root.render(<OAuthAccessEditor family="google" platform="desktop" value={{ source: "own", clientId: "" }} plainvaAvailable={false} onSave={vi.fn()} />);
    });
    const text = container.textContent ?? "";
    expect(text).toContain(i18n.t("accountAccess.ownType.desktop"));
    expect(text).toContain(i18n.t("accountAccess.ownTypeMismatch.desktop"));
    const link = container.querySelector<HTMLButtonElement>('[data-testid="oauth-access-google-guide"]');
    expect(link?.textContent).toBe(i18n.t("cloudAccounts.providerHelp", { provider: "Google" }));
    await act(async () => { link!.click(); });
    expect(opened).toEqual(["https://plainva.com/docs/google-drive-byo-guide"]);
  });

  it("links the Microsoft guide for a Microsoft client, without the Google sentence", async () => {
    await act(async () => {
      root.render(<OAuthAccessEditor family="microsoft" platform="desktop" value={{ source: "own", clientId: "" }} plainvaAvailable onSave={vi.fn()} />);
    });
    expect(container.textContent).not.toContain("redirect_uri_mismatch");
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="oauth-access-microsoft-guide"]')!.click(); });
    expect(opened).toEqual(["https://plainva.com/docs/onedrive-and-dropbox-byo-guide"]);
  });
});

describe("Plainva's Google clients in the release builds", () => {
  const workflow = (name: string) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8");

  it("hands the desktop release its Desktop client like the phones get theirs", () => {
    const release = workflow("release.yml");
    expect(release).toContain("VITE_PLAINVA_GOOGLE_MAIL_STATE: ${{ vars.VITE_PLAINVA_GOOGLE_MAIL_STATE }}");
    expect(release).toContain("VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_ID: ${{ vars.VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_ID }}");
    expect(release).toContain("VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_SECRET: ${{ secrets.VITE_PLAINVA_GOOGLE_DESKTOP_CLIENT_SECRET }}");
    expect(workflow("release-mobile.yml")).toContain("VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID: ${{ vars.VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID }}");
    expect(workflow("ios.yml")).toContain("VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: ${{ vars.VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID }}");
  });

  it("gives Labs its own clients and never the store app's", () => {
    const labs = workflow("labs-mobile.yml");
    expect(labs).toContain("VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: ${{ vars.VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID_LABS }}");
    expect(labs).toContain("VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID: ${{ vars.VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID_LABS }}");
    for (const storeClient of ["vars.VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID }}", "vars.VITE_PLAINVA_GOOGLE_ANDROID_CLIENT_ID }}", "DESKTOP_CLIENT"]) {
      expect(labs, storeClient).not.toContain(storeClient);
    }
  });
});
