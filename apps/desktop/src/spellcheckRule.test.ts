import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The rule stays in one place only as long as nobody writes the attribute by
 * hand. A field may say `spellCheck={false}` for itself (a raw input for a
 * code); switching the checker ON is the rule's business alone.
 */
describe("nobody decides beside the rule", () => {
  const REPO = fileURLToPath(new URL("../../../", import.meta.url));
  const ROOTS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src"];
  /** The rule itself and the three places that apply it outside React. */
  const APPLIERS = new Set([
    "packages/ui/src/lib/spellcheck.ts",
    "packages/ui/src/components/ui/Field.tsx",
    "packages/ui/src/components/editorSession.ts",
    "packages/ui/src/components/spellcheckExemptions.ts",
    "packages/ui/src/components/LivePreviewPlugin.ts",
    "packages/ui/src/mail/composeSession.ts",
  ]);

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("no shipped file switches spell checking on by hand", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of sources(join(REPO, root))) {
        const rel = relative(REPO, file).replace(/\\/g, "/");
        if (APPLIERS.has(rel)) continue;
        const text = readFileSync(file, "utf8");
        // JSX: `spellCheck`, `spellCheck={true}`, `spellCheck="true"`, or a computed value.
        if (/\bspellCheck\b(?!=\{false\})/.test(text)) offenders.push(`${rel}: spellCheck`);
        // DOM: the attribute or the property written directly.
        if (/setAttribute\(\s*["']spellcheck["']|\.spellcheck\s*=[^=]|spellcheck:\s*["']/.test(text)) offenders.push(`${rel}: spellcheck`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("both shells start with an unchecked document root", () => {
    for (const shell of ["apps/desktop/index.html", "apps/mobile/index.html"]) {
      const html = readFileSync(join(REPO, shell), "utf8");
      expect(html, shell).toMatch(/<html\b[^>]*\bspellcheck="false"/);
    }
  });
});
