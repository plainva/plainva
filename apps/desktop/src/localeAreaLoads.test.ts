import { describe, expect, it } from "vitest";
import { createAreaLoading } from "../../../packages/ui/src/lib/localeAreaLoads";

/**
 * A locale area that could not be loaded is loaded again (review of L5, 2026-11-25): the load once kept its
 * failure until the app restarted — the AI's, the settings' or mail's texts read as keys, and switching to that
 * language failed every time.
 */
describe("the locale areas' loads", () => {
  const noWait = () => Promise.resolve();

  it("tries a failed area again at once, and lands it", async () => {
    expect.hasAssertions();
    let calls = 0;
    const added: string[] = [];
    const loading = createAreaLoading({
      loaders: { ai: async () => { calls++; if (calls < 3) throw new Error("offline"); return { ai: {} }; }, mail: async () => ({ mail: {} }) },
      add: (code, messages) => added.push(`${code}:${Object.keys(messages).join()}`),
      wait: noWait,
    });
    await loading.load("de");
    expect(calls).toBe(3);
    expect(added.sort()).toEqual(["de:ai", "de:mail"]);
    expect(loading.failed()).toEqual([]);
  });

  it("gives up after its tries, keeps no failure, and loads on the next ask only what is missing", async () => {
    expect.hasAssertions();
    let online = false;
    const asked: string[] = [];
    const loading = createAreaLoading({
      loaders: {
        ai: async (code) => { asked.push(`ai:${code}`); if (!online) throw new Error("offline"); return {}; },
        mail: async (code) => { asked.push(`mail:${code}`); return {}; },
      },
      add: () => undefined,
      wait: noWait,
    });
    await expect(loading.load("de")).rejects.toThrow("offline");
    expect(asked.filter((a) => a === "ai:de")).toHaveLength(3);
    expect(loading.failed()).toEqual(["de"]);
    expect(loading.pending("de", "ai")).toBe(false);
    online = true;
    asked.length = 0;
    await loading.load("de");
    expect(asked).toEqual(["ai:de"]);
    expect(loading.failed()).toEqual([]);
  });

  it("an area is pending while it is on its way, and one load serves two asks", async () => {
    expect.hasAssertions();
    let release!: () => void;
    let calls = 0;
    const loading = createAreaLoading({
      loaders: { settings: () => { calls++; return new Promise((resolve) => { release = () => resolve({}); }); } },
      add: () => undefined,
      wait: noWait,
    });
    const first = loading.load("fr");
    const second = loading.load("fr");
    expect(loading.pending("fr", "settings")).toBe(true);
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(loading.pending("fr", "settings")).toBe(false);
  });
});
