import { describe, it, expect, vi, beforeEach } from "vitest";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

import { scanVaultOkf, runOkfConversion, type OkfConversionAdapter } from "./okfConversion";

function makeAdapter(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const adapter: OkfConversionAdapter = {
    readTextFile: async (p) => {
      const c = store.get(p);
      if (c === undefined) throw new Error(`missing ${p}`);
      return c;
    },
    writeTextFile: async (p, c) => {
      store.set(p, c);
    },
    createDir: async (p) => {
      dirs.add(p);
    },
    exists: async (p) => store.has(p) || dirs.has(p),
  };
  return { store, dirs, adapter };
}

beforeEach(() => {
  for (const k of Object.keys(storeValues)) delete storeValues[k];
});

describe("scanVaultOkf", () => {
  it("scans indexed markdown files, excluding the configured template folder", async () => {
    const { adapter } = makeAdapter({
      "a.md": "# x\n",
      "Templates/t.md": "# t\n",
    });
    const queryService = {
      db: { query: async () => [{ path: "a.md" }, { path: "Templates/t.md" }] },
    } as any;
    const result = await scanVaultOkf({ vaultPath: "/v", queryService, adapter });
    expect(result.scanned).toBe(1);
    expect(result.violations).toEqual([{ path: "a.md", kind: "missing-frontmatter" }]);
  });
});

describe("runOkfConversion", () => {
  const scanFor = (paths: string[]) =>
    ({ scanned: paths.length, violations: [], convertiblePaths: paths, typedPaths: [] }) as any;

  it("converts files, writes backups first and reports counts", async () => {
    const { store, adapter } = makeAdapter({
      "a.md": "# no frontmatter\n",
      "b.md": '---\ntype: Note\nokf_version: "0.1"\n---\nBody\n',
    });

    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md", "b.md"]),
      options: { defaultType: "Note" },
    });

    expect(report.changed).toEqual(["a.md"]);
    expect(report.unchanged).toBe(1);
    expect(report.skipped).toEqual([]);
    expect(store.get("a.md")).toContain("type: Note");
    // Backup carries the pre-conversion content.
    const backupPath = `${report.backupDir}/a.md`;
    expect(store.get(backupPath)).toBe("# no frontmatter\n");
    expect(report.samples[0]?.path).toBe("a.md");
  });

  it("dry run changes nothing on disk but reports what would change", async () => {
    const { store, adapter } = makeAdapter({ "a.md": "# x\n" });
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md"]),
      options: { defaultType: "Note" },
      dryRun: true,
    });
    expect(report.changed).toEqual(["a.md"]);
    expect(store.get("a.md")).toBe("# x\n");
    expect(report.backupDir).toBe("");
  });

  it("skips files that cannot be edited safely and keeps going", async () => {
    const { store, adapter } = makeAdapter({
      "broken.md": "---\n[broken\n---\n",
      "ok.md": "# x\n",
    });
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["broken.md", "ok.md"]),
      options: { defaultType: "Note" },
    });
    expect(report.skipped.length).toBe(1);
    expect(report.skipped[0].path).toBe("broken.md");
    expect(store.get("broken.md")).toBe("---\n[broken\n---\n");
    expect(report.changed).toEqual(["ok.md"]);
  });

  it("stops at the cancellation flag", async () => {
    const { adapter } = makeAdapter({ "a.md": "# x\n", "b.md": "# y\n" });
    let calls = 0;
    const report = await runOkfConversion({
      adapter,
      scan: scanFor(["a.md", "b.md"]),
      options: { defaultType: "Note" },
      isCancelled: () => calls++ >= 1,
    });
    expect(report.cancelled).toBe(true);
    expect(report.changed.length).toBe(1);
  });
});
