import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every purpose string iOS can demand of this app, checked against Info.plist.
 *
 * Apple rejects ITMS-90683 on what is IN THE BINARY, not on what the app calls.
 * A Capacitor plugin that merely names `NSSomethingUsageDescription` in its own
 * Swift source ships that literal in every build that links it, and the key has
 * to be present even where the app never reaches the API behind it.
 *
 * That is exactly how build 119 came back with a warning on 2026-09-23: the
 * place stamp asks `@capacitor/geolocation` for when-in-use authorisation and
 * nothing else, the Info.plist said so — and the plugin's own
 * `GeolocationConstants.swift` still carried
 * `NSLocationAlwaysAndWhenInUseUsageDescription`, which the scanner found.
 *
 * So the check is the same one Apple runs, and it needs no hand-kept table of
 * "which plugin wants which key": the plugins' sources are read, and every
 * literal they carry must be a key in Info.plist. A plugin added later brings
 * its own requirements along and fails here rather than after an upload.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(here, "..");
const require_ = createRequire(import.meta.url);

const KEY = /"(NS\w*UsageDescription)"/g;

/** Swift sources of one installed package, wherever the store put them. */
function swiftSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    let entries: string[];
    try {
      entries = readdirSync(at);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".swift")) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** Key -> the plugins that make it necessary. */
function required(): Map<string, string[]> {
  const manifest = JSON.parse(readFileSync(join(mobileRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const out = new Map<string, string[]>();
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!name.startsWith("@capacitor/")) continue;
    let root: string;
    try {
      root = dirname(require_.resolve(`${name}/package.json`));
    } catch {
      continue; // not a native plugin, or not resolvable from here
    }
    for (const file of swiftSources(join(root, "ios"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(KEY)) {
        out.set(match[1], [...new Set([...(out.get(match[1]) ?? []), name])]);
      }
    }
  }
  return out;
}

describe("iOS purpose strings", () => {
  const plist = readFileSync(join(mobileRoot, "ios", "App", "App", "Info.plist"), "utf8");
  const declared = new Set([...plist.matchAll(/<key>(NS\w*UsageDescription)<\/key>/g)].map((m) => m[1]));

  it("finds the plugins' own Swift sources at all", () => {
    // A resolution that silently finds nothing would make this test pass
    // forever without checking anything.
    expect(required().size).toBeGreaterThan(0);
  });

  it("declares every purpose string the linked plugins carry", () => {
    const missing = [...required()]
      .filter(([key]) => !declared.has(key))
      .map(([key, plugins]) => `${key} (from ${plugins.join(", ")})`);
    expect(
      missing,
      `Info.plist is missing ${missing.join("; ")} — Apple reads the string literals in the binary, ` +
        "so a plugin that merely names the key makes it mandatory (ITMS-90683).",
    ).toEqual([]);
  });

  it("gives every declared purpose string a real sentence", () => {
    // An empty or placeholder string passes the scanner and fails review.
    const bodies = [...plist.matchAll(/<key>(NS\w*UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g)];
    expect(bodies.length).toBe(declared.size);
    for (const [, key, text] of bodies) {
      expect(text.trim().length, `${key} has no purpose string`).toBeGreaterThan(30);
      expect(text, `${key} names the app`).toContain("Plainva");
    }
  });
});
