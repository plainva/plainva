import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where a browser sign-in opens (device finding 2026-10-28): the iPhone uses
 * the system's sign-in window and hands its answer to the app's URL route;
 * Android, and a shell without the plugin, open the browser.
 */
const state = vi.hoisted(() => ({
  platform: "ios",
  opened: [] as string[],
  routed: [] as string[],
  start: undefined as undefined | ((options: { url: string; callbackScheme: string }) => Promise<{ url: string }>),
  errors: [] as unknown[],
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: async ({ url }: { url: string }) => { state.opened.push(url); } } }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => state.platform },
  registerPlugin: () => new Proxy({}, { get: (_target, key) => (key === "start" ? state.start : undefined) }),
}));
vi.mock("../services/appUrlRoutes", () => ({ routeAppUrl: async (url: string) => { state.routed.push(url); } }));
vi.mock("../services/connectionToast", () => ({ connectionFailureToast: (error: unknown) => [String(error)] }));
vi.mock("@plainva/ui", async (original) => ({
  ...await original<typeof import("@plainva/ui")>(),
  toast: { error: (message: unknown) => { state.errors.push(message); } },
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("openSignInPage", () => {
  beforeEach(() => {
    state.platform = "ios";
    state.opened = [];
    state.routed = [];
    state.errors = [];
    state.start = undefined;
  });

  it("opens the system sign-in window on the iPhone and hands its answer to the app's URL route", async () => {
    const asked: { url: string; callbackScheme: string }[] = [];
    state.start = async (options) => { asked.push(options); return { url: "com.plainva.app://oauth?code=c&state=s" }; };
    const { openSignInPage } = await import("./webAuth");
    await openSignInPage("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1");
    await settle();
    expect(asked).toEqual([{ url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1", callbackScheme: "com.plainva.app" }]);
    expect(state.routed).toEqual(["com.plainva.app://oauth?code=c&state=s"]);
    expect(state.opened).toEqual([]);
  });

  it("stays quiet when the person closes the window, and tells any other failure", async () => {
    const { openSignInPage } = await import("./webAuth");
    const { getDiagnostics } = await import("@plainva/ui");
    state.start = async () => { throw Object.assign(new Error("closed"), { code: "CANCELLED" }); };
    await openSignInPage("https://example.test/a");
    await settle();
    expect(state.errors).toEqual([]);
    expect(getDiagnostics()[getDiagnostics().length - 1]?.message).toBe("the sign-in window was closed without an answer from the provider");
    state.start = async () => { throw Object.assign(new Error("the sign-in window could not open"), { code: "FAILED" }); };
    await openSignInPage("https://example.test/b");
    await settle();
    expect(state.errors).toHaveLength(1);
    expect(state.routed).toEqual([]);
  });

  it("opens the browser on Android, and on an iPhone build without the plugin", async () => {
    const { openSignInPage } = await import("./webAuth");
    state.platform = "android";
    state.start = async () => ({ url: "never" });
    await openSignInPage("https://example.test/android");
    state.platform = "ios";
    state.start = async () => { throw Object.assign(new Error("not implemented"), { code: "UNIMPLEMENTED" }); };
    await openSignInPage("https://example.test/old-build");
    await settle();
    expect(state.opened).toEqual(["https://example.test/android", "https://example.test/old-build"]);
    expect(state.routed).toEqual([]);
  });
});
