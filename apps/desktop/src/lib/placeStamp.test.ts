// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canStampPlace,
  formatPlace,
  PlaceError,
  placeStampEnabled,
  setPlaceProvider,
  setPlaceStampEnabled,
  stampPlace,
} from "@plainva/ui";

/**
 * The place stamp (plan Journal-Erweiterungen, X7/E6).
 *
 * Opt-in per device, off by default, and only ever on a deliberate press. What
 * is pinned here is the shape of that promise: no button without a switch AND
 * a receiver, one line of plain Markdown, and three failures that get three
 * different sentences because only one of them is worth offering again.
 */

afterEach(() => {
  setPlaceProvider(null);
  try { localStorage.clear(); } catch { /* a blocked store is not a failure */ }
});

describe("whether the button may exist at all", () => {
  it("needs a platform that can answer", () => {
    expect(canStampPlace()).toBe(false);
    setPlaceProvider(async () => ({ latitude: 0, longitude: 0 }));
    expect(canStampPlace()).toBe(true);
  });

  it("is off until this device says otherwise, and is remembered", () => {
    expect(placeStampEnabled()).toBe(false);
    setPlaceStampEnabled(true);
    expect(placeStampEnabled()).toBe(true);
    setPlaceStampEnabled(false);
    expect(placeStampEnabled()).toBe(false);
  });

  it("stays off when the store is blocked, which is the safe answer", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(placeStampEnabled()).toBe(false);
    expect(() => setPlaceStampEnabled(true)).not.toThrow();
    expect(placeStampEnabled()).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("the line it writes", () => {
  it("is plain Markdown anyone can read, edit or delete", () => {
    expect(formatPlace({ latitude: 52.52, longitude: 13.405 })).toBe("\u{1F4CD} 52.5200, 13.4050");
  });

  it("rounds to four decimals — which building, not which room", () => {
    // 52.5200666 and 52.5200777 are the same stamp: about eleven metres apart.
    expect(formatPlace({ latitude: 52.5200666, longitude: 13.4050111 })).toBe("\u{1F4CD} 52.5201, 13.4050");
    expect(formatPlace({ latitude: -33.8688, longitude: 151.2093 })).toBe("\u{1F4CD} -33.8688, 151.2093");
  });
});

describe("when it cannot answer", () => {
  it("says the device cannot, when nothing is registered", async () => {
    await expect(stampPlace()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("says the person refused, which is worth offering again", async () => {
    // A browser rejects with a numeric code; the phone plugin with a message.
    setPlaceProvider(() => Promise.reject(Object.assign(new Error("no"), { code: 1 })));
    await expect(stampPlace()).rejects.toMatchObject({ reason: "denied" });
    setPlaceProvider(() => Promise.reject(new Error("Location permission denied")));
    await expect(stampPlace()).rejects.toMatchObject({ reason: "denied" });
  });

  it("says it simply did not find a fix, which is a different sentence", async () => {
    setPlaceProvider(() => Promise.reject(Object.assign(new Error("timeout"), { code: 3 })));
    const error = await stampPlace().catch((e) => e);
    expect(error).toBeInstanceOf(PlaceError);
    expect(error.reason).toBe("failed");
  });

  it("hands back the line when it does answer", async () => {
    setPlaceProvider(async () => ({ latitude: 48.1372, longitude: 11.5756 }));
    await expect(stampPlace()).resolves.toBe("\u{1F4CD} 48.1372, 11.5756");
  });
});
