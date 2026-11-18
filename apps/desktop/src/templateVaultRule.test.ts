import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `{{vault}}` is one name in both shells (B25 of release 0.9.0): the name the
 * vault goes by in the app, through `templateVaultName`. After the first fix
 * the phone still filled it in six places from the vault list's entry with a
 * fallback of their own — a new note and a daily note wrote "Plainva" where
 * an inserted template wrote "On this device", for the same vault. Whoever
 * fills `{{vault}}` asks the shell's one source; the sources ask the rule.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The shell's one source of the name a template gets. */
const SOURCE = /phoneTemplateVault\(|templateVaultOf\(|vaultAppName\(/;

describe("whoever fills {{vault}}", () => {
  it("takes the name from the shell's one source", () => {
    const offenders: string[] = [];
    for (const app of ["apps/desktop/src", "apps/mobile/src"]) {
      for (const file of sources(join(ROOT, app))) {
        const rel = relative(ROOT, file).split("\\").join("/");
        read(rel).split("\n").forEach((line, i) => {
          // A template's name for the vault, taken anywhere but from the one source — the
          // vault list's entry with a fallback of its own was the second rule this replaced.
          const fills = /templateContext: \{[^}]*vaultName:/.test(line) || /vaultName: \(await /.test(line) || /const vaultName = \(await /.test(line);
          if (fills && !SOURCE.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("and both sources go through the shared rule", () => {
    expect(read("apps/mobile/src/services/templateVault.ts")).toMatch(/vaultEntryName\(/);
    expect(read("apps/mobile/src/services/vaultEntryName.ts")).toMatch(/templateVaultName\(/);
    expect(read("apps/desktop/src/services/dailyNotes.ts")).toMatch(/templateVaultName\(/);
  });
});
