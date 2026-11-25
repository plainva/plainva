import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { barrelImports } from "../../../scripts/vite/barrelImports.mjs";

/**
 * The build plugin that points imports of a package entry at the module that defines each name (performance plan
 * L5). It changes the production bundle, while the unit tests run on the sources as they are — so its own input
 * forms are held here, on a small package of its own: renamed, default, namespace and type imports, re-exports over
 * several steps, names exported twice, and modules that run code while they load. That no module ends up twice in a
 * build is held on the built bundle by the bundle gate (`scripts/perf/bundle-gate.mjs`).
 */
const root = mkdtempSync(join(tmpdir(), "barrel-imports-"));
const file = (rel: string, text: string) => {
  const at = join(root, rel);
  mkdirSync(join(at, ".."), { recursive: true });
  writeFileSync(at, text);
  return at;
};

file("pkg/a.ts", 'export function alpha() { return 1; }\nexport const beta = 2;\nexport class Gamma {}\nexport enum Delta { One }\nexport interface OnlyType { x: number }\nexport type Alias = string;\n');
file("pkg/b.ts", 'import { alpha } from "./a";\nexport { alpha as alphaAgain };\nexport async function epsilon() {}\nexport default function unnamed() {}\n');
file("pkg/deep/c.ts", "export const zeta = 3;\nexport const shared = 'deep';\n");
file("pkg/deep/index.ts", 'export * from "./c";\nexport { zeta as eta } from "./c";\n');
file("pkg/registers.ts", 'import { beta } from "./a";\nexport const registry: number[] = [];\nregistry.push(beta);\n');
file("pkg/withcode/index.ts", 'export * from "../deep/c";\nimport { registry } from "../registers";\nregistry.push(9);\n');
// An entry whose only code at load is an import for its effect (review of L5, 2026-11-25).
file("pkg/sideeffect/index.ts", 'import "../registers";\nexport * from "../deep/c";\n');
// A string that looks like the start of a comment must not swallow the exports after it.
file("pkg/strings.ts", 'export const pattern = "src/*.md";\nexport const after = 1;\nexport const tail = "*/";\n');
// Two stars that hand on one name from different modules: the language exports neither.
file("pkg/clash/one.ts", "export const twice = 1;\n");
file("pkg/clash/two.ts", "export const twice = 2;\n");
file("pkg/clash/index.ts", 'export * from "./one";\nexport * from "./two";\n');
file("pkg/broken.ts", "export const = ;\n");
const entry = file(
  "pkg/index.ts",
  [
    'export * from "./a";',
    'export * from "./b";',
    'export * from "./deep";',
    'export { beta as renamedBeta, type OnlyType as TypeAgain } from "./a";',
    'export * from "./strings";',
    '// The local declaration wins over the star.',
    'export const shared = "local";',
    "",
  ].join("\n"),
);
const withCode = join(root, "pkg/withcode/index.ts");
const plugin = barrelImports({
  "@pkg": entry,
  "@pkg/withcode": withCode,
  "@pkg/sideeffect": join(root, "pkg/sideeffect/index.ts"),
  "@pkg/clash": join(root, "pkg/clash/index.ts"),
  "@pkg/broken": join(root, "pkg/broken.ts"),
}) as unknown as { transform(code: string, id: string): { code: string } | null };
const rewrite = (code: string) => plugin.transform(code, join(root, "app/probe.ts"))?.code ?? code;
const at = (rel: string) => JSON.stringify(join(root, rel));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the build plugin's import forms", () => {
  it("points each named import at its module, renames kept, several modules split", () => {
    expect.hasAssertions();
    expect(rewrite('import { alpha, beta as b, Gamma, Delta } from "@pkg";')).toBe(`import { alpha, beta as b, Gamma, Delta } from ${at("pkg/a.ts")};`);
    const split = rewrite('import { alpha, epsilon } from "@pkg";');
    expect(split).toBe(`import { alpha } from ${at("pkg/a.ts")}; import { epsilon } from ${at("pkg/b.ts")};`);
  });

  it("follows re-exports over several steps, renamed ones, and a module's own re-export of a name it imported", () => {
    expect.hasAssertions();
    expect(rewrite('import { zeta } from "@pkg";')).toBe(`import { zeta } from ${at("pkg/deep/c.ts")};`);
    expect(rewrite('import { eta } from "@pkg";')).toBe(`import { zeta as eta } from ${at("pkg/deep/c.ts")};`);
    expect(rewrite('import { renamedBeta } from "@pkg";')).toBe(`import { beta as renamedBeta } from ${at("pkg/a.ts")};`);
    expect(rewrite('import { alphaAgain } from "@pkg";')).toBe(`import { alpha as alphaAgain } from ${at("pkg/a.ts")};`);
  });

  it("takes a name exported twice from where the language takes it: a local declaration before a star", () => {
    expect.hasAssertions();
    expect(rewrite('import { shared } from "@pkg";')).toBe(`import { shared } from ${at("pkg/index.ts")};`);
  });

  it("leaves default, namespace and type-only imports, and names it cannot place, on the entry", () => {
    expect.hasAssertions();
    for (const kept of [
      'import unnamed from "@pkg";',
      'import unnamed, { alpha } from "@pkg";',
      'import * as pkg from "@pkg";',
      'import type { OnlyType, Alias } from "@pkg";',
      'export * from "@pkg";',
      'const pkg = await import("@pkg");',
    ]) {
      expect(rewrite(kept), kept).toBe(kept);
    }
    // A type among values: types leave no import behind; a name no module declares stays on the entry.
    expect(rewrite('import { type OnlyType, alpha, Alias } from "@pkg";')).toBe(`import { alpha } from ${at("pkg/a.ts")}; import { Alias } from "@pkg";`);
  });

  it("rewrites a re-export and a dynamic import of names the same way", () => {
    expect.hasAssertions();
    expect(rewrite('export { alpha, zeta as z } from "@pkg";')).toBe(`export { alpha } from ${at("pkg/a.ts")}; export { zeta as z } from ${at("pkg/deep/c.ts")};`);
    const dynamic = rewrite('const { alpha, epsilon: e } = await import("@pkg");');
    expect(dynamic).toBe(`const { alpha, epsilon: e } = await Promise.all([import(${at("pkg/a.ts")}), import(${at("pkg/b.ts")})]).then(([__m0, __m1]) => ({ alpha: __m0.alpha, epsilon: __m1.epsilon }));`);
  });

  it("never steps over an entry that runs code while it loads", () => {
    expect.hasAssertions();
    expect(rewrite('import { zeta } from "@pkg/withcode";')).toBe(`import { zeta } from ${at("pkg/withcode/index.ts")};`);
  });

  it("never steps over an entry whose code at load is an import for its effect alone", () => {
    expect.hasAssertions();
    expect(rewrite('import { zeta } from "@pkg/sideeffect";')).toBe(`import { zeta } from ${at("pkg/sideeffect/index.ts")};`);
  });

  it("leaves an import written in a string, a template or a comment as it is", () => {
    expect.hasAssertions();
    for (const kept of [
      'const help = \'import { alpha } from "@pkg";\';',
      "const doc = `import { alpha } from \"@pkg\";`;",
      '// import { alpha } from "@pkg";\nconst x = 1;',
      '/* import { alpha } from "@pkg"; */ const y = 2;',
    ]) {
      expect(rewrite(kept), kept).toBe(kept);
    }
    // Beside a real one, only the real one changes.
    expect(rewrite('const s = "import { beta } from \'@pkg\'";\nimport { alpha } from "@pkg";')).toBe(`const s = "import { beta } from '@pkg'";\nimport { alpha } from ${at("pkg/a.ts")};`);
  });

  it("reads past a string that looks like a comment: the exports after it stay known", () => {
    expect.hasAssertions();
    expect(rewrite('import { after, tail } from "@pkg";')).toBe(`import { after, tail } from ${at("pkg/strings.ts")};`);
  });

  it("stops the build at a form it cannot place: a name two stars hand on, a module that does not parse", () => {
    expect.hasAssertions();
    expect(() => rewrite('import { twice } from "@pkg/clash";')).toThrow(/comes from two `export \*`/);
    expect(() => rewrite('import { anything } from "@pkg/broken";')).toThrow(/does not parse/);
  });

  it("keeps the lines of the file: every rewritten statement stays on its line", () => {
    expect.hasAssertions();
    const code = 'import { alpha,\n  epsilon,\n} from "@pkg";\nconst x = 1;';
    const out = rewrite(code);
    expect(out.split("\n")).toHaveLength(code.split("\n").length);
    expect(out.split("\n")[3]).toBe("const x = 1;");
    expect(out.split("\n")[0]).toBe(`import { alpha } from ${at("pkg/a.ts")}; import { epsilon } from ${at("pkg/b.ts")};`);
  });
});
