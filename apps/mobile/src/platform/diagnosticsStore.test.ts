import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The diagnostics' records lie where no backup takes them along (F51, second
 * review): not in the settings, which Android's cloud backup and iCloud carry.
 */

const fake = vi.hoisted(() => ({ platform: "android", files: new Map<string, string>(), settings: new Map<string, unknown>() }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => fake.platform, isNativePlatform: () => true }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path, directory }: { path: string; directory: string }) => {
      const data = fake.files.get(`${directory}:${path}`);
      if (data === undefined) throw Object.assign(new Error("missing"), { code: "OS-PLUG-FILE-0008" });
      return { data };
    },
    writeFile: async ({ path, directory, data }: { path: string; directory: string; data: string }) => { fake.files.set(`${directory}:${path}`, data); },
  },
}));
vi.mock("./capacitorPlatform", () => ({
  capacitorSettingsStore: {
    get: async (key: string) => fake.settings.get(key),
    delete: async (key: string) => fake.settings.delete(key),
  },
}));

const { readDiagnosticsRecord, writeDiagnosticsRecord } = await import("./diagnosticsStore");

beforeEach(() => {
  fake.files.clear();
  fake.settings.clear();
});

describe("diagnostics records", () => {
  it("lie in files/diagnostics on Android, which the backup rules leave out", async () => {
    fake.platform = "android";
    await writeDiagnosticsRecord("bridge-peaks", { peaks: [] });
    expect([...fake.files.keys()]).toEqual(["DATA:diagnostics/bridge-peaks.json"]);
    const rules = (await import("node:fs")).readFileSync(new URL("../../android/app/src/main/res/xml/data_extraction_rules.xml", import.meta.url), "utf8");
    // A list of what is included: diagnostics/ is not among it.
    expect(rules).toMatch(/<include domain="file" path="vault\/" \/>/);
    expect(rules).not.toMatch(/path="diagnostics/);
  });

  it("lie in Library/PlainvaDiagnostics on iOS", async () => {
    fake.platform = "ios";
    await writeDiagnosticsRecord("bridge-peaks", { peaks: [] });
    expect([...fake.files.keys()]).toEqual(["LIBRARY:PlainvaDiagnostics/bridge-peaks.json"]);
  });

  it("move out of the settings once, where an older version kept them", async () => {
    fake.platform = "android";
    fake.settings.set("bridge-peaks", { startedAt: "x", peaks: [{ call: "P.m" }] });
    expect(await readDiagnosticsRecord("bridge-peaks", "bridge-peaks")).toMatchObject({ startedAt: "x" });
    expect(fake.settings.has("bridge-peaks")).toBe(false);
    expect(fake.files.has("DATA:diagnostics/bridge-peaks.json")).toBe(true);
  });
});
