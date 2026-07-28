import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The iOS bridge contract, as a test.
 *
 * A Swift plugin is only reachable from JavaScript if it conforms to
 * `CAPBridgedPlugin` and declares `jsName` plus `pluginMethods`. Since
 * Capacitor 6 the bridge no longer discovers either through the Objective-C
 * runtime — but nothing fails to compile without them, the plugin registers
 * happily, and the app ships. The first sign is a user seeing
 * `"<name>" plugin is not implemented on ios` at runtime.
 *
 * That is exactly what happened to MailNetPlugin: written, registered, in the
 * Xcode project, shipped — and mail was dead on the entire platform until the
 * maintainer reported it on 2026-07-28. Four sibling plugins had the
 * conformance; this one did not, and no check compared them.
 *
 * So the rules below are checked mechanically:
 *   1. every plugin registered in MainViewController conforms to CAPBridgedPlugin
 *   2. …and declares a jsName and at least one pluginMethod
 *   3. every @objc method of that class appears in pluginMethods (a method the
 *      bridge cannot see is a silent "not implemented" on exactly one platform)
 *   4. every jsName the TypeScript side registers exists on the Swift side
 *
 * Textual analysis on purpose: it runs in the normal test suite on any OS,
 * needs no Xcode, and catches the mistake at commit time rather than after a
 * TestFlight round trip.
 */

const here = dirname(fileURLToPath(import.meta.url));
const iosAppDir = join(here, "..", "ios", "App", "App");
const adaptersDir = join(here, "adapters");

/**
 * Comments are stripped before anything is analysed. The first version of this
 * test searched the raw file for "CAPBridgedPlugin" — and passed on a class
 * that had lost the conformance, because the doc comment above it mentions the
 * word. A ratchet that is satisfied by prose is worse than none.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function readIfPresent(path: string): string | null {
  try {
    return withoutComments(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const mainViewController = readIfPresent(join(iosAppDir, "MainViewController.swift"));

/** Plugin class names the app registers with the bridge at startup. */
function registeredPlugins(source: string): string[] {
  return [...source.matchAll(/registerPluginInstance\(\s*([A-Za-z0-9_]+)\s*\(\s*\)\s*\)/g)].map((m) => m[1]);
}

/** `jsName` values the TypeScript side expects to find natively. */
function jsRegisteredNames(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(adaptersDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(adaptersDir, file), "utf8");
    for (const match of source.matchAll(/registerPlugin<[^>]*>\(\s*"([^"]+)"/g)) names.add(match[1]);
    for (const match of source.matchAll(/registerPlugin\(\s*"([^"]+)"/g)) names.add(match[1]);
  }
  return [...names];
}

describe("iOS plugin bridge contract", () => {
  it("MainViewController registers at least one plugin", () => {
    expect(mainViewController, "MainViewController.swift not found").not.toBeNull();
    expect(registeredPlugins(mainViewController!).length).toBeGreaterThan(0);
  });

  for (const plugin of mainViewController ? registeredPlugins(mainViewController) : []) {
    describe(plugin, () => {
      const source = readIfPresent(join(iosAppDir, `${plugin}.swift`));

      it("has a Swift file next to the others", () => {
        expect(source, `${plugin}.swift is registered but missing`).not.toBeNull();
      });

      it("conforms to CAPBridgedPlugin and declares jsName + pluginMethods", () => {
        // Checked on the class DECLARATION, not anywhere in the file.
        const declaration = new RegExp(`class\\s+${plugin}\\s*:([^{]*)\\{`).exec(source!);
        expect(declaration, `no class declaration found for ${plugin}`).not.toBeNull();
        expect(
          /\bCAPBridgedPlugin\b/.test(declaration![1]),
          `${plugin} does not conform to CAPBridgedPlugin — the bridge cannot see it and every call answers "not implemented on ios".`
        ).toBe(true);
        expect(/public let jsName = "[^"]+"/.test(source!), `${plugin} declares no jsName`).toBe(true);
        expect(/CAPPluginMethod\(name: "[^"]+"/.test(source!), `${plugin} declares no pluginMethods`).toBe(true);
      });

      it("exposes every @objc method through pluginMethods", () => {
        const objc = [...source!.matchAll(/@objc\s+func\s+([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
        const declared = new Set([...source!.matchAll(/CAPPluginMethod\(name: "([^"]+)"/g)].map((m) => m[1]));
        const missing = objc.filter((name) => !declared.has(name));
        expect(
          missing,
          `${plugin} implements ${missing.join(", ")} but does not list them in pluginMethods — those calls fail as "not implemented" on iOS only.`
        ).toEqual([]);
      });
    });
  }

  it("every plugin the TypeScript side registers exists natively with that jsName", () => {
    const declared = new Set(
      registeredPlugins(mainViewController!)
        .map((plugin) => readIfPresent(join(iosAppDir, `${plugin}.swift`)))
        .flatMap((source) => (source ? [...source.matchAll(/public let jsName = "([^"]+)"/g)].map((m) => m[1]) : []))
    );
    const missing = jsRegisteredNames().filter((name) => !declared.has(name));
    expect(
      missing,
      `registerPlugin() asks for ${missing.join(", ")}, but no iOS plugin declares that jsName.`
    ).toEqual([]);
  });
});
