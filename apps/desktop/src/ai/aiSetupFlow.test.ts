import { describe, expect, it } from "vitest";
import { DEFAULT_AI_APP_SETTINGS } from "@plainva/core";
import { aiSetupOffer, aiSetupStart } from "@plainva/ui";

/** Plan Oberfläche O7, T9 (mockup M7): the setup in three steps — what it offers and where it starts. */
const state = (over: Partial<typeof DEFAULT_AI_APP_SETTINGS> = {}, keys: Record<string, boolean> = {}) => ({
  settings: { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: [], custom: [], profiles: {}, ...over },
  keys,
  tests: {},
});

describe("the AI setup's offer", () => {
  it("offers the system's own model first where the device has one, then a key of one's own, then an own server", () => {
    const android = aiSetupOffer(state(), "android");
    expect(android.kinds).toEqual(["device", "cloud", "server"]);
    expect(android.device?.id).toBe("gemini-nano");
    expect(aiSetupOffer(state(), "ios").device?.id).toBe("apple");
  });

  it("offers no device step where the system brings no model", () => {
    const web = aiSetupOffer(state(), null);
    expect(web.kinds).toEqual(["cloud", "server"]);
    expect(web.device).toBeNull();
  });

  it("lists the clouds before the gateways, and nothing that runs on a computer", () => {
    const { cloud } = aiSetupOffer(state(), "android");
    expect(cloud.length).toBeGreaterThan(0);
    const kinds = cloud.map((p) => p.kind);
    expect(kinds.every((k) => k === "cloud" || k === "gateway")).toBe(true);
    expect(kinds.indexOf("gateway") === -1 || kinds.lastIndexOf("cloud") < kinds.indexOf("gateway")).toBe(true);
  });
});

describe("where the AI setup starts", () => {
  it("starts with the provider while none is set up", () => {
    expect(aiSetupStart(state())).toEqual({ step: 1, providerId: null });
  });

  it("starts at the first Hello, with that provider, once a provider is there but no model", () => {
    expect(aiSetupStart(state({ providers: ["anthropic"] }, { anthropic: true }))).toEqual({ step: 3, providerId: "anthropic" });
  });

  it("prefers a provider that can answer — one with its key — over one still missing it", () => {
    expect(aiSetupStart(state({ providers: ["anthropic", "openai"] }, { openai: true })).providerId).toBe("openai");
  });
});
