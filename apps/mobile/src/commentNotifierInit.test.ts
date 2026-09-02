import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

/**
 * The untranslated-button finding, guarded rather than remembered (2026-08-22).
 *
 * `i18n.t` returns the KEY until the language file has loaded, importing a
 * module happens long before `await i18nReady` in the boot sequence, and Android
 * keeps a registered action type for the life of the process. The reminder
 * scheduler shipped that bug once; the plan for Stufe F warns that "the same
 * mistake is waiting here". These assertions are what makes the warning bind.
 *
 * Source assertions on purpose: the fault was never in the function, it was in
 * WHEN it ran. A behavioural test would have to boot Capacitor to see it.
 */
const strip = (source: string) =>
  // Comments first, so the prose above a line can never satisfy an assertion.
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("mobile comment notifier: registration order", () => {
  const source = strip(read("./services/commentNotifier.ts"));

  it("registers the action type only from the init function", () => {
    const init = source.slice(source.indexOf("export function initMobileCommentNotifier"));
    expect(init).toContain("registerActionTypes()");
    // Nothing outside a function body may call it: that is exactly the shape
    // that ran before i18n was ready.
    const topLevelCalls = source
      .split("\n")
      .filter((line) => /^\s*void\s+registerActionTypes\(\)/.test(line) && !line.startsWith("  "));
    expect(topLevelCalls).toEqual([]);
  });

  it("has no top-level side effect at all", () => {
    // Same rule the reminder scheduler carries: importing this module must do
    // nothing visible, or the ordering guarantee is void again.
    const topLevel = source.split("\n").filter((line) => /^void\s/.test(line));
    expect(topLevel).toEqual([]);
  });

  it("re-registers on a language change, so a switch mid-session takes effect", () => {
    expect(source).toContain('i18n.on("languageChanged"');
  });

  it("is called from the boot sequence after i18n is ready", () => {
    const boot = strip(read("./main.tsx"));
    const readyAt = boot.indexOf("await i18nReady");
    const initAt = boot.indexOf("initMobileCommentNotifier()");
    expect(readyAt).toBeGreaterThan(-1);
    expect(initAt).toBeGreaterThan(readyAt);
  });
});

describe("mobile comment notifier: the phone's two moments", () => {
  it("looks after a sideband cycle and on returning to the foreground", () => {
    const source = strip(read("./services/commentNotifier.ts"));
    expect(source).toContain('window.addEventListener("plainva-comments-synced"');
    const lifecycle = strip(read("./services/appLifecycle.ts"));
    expect(lifecycle).toContain("runMobileCommentNotifications");
  });

  it("fires the cycle event even when the comment step failed", () => {
    // In an encrypted workspace comments travel through the ordinary file sync,
    // so a sideband failure does not mean nothing arrived.
    const sync = strip(read("./services/mobileSettingsSync.ts"));
    const at = sync.indexOf('new CustomEvent("plainva-comments-synced")');
    expect(at).toBeGreaterThan(-1);
    const before = sync.slice(0, at);
    expect(before.lastIndexOf("catch")).toBeGreaterThan(before.lastIndexOf("await comments.run"));
  });
});
