import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Every Tauri crate and its npm half stay on the same major.minor release
 * (found by the first Native Smoke run, 2026-09-29).
 *
 * `tauri build` refuses a pair that differs ("Found version mismatched Tauri
 * packages") — in the release workflow, not before: the regular CI checks,
 * lints and tests the Rust side but builds no binary. Dependabot moves the
 * cargo and the npm side in separate pull requests; #106 took
 * `tauri-plugin-http` to 2.7 while `@tauri-apps/plugin-http` stayed on 2.6, and
 * the next desktop release would have failed on it. Reading both lockfiles
 * here turns the pull request that moves one half red instead.
 */

const REPO = resolve(__dirname, "../../..");

/** Resolved crate versions from the desktop's Cargo.lock: `tauri` and every `tauri-plugin-*`. */
function crateVersions(): Map<string, string> {
  const lock = readFileSync(join(REPO, "apps/desktop/src-tauri/Cargo.lock"), "utf8").replace(/\r\n/g, "\n");
  const out = new Map<string, string>();
  for (const block of lock.split("[[package]]\n")) {
    const name = /^name = "([^"]+)"$/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"$/m.exec(block)?.[1];
    if (!name || !version) continue;
    if (name === "tauri" || name.startsWith("tauri-plugin-")) out.set(name, version);
  }
  return out;
}

/** Resolved `@tauri-apps/*` versions of the desktop app from pnpm-lock.yaml. */
function npmVersions(): Map<string, string> {
  const lock = readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8").replace(/\r\n/g, "\n");
  const start = lock.indexOf("\n  apps/desktop:\n");
  expect(start, "pnpm-lock.yaml has an importer for apps/desktop").toBeGreaterThanOrEqual(0);
  const next = lock.slice(start + 1).search(/\n {2}\S/);
  const importer = next < 0 ? lock.slice(start) : lock.slice(start, start + 1 + next);
  const out = new Map<string, string>();
  const lines = importer.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const name = /^ {6}'(@tauri-apps\/[a-z-]+)':$/.exec(lines[i]!)?.[1];
    if (!name) continue;
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const version = /^ {8}version: (\d+\.\d+\.\d+)/.exec(lines[j]!)?.[1];
      if (version) {
        out.set(name, version);
        break;
      }
    }
  }
  return out;
}

/** The npm package `tauri build` pairs with a crate, if there is one. */
function npmHalf(crate: string): string {
  return crate === "tauri" ? "@tauri-apps/api" : `@tauri-apps/${crate.slice("tauri-".length)}`;
}

const majorMinor = (version: string) => version.split(".").slice(0, 2).join(".");

describe("Tauri version pairs", () => {
  it("finds the pairs in both lockfiles", () => {
    const crates = crateVersions();
    const npm = npmVersions();
    const paired = [...crates.keys()].filter((crate) => npm.has(npmHalf(crate)));
    // The core crate and the plugins the desktop uses from both sides — a
    // parser that finds nothing must not pass the comparison below.
    expect(paired).toEqual(expect.arrayContaining(["tauri", "tauri-plugin-http", "tauri-plugin-fs", "tauri-plugin-updater"]));
    expect(paired.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps every crate and its npm half on the same major.minor, as tauri build demands", () => {
    const crates = crateVersions();
    const npm = npmVersions();
    const mismatched: string[] = [];
    for (const [crate, version] of crates) {
      const half = npm.get(npmHalf(crate));
      if (half && majorMinor(half) !== majorMinor(version)) mismatched.push(`${crate} ${version} / ${npmHalf(crate)} ${half}`);
    }
    expect(
      mismatched,
      "tauri build refuses mismatched Tauri packages. Move both halves to the same major.minor " +
        "(npm: a ~X.Y.0 range keeps pnpm from running ahead of the crate).\n  " +
        mismatched.join("\n  "),
    ).toEqual([]);
  });
});
