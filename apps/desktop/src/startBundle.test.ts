import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { aiSwitchDefault, aiSwitchOf, createAiSessionLoader, ensureAiIfOn } from "@plainva/ui";
import { aiDefaultSettings } from "@plainva/ui/ai";
import { readAiAppSettings } from "@plainva/core/ai";
import type { AiSession } from "@plainva/ui/ai";
import { barrelImports } from "../../../scripts/vite/barrelImports.mjs";
import { PACKAGE_BARRELS } from "../../../scripts/vite/packageBarrels.mjs";
import { localeArea, readLocaleAreas } from "../../../scripts/vite/localeAreas.mjs";

/**
 * What keeps the start bundle small (performance plan L5), held where a change would loosen it unnoticed. The bundle
 * gate (`scripts/perf/bundle-gate.mjs`) measures the result; these hold the parts it rests on.
 */
const UI = resolve(__dirname, "../../../packages/ui/src");
const read = (path: string) => readFileSync(path, "utf8");

describe("the AI's ports", () => {
  it("import nothing but types from the harness, so the start never carries it", () => {
    expect.hasAssertions();
    const dir = join(UI, "aiPorts");
    const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name));
    expect(files.length).toBeGreaterThanOrEqual(8);
    const loose: string[] = [];
    for (const name of files) {
      const source = read(join(dir, name));
      for (const m of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
        if (/^\.\.\/ai(\/|$)|^@plainva\/(ui|core)\/ai$/.test(m[2]!) && !m[1]) loose.push(`${name}: ${m[0].split("\n")[0]}`);
      }
      // The one way to the harness is the dynamic import of the loader.
      for (const m of source.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
        if (/ai/.test(m[1]!) && name !== "aiModule.ts") loose.push(`${name}: import("${m[1]}")`);
      }
    }
    expect(loose).toEqual([]);
  });

  it("read the device switch exactly as the harness does", () => {
    expect.hasAssertions();
    const fallbacks = [false, true];
    const stored: unknown[] = [undefined, null, "on", 1, {}, { enabled: true }, { enabled: false }, { enabled: "true" }, { enabled: 1 }, { providers: [] }];
    for (const fallback of fallbacks) {
      const defaults = { ...readAiAppSettings(undefined), enabled: fallback };
      for (const value of stored) expect(aiSwitchOf(value, fallback), JSON.stringify(value)).toBe(readAiAppSettings(value, defaults).enabled);
    }
    for (const channel of ["labs", "stable", "local", ""]) {
      const info = { channel, commit: "", branch: "", run: "" };
      expect(aiSwitchDefault(info), channel).toBe(aiDefaultSettings(info).enabled);
    }
  });
});

describe("the AI session loader", () => {
  const session = { id: "session" } as unknown as AiSession;

  it("makes the session once, however often it is asked, and says when it was asked", async () => {
    expect.hasAssertions();
    const make = vi.fn(async () => session);
    const loader = createAiSessionLoader(make);
    const heard = vi.fn();
    loader.subscribe(heard);
    expect(loader.session()).toBeNull();
    expect(loader.requested()).toBe(false);
    const [a, b] = await Promise.all([loader.ensure(), loader.ensure()]);
    expect(a).toBe(session);
    expect(b).toBe(session);
    expect(make).toHaveBeenCalledTimes(1);
    expect(loader.session()).toBe(session);
    expect(loader.requested()).toBe(true);
    expect(heard).toHaveBeenCalled();
  });

  it("asks again after a load that failed", async () => {
    expect.hasAssertions();
    const make = vi.fn().mockRejectedValueOnce(new Error("no chunk")).mockResolvedValueOnce(session);
    const loader = createAiSessionLoader(make);
    await expect(loader.ensure()).rejects.toThrow("no chunk");
    await expect(loader.ensure()).resolves.toBe(session);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("loads at the start only when the switch is on, and an unreadable switch counts as off", async () => {
    expect.hasAssertions();
    const off = createAiSessionLoader(vi.fn(async () => session));
    await expect(ensureAiIfOn(off, async () => false)).resolves.toBeNull();
    await expect(ensureAiIfOn(off, async () => Promise.reject(new Error("store")))).resolves.toBeNull();
    expect(off.requested()).toBe(false);
    const on = createAiSessionLoader(vi.fn(async () => session));
    await expect(ensureAiIfOn(on, async () => true)).resolves.toBe(session);
  });

  it("takes a session a surface of the AI made itself, and tells its readers after the render", async () => {
    expect.hasAssertions();
    const make = vi.fn(async () => session);
    const loader = createAiSessionLoader(make);
    const heard = vi.fn();
    loader.subscribe(heard);
    loader.adopt(session);
    expect(loader.session()).toBe(session);
    expect(heard).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(heard).toHaveBeenCalled());
    await expect(loader.ensure()).resolves.toBe(session);
    expect(make).not.toHaveBeenCalled();
  });
});

describe("named imports of the packages' entries go to the defining module in a build", () => {
  const plugin = barrelImports(PACKAGE_BARRELS) as unknown as { transform(code: string, id: string): { code: string } | null };
  const rewrite = (code: string) => plugin.transform(code, "/app/src/probe.ts")?.code ?? code;

  it("follows re-exports, renames and names a module hands on from another", () => {
    expect.hasAssertions();
    const out = rewrite('import { classifySyncError, VaultIndexer as Indexer } from "@plainva/core";\nimport { toast } from "@plainva/ui";');
    expect(out).toMatch(/import \{ classifySyncError \} from "[^"]*packages\/core\/src\/sync\/errorKind\.ts";/);
    expect(out).toMatch(/import \{ VaultIndexer as Indexer \} from "[^"]*packages\/core\/src\/vault\/VaultIndexer\.ts";/);
    expect(out).toMatch(/import \{ toast \} from "[^"]*packages\/ui\/src\/services\/toastStore\.ts";/);
    expect(out).not.toMatch(/from "@plainva\//);
    // One line per import: the line numbers of the file stay.
    expect(out.split("\n")).toHaveLength(2);
  });

  it("never steps over an entry that runs code of its own while it loads (the import adapters register there)", () => {
    expect.hasAssertions();
    const out = rewrite('import { defaultImportRegistry, ImportRegistry } from "@plainva/core/import";');
    expect(out).toMatch(/import \{ defaultImportRegistry, ImportRegistry \} from "[^"]*packages\/core\/src\/import\/index\.ts";/);
  });

  it("takes a dynamic import of names the same way, and leaves what it cannot place on the entry", () => {
    expect.hasAssertions();
    const dynamic = rewrite('const { getVaultTemplates } = await import("@plainva/ui");');
    expect(dynamic).toMatch(/import\("[^"]*packages\/ui\/src\/vaultTemplates\/registry\.ts"\)/);
    expect(dynamic).toContain("getVaultTemplates: __m0.getVaultTemplates");
    const unknown = 'import { notAnExportAnywhere } from "@plainva/ui";';
    expect(rewrite(unknown)).toBe(unknown);
  });

  it("places every value an entry exports on a module that declares it", () => {
    expect.hasAssertions();
    for (const [spec, entry] of Object.entries(PACKAGE_BARRELS)) {
      const names = [...read(entry).matchAll(/export \{([^}]*)\} from/g)].flatMap((m) => m[1]!.split(",")).map((x) => x.trim()).filter((x) => x && !x.startsWith("type ")).map((x) => x.split(/\s+as\s+/).pop()!);
      for (const name of names.slice(0, 40)) {
        const out = rewrite(`import { ${name} } from "${spec}";`);
        const placed = /import \{ (\w+)(?: as \w+)? \} from "([^"]+)"/.exec(out);
        expect(placed, `${spec}: ${name}`).not.toBeNull();
        const [, own, file] = placed!;
        if (file!.startsWith("@plainva/")) continue;
        expect(read(file!), `${own} in ${file}`).toMatch(new RegExp(`export (?:async )?(?:function\\*?|class|const|let|var|enum) ${own}\\b`));
      }
    }
  });
});

describe("the locale files by area", () => {
  it("cut each language into parts that are whole, apart, and fit together again", () => {
    expect.hasAssertions();
    const areas = readLocaleAreas();
    expect(Object.keys(areas).sort()).toEqual(["ai", "mail", "settings"]);
    const dir = join(UI, "locales");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const messages = JSON.parse(read(join(dir, file))) as Record<string, unknown>;
      const parts = ["core", ...Object.keys(areas)].map((area) => localeArea(messages, area, areas));
      const keys = parts.flatMap((part) => Object.keys(part));
      expect(new Set(keys).size, file).toBe(keys.length);
      expect(keys.sort(), file).toEqual(Object.keys(messages).sort());
      expect(Object.assign({}, ...parts), file).toEqual(messages);
    }
  });
});
