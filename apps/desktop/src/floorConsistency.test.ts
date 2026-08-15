import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The supported engine floor lives in five different kinds of file, and issue
 * #46 happened because two of them disagreed without anyone noticing: the
 * bundle required Safari 16.4 while the app declared macOS 10.13. Nothing held
 * them together, so the mismatch was invisible until a user sent a screenshot
 * of a blank window.
 *
 * This is the thing that holds them together. It does not decide the floor —
 * raising it is a product decision. It only makes sure that raising it in one
 * place and forgetting the other four fails here instead of on someone's Mac.
 *
 * NOT covered, and deliberately so: the website. It lives in a separate
 * repository (plainva/website, src/i18n/landing/*.ts) and carries the same
 * numbers; the release gate checklist carries that reminder instead.
 */

const FLOOR = {
  /** The engine that actually sets the bar. Lookbehind landed here. */
  safari: "safari16.4",
  /**
   * The oldest macOS whose SYSTEM WebView carries that engine — and on macOS
   * the OS version is the whole answer, not a rough filter.
   *
   * This number was wrong twice, both times in issue #46, and the second time
   * is the instructive one. It first said 13; a reporter on Monterey with
   * Safari 17.6 looked like proof that Safari carries the engine, so it was
   * lowered to 12 and written up as "the real bar is Safari 16.4". His next
   * report disproved it by measurement: the probe failed on that machine while
   * Safari really was 17.6. A Tauri app embeds WKWebView, which is a system
   * component — it moves with OS updates, and Safari.app can run far ahead of
   * it on a Mac Apple no longer updates. Monterey's WebView stops at Safari
   * 15.6.1 and no Safari download changes that.
   *
   * 13.3 rather than 13.0 because Ventura shipped with Safari 16.1 and only
   * reached 16.4 at 13.3 — the same trap in the other direction.
   */
  macOSVersion: "13.3",
  macOSName: "Ventura",
  /** The WebKitGTK series matching Safari 16.4 (WebKit merged lookbehind 2022-12-14). */
  webkitGtk: "2.40",
  /** Evergreen on Windows — named so a reader knows it is required at all. */
  windowsRuntime: "WebView2",
};

const desktopRoot = resolve(__dirname, "..");
const repoRoot = resolve(desktopRoot, "../..");

const read = (p: string) => readFileSync(p, "utf8");

describe("supported engine floor", () => {
  it("the bundle target names the floor", () => {
    const config = read(resolve(desktopRoot, "vite.config.ts"));
    // Pinned, not inherited: without an explicit target Vite's default moves
    // with every major release and takes the floor with it, unannounced.
    expect(config, "vite.config.ts must pin build.target").toMatch(/target:\s*\[/);
    expect(config).toContain(FLOOR.safari);
  });

  it("the mobile bundle target names the floor too", () => {
    // The phone had no target at all and inherited Vite's moving default, so
    // its floor was whatever the last dependency bump decided. It ships the
    // same shared packages as the desktop, so it carries the same bar — a scan
    // of its build finds lookbehind in two chunks of the startup chain.
    const config = read(resolve(repoRoot, "apps/mobile/vite.config.ts"));
    expect(config, "apps/mobile/vite.config.ts must pin build.target").toMatch(/target:\s*\[/);
    expect(config).toContain(FLOOR.safari);
  });

  it("the macOS bundle refuses to install below the floor", () => {
    const conf = JSON.parse(read(resolve(desktopRoot, "src-tauri/tauri.conf.json")));
    const min = conf?.bundle?.macOS?.minimumSystemVersion;
    expect(min, "bundle.macOS.minimumSystemVersion must be set").toBeTruthy();
    // Compared whole, not by major: the floor sits at a POINT release (13.3 is
    // the first Ventura carrying Safari 16.4), and a major-only check would
    // wave 13.0 through — the exact machine this is meant to stop.
    expect(String(min)).toBe(FLOOR.macOSVersion);
  });

  it("the boot guard tells the user the same numbers", () => {
    // It is the only thing a user below the floor ever sees. If it names a
    // different version than the app enforces, it sends them to the wrong fix.
    const guard = read(resolve(desktopRoot, "public/boot-guard.js"));
    expect(guard).toContain(`macOS ${FLOOR.macOSVersion} (${FLOOR.macOSName})`);
    expect(guard).toContain(`WebKitGTK ${FLOOR.webkitGtk}`);
    expect(guard).toContain(FLOOR.windowsRuntime);
  });

  it("the README names the same numbers", () => {
    const readme = read(resolve(repoRoot, "README.md"));
    expect(readme).toContain(`${FLOOR.macOSVersion} (${FLOOR.macOSName})`);
    expect(readme).toContain(FLOOR.webkitGtk);
    expect(readme).toContain(FLOOR.windowsRuntime);
  });

  it("every language of the user guide names the same numbers", () => {
    const userDocs = resolve(repoRoot, "docs/user");
    const languages = readdirSync(userDocs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    // Sanity: the guide is ten languages. A drop here would make the loop below
    // pass by checking nothing.
    expect(languages.length).toBeGreaterThanOrEqual(10);

    const missing: string[] = [];
    for (const lang of languages) {
      const page = read(resolve(userDocs, lang, "Getting_Started.md"));
      // Checked as separate tokens on purpose: zh-CN and ja write the
      // parentheses full-width, so "13.3 (Ventura)" would fail there for reasons
      // that have nothing to do with the floor.
      if (!page.includes(`macOS ${FLOOR.macOSVersion}`)) missing.push(`${lang}: macOS version`);
      if (!page.includes(FLOOR.macOSName)) missing.push(`${lang}: ${FLOOR.macOSName}`);
      if (!page.includes(FLOOR.webkitGtk)) missing.push(`${lang}: WebKitGTK ${FLOOR.webkitGtk}`);
      if (!page.includes(FLOOR.windowsRuntime)) missing.push(`${lang}: ${FLOOR.windowsRuntime}`);
    }

    expect(
      missing,
      `The engine floor moved somewhere but not everywhere. Missing:\n  ${missing.join("\n  ")}\n` +
        `Change FLOOR in this file AND every place it lists — including the website ` +
        `(separate repository, src/i18n/landing/*.ts), which this test cannot see.`,
    ).toEqual([]);
  });
});
