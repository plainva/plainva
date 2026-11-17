import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which plugin call carries the largest message (release list F51): the meter
 * sits on `window.Capacitor.toNative`, measures the call on the way out and
 * its answer on the way in, keeps names and sizes only, and writes them down
 * soon enough that the next start still has them after a freeze.
 */

const store = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock("./capacitorPlatform", () => ({
  capacitorSettingsStore: {
    get: async (key: string) => store.values.get(key),
    set: async (key: string, value: unknown) => { store.values.set(key, JSON.parse(JSON.stringify(value))); },
  },
}));

const { bridgePeaks, installBridgeMeter, messageSize, resetBridgeMeterForTests } = await import("./bridgeMeter");
const { formatDiagnosticsExport } = await import("@plainva/ui");

type Stored = { resolve?: (data: unknown) => void };
const sent: Array<{ plugin: string; method: string }> = [];
/** What the native side answers, per method. */
const answers = new Map<string, unknown>();

beforeEach(() => {
  vi.useFakeTimers();
  store.values.clear();
  sent.length = 0;
  answers.clear();
  resetBridgeMeterForTests();
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    toNative: (plugin: string, method: string, _options: unknown, stored: Stored) => {
      sent.push({ plugin, method });
      queueMicrotask(() => stored.resolve?.(answers.get(`${plugin}.${method}`) ?? {}));
    },
  };
});

const call = (plugin: string, method: string, options: unknown) =>
  new Promise((resolve) => (globalThis as unknown as { Capacitor: { toNative: (...a: unknown[]) => void } }).Capacitor.toNative(plugin, method, options, { resolve }));

describe("the bridge meter", () => {
  it("measures about the length of a message's text, without its content", () => {
    expect(messageSize({ data: "x".repeat(1000) })).toBeGreaterThanOrEqual(1000);
    expect(messageSize({ values: Array.from({ length: 1000 }, () => ({ path: "p", n: 1 })) })).toBeGreaterThan(10_000);
  });

  it("keeps the largest call and the largest answer per method, names and sizes only", async () => {
    installBridgeMeter();
    await call("AtomicFile", "write", { path: "vaults/v1/Tagebuch.md", data: "x".repeat(300_000) });
    answers.set("CapacitorSQLite.query", { values: Array.from({ length: 20_000 }, () => ({ content: "y".repeat(40) })) });
    await call("CapacitorSQLite", "query", { statement: "SELECT" });
    await call("Preferences", "get", { key: "small" });
    const [run] = bridgePeaks();
    expect(run.peaks.map((peak) => `${peak.call} ${peak.direction}`)).toEqual(["CapacitorSQLite.query in", "AtomicFile.write out"]);
    expect(JSON.stringify(run)).not.toContain("Tagebuch");
    expect(sent.map((s) => `${s.plugin}.${s.method}`)).toEqual(["AtomicFile.write", "CapacitorSQLite.query", "Preferences.get"]);
  });

  it("writes the peaks down soon after, and the next start shows them as the run before", async () => {
    installBridgeMeter();
    await call("AtomicFile", "write", { data: "x".repeat(300_000) });
    await vi.advanceTimersByTimeAsync(2000);
    expect((store.values.get("bridge-peaks") as { peaks: unknown[] }).peaks).toHaveLength(1);

    // The next start: a new lifetime that reads the one before.
    resetBridgeMeterForTests();
    installBridgeMeter();
    await vi.advanceTimersByTimeAsync(0);
    const runs = bridgePeaks();
    expect(runs).toHaveLength(2);
    expect(runs[1].peaks[0]).toMatchObject({ call: "AtomicFile.write", direction: "out" });
    const text = formatDiagnosticsExport({ appVersion: "0.9.0", tauriVersion: "-", os: "android", language: "de", bridgePeaks: runs });
    expect(text).toContain("## Largest bridge messages");
    expect(text).toMatch(/The run before, from .*:\n {2}- AtomicFile\.write out \d+/);
  });
});
