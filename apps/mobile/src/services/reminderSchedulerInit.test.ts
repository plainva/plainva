import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Importing the reminder scheduler must have no visible effect.
 *
 * The finding this pins: the action types were registered at module top level,
 * which runs on import — long before `await i18nReady` in the boot sequence.
 * `i18n.t` returns the KEY until the language file has loaded, so the button on
 * the notification read "reminders.actionDone"; and because Android keeps a
 * registered action type for the life of the process, the raw key survived
 * until the next cold start.
 *
 * A behavioural test cannot catch a regression here — a re-added top-level
 * `void …` would still work in a test that imports the module after i18n is up.
 * The shape is the thing that has to stay gone, so the source is what gets
 * read. Same reason the mobile lint reads source: some contracts live in the
 * order of execution, not in a return value.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("reminder scheduler: nothing happens on import", () => {
  const source = read("./reminderScheduler.ts");

  it("has no top-level side effect", () => {
    // Top level = column zero. Anything indented sits inside a function, which
    // is exactly where these calls belong now.
    const topLevel = source
      .split("\n")
      .filter((line) => /^(void |await )/.test(line))
      .map((line) => line.trim());
    expect(topLevel).toEqual([]);
  });

  it("registers the action types inside an exported init", () => {
    expect(source).toMatch(/export function initReminderScheduler\(\)/);
    const body = source.slice(source.indexOf("export function initReminderScheduler()"));
    expect(body).toContain("registerActionTypes()");
    expect(body).toContain("localNotificationActionPerformed");
    expect(body).toContain("appStateChange");
  });

  it("re-registers when the language changes", () => {
    // Someone who switches language mid-session would otherwise keep the old
    // wording on every reminder the OS is already holding.
    expect(source).toMatch(/i18n\.on\("languageChanged"/);
  });

  it("is called after i18n is ready, not before", () => {
    const boot = read("../main.tsx");
    const i18nAt = boot.indexOf("await i18nReady");
    const initAt = boot.indexOf("initReminderScheduler();");
    expect(i18nAt).toBeGreaterThan(-1);
    expect(initAt).toBeGreaterThan(-1);
    expect(initAt).toBeGreaterThan(i18nAt);
  });

  it("gives each kind its own small icon", () => {
    // Android draws the small icon as a silhouette; without one of our own the
    // plugin falls back to ic_dialog_info and both kinds look identical.
    expect(source).toContain("ic_stat_task");
    expect(source).toContain("ic_stat_event");
  });

  it("ships the drawables it names", () => {
    // A name in the source and no file behind it is the worst version of this
    // bug: silent fallback to the platform default, only visible on a device.
    for (const icon of ["ic_stat_event", "ic_stat_task"]) {
      const xml = read(`../../android/app/src/main/res/drawable/${icon}.xml`);
      expect(xml).toContain("<vector");
      // Silhouette: the system repaints every non-transparent pixel, so a
      // coloured or stroked path would only ever look like a blob.
      expect(xml).toContain('android:fillColor="#FFFFFFFF"');
      expect(xml).not.toContain("strokeColor");
    }
  });
});
