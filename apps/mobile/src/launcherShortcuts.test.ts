import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Launcher shortcuts (Android) and Home Screen quick actions (iOS) are ONE list
 * (plan Journal, J4): the same entries, the same labels in ten languages, and
 * every entry is an intent the web layer actually runs. The iOS titles live in
 * a Swift table generated from the Android strings; nothing but this guard
 * keeps the two from drifting.
 */

const MOBILE = join(__dirname, "..");
const RES = join(MOBILE, "android/app/src/main/res");
const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

const FOLDERS: Record<string, string> = {
  en: "values", de: "values-de", es: "values-es", fr: "values-fr", it: "values-it", ja: "values-ja",
  nl: "values-nl", pl: "values-pl", pt: "values-pt-rBR", zh: "values-zh-rCN",
};

const shortcutsXml = read(RES, "xml/shortcuts.xml");
const androidIds = [...shortcutsXml.matchAll(/android:shortcutId="([^"]+)"/g)].map((m) => m[1]);
const labelNames = [...shortcutsXml.matchAll(/android:shortcutShortLabel="@string\/([^"]+)"/g)].map((m) => m[1]);
const swift = read(MOBILE, "ios/App/App/AppDelegate.swift");

function androidLabel(folder: string, name: string): string {
  const match = new RegExp(`<string name="${name}">(.*?)</string>`).exec(read(RES, folder, "strings.xml"));
  expect(match, `${folder}/strings.xml carries ${name}`).not.toBeNull();
  // Android escapes an apostrophe; the label itself does not contain the backslash.
  return match![1].split("\\'").join("'");
}

describe("launcher shortcuts and quick actions", () => {
  it("Android offers new note, new task, journal and today — each with an intent on the app scheme", () => {
    expect(androidIds).toEqual(["new-note", "new-task", "journal", "today"]);
    for (const id of androidIds) expect(shortcutsXml).toContain(`android:data="com.plainva.app://shortcut/${id}"`);
    expect(labelNames).toHaveLength(androidIds.length);
  });

  it("iOS offers the same entries in the same order", () => {
    const order = /quickActionOrder = \[([^\]]+)\]/.exec(swift);
    expect(order?.[1].split(",").map((part) => part.trim().replace(/"/g, ""))).toEqual(androidIds);
    expect(swift).toContain('"com.plainva.app://shortcut/"');
    expect(swift).toContain("performActionFor shortcutItem");
  });

  it("the iOS titles are the Android labels, in all ten languages", () => {
    for (const [lang, folder] of Object.entries(FOLDERS)) {
      const row = new RegExp(`"${lang}": \\[(.*)\\],`).exec(swift);
      expect(row, `AppDelegate.swift has a row for ${lang}`).not.toBeNull();
      androidIds.forEach((id, index) => {
        expect(row![1], `${lang}: ${id}`).toContain(`"${id}": "${androidLabel(folder, labelNames[index])}"`);
      });
    }
  });

  it("the web layer runs every one of them", () => {
    const runner = read(MOBILE, "src/PendingIntentRunner.tsx");
    for (const id of androidIds) expect(runner, id).toContain(`pendingShortcut === "${id}"`);
    // The URL list moved out of the shell when the widgets added a fourth
    // kind and App.tsx hit its structure budget (plan Widgets, W3).
    const routes = read(MOBILE, "src/services/appUrlRoutes.ts");
    expect(routes).toContain('url.startsWith("com.plainva.app://shortcut/")');
    const app = read(MOBILE, "src/App.tsx");
    for (const prop of ["onCapture=", "onNewTask=", "onJournal=", "onOpenToday="]) expect(app, prop).toContain(prop);
  });
});
