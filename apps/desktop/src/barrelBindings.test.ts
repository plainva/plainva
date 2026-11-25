import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_BARRELS } from "../../../scripts/vite/packageBarrels.mjs";
import { barrelImports } from "../../../scripts/vite/barrelImports.mjs";

/**
 * The build plugin binds every value of every package entry to the declaration TypeScript binds (review of L5,
 * 2026-11-25; the reviewer's `probe-map.mjs`, taken over). For each value an entry exports, the plugin rewrites
 * `import { name } from "<entry>"`; the module and name it points at must resolve, by the type checker, to the very
 * declaration the entry's name resolves to — not only to a module that has something of that name.
 */
const ROOT = join(__dirname, "../../..");
const ts = createRequire(join(ROOT, "apps/desktop/package.json"))("typescript") as typeof import("typescript");

describe("the build plugin's map of the package entries", () => {
  it("binds every value export of every entry as TypeScript does", () => {
    expect.hasAssertions();
    const files = Object.values(PACKAGE_BARRELS) as string[];
    const program = ts.createProgram(files, {
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      paths: Object.fromEntries(Object.entries(PACKAGE_BARRELS).map(([spec, file]) => [spec, [file as string]])),
      baseUrl: ROOT,
    });
    const checker = program.getTypeChecker();
    const final = (symbol: import("typescript").Symbol) => {
      let s = symbol;
      while (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      return s;
    };
    // A `.mjs` module is read by TypeScript through the `.d.mts` beside it.
    const exportsOf = (file: string) => {
      const source = program.getSourceFile(file) ?? program.getSourceFile(file.replace(/\.mjs$/, ".d.mts"));
      const module = source && checker.getSymbolAtLocation(source);
      return new Map(module ? checker.getExportsOfModule(module).map((s) => [s.name, s] as const) : []);
    };
    const problems: string[] = [];
    let checked = 0;
    for (const [spec, file] of Object.entries(PACKAGE_BARRELS) as [string, string][]) {
      const exported = exportsOf(file);
      const values = [...exported].filter(([, s]) => final(s).flags & ts.SymbolFlags.Value).map(([name]) => name);
      const plugin = barrelImports(PACKAGE_BARRELS) as unknown as { buildStart(): void; transform(code: string, id: string): { code: string } | null };
      plugin.buildStart();
      const source = values.map((name, i) => `import { ${name} as __v${i} } from "${spec}";`).join("\n");
      const code = plugin.transform(source, join(ROOT, "apps/desktop/src/__probe.ts"))?.code ?? source;
      values.forEach((name, i) => {
        const m = new RegExp(`import \\{ ([\\w$]+) as __v${i} \\} from ("[^"]+")`).exec(code);
        if (!m) return void problems.push(`not rewritten readably: ${spec} ${name}`);
        const target = JSON.parse(m[2]!) as string;
        if (target === spec) return; // kept on the entry: binds as before
        checked += 1;
        const got = exportsOf(target).get(m[1]!);
        if (!got) return void problems.push(`${spec} ${name} → ${relative(ROOT, target)}#${m[1]}: no such export`);
        if (final(got) !== final(exported.get(name)!)) problems.push(`${spec} ${name} → ${relative(ROOT, target)}#${m[1]}: another declaration`);
      });
    }
    expect(checked, "values checked").toBeGreaterThan(5000);
    expect(problems).toEqual([]);
  }, 240_000);
});
