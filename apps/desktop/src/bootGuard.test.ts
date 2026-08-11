import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The boot guard is the one file in this app that has to run on an engine which
 * cannot parse the rest of it (issue #46; v0.3.0 before that). Everything that
 * makes that possible is a property of the FILE, not of the code inside it — so
 * it needs a guard of its own. Without these assertions, the next well-meant
 * "modernise the codebase" pass turns the safety net into a second victim of
 * the failure it reports.
 *
 * Note on eslint: the flat config marks this path ecmaVersion 5, but the
 * TypeScript parser is what actually reads it, and it accepts modern syntax
 * regardless. The check below is the real enforcement.
 */

const desktopRoot = resolve(__dirname, "..");
const guardPath = resolve(desktopRoot, "public/boot-guard.js");
const htmlPath = resolve(desktopRoot, "index.html");

/** Crude but sufficient for a file we write ourselves: strip comments and
 *  string literals so prose like "no imports" cannot trip the syntax scan. */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

describe("boot guard", () => {
  const source = readFileSync(guardPath, "utf8");
  const code = stripCommentsAndStrings(source);
  const html = readFileSync(htmlPath, "utf8");

  it("is loaded as a classic, blocking script — not a module", () => {
    // A module would be deferred AND parsed as part of the module graph: dead
    // in exactly the case it exists for.
    expect(html).toContain('<script src="/boot-guard.js"></script>');
    expect(html).not.toMatch(/<script[^>]*type="module"[^>]*boot-guard/);
  });

  it("has no imports and no module syntax", () => {
    expect(code).not.toMatch(/\bimport\s/);
    expect(code).not.toMatch(/\bexport\s/);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it("stays ES5 so an old engine can parse it", () => {
    const forbidden: Array<[RegExp, string]> = [
      [/=>/, "arrow function"],
      [/\bconst\s/, "const"],
      [/\blet\s/, "let"],
      [/\bclass\s/, "class"],
      [/`/, "template literal"],
      [/\?\./, "optional chaining"],
      [/\?\?/, "nullish coalescing"],
      [/\.\.\./, "spread"],
      [/\bcatch\s*\{/, "optional catch binding"],
    ];
    const found = forbidden.filter(([re]) => re.test(code)).map(([, name]) => name);
    expect(found, `boot-guard.js must stay ES5, found: ${found.join(", ")}`).toEqual([]);
  });

  it("still tests the two features that mark the supported floor", () => {
    // If someone drops the lookbehind probe, the guard silently stops covering
    // the failure it was written for.
    expect(source).toContain("(?<=a)b");
    expect(source).toContain("structuredClone");
  });

  it("names the version floor on screen, in both languages", () => {
    // "It doesn't work" would send the next reporter down the same road.
    // The macOS number deliberately is NOT repeated here — floorConsistency.test.ts
    // owns it and checks this same file against it. Two copies of a version
    // number are how it drifts. What is checked here is the shape: both language
    // blocks exist, and each one names the engine bar rather than just an OS.
    expect(source).toContain("WebKitGTK 2.40");
    expect(source).toContain("WebView2");
    expect(source).toContain("Plainva can't start on this system");
    expect(source).toContain("Plainva kann auf diesem System nicht starten");
    // Safari 16.4 is the actual bar on macOS; the OS version can only ever
    // approximate it, so the text has to say the former. Once per language —
    // counted with comments stripped, because the file explains itself there too.
    const visible = source.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(visible.match(/Safari 16\.4/g) || []).toHaveLength(2);
  });
});
