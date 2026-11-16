import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});

import { vaultAppName, vaultNameKey } from "./services/vaultNames";

/**
 * One name for a vault wherever Plainva writes or shows it (B25 of release
 * 0.9.0 and its follow-up): the name it goes by in the app — the one it was
 * given, else (desktop) its folder or (phone) its unnamed entry. `{{vault}}`
 * was the first place; the root overview's heading, the files header, the
 * move dialog's root, the find-and-replace scope, the tray line, a design's
 * source and the phone's templates of databases, calendar notes and daily
 * notes derived their own and wrote two names for one vault.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

/** Places that name a FILE after the vault, not the vault to a person — they keep their own rule. */
const NOT_A_NAME: Record<string, string> = {
  "apps/desktop/src/services/vaultNames.ts": "the rule itself: the folder's name for a vault without its own",
  "apps/mobile/src/App.tsx": "names the backup archives (vaultBackup.ts), whose file names must not change with a rename",
  "apps/mobile/src/services/widgetService.ts": "the widget's line, written while the app is closed; follows the shell's header",
  "apps/mobile/src/services/intentService.ts": "the name the system's assistant offers; follows the shell's header",
};

describe("the vault's name", () => {
  it("no shell derives it on its own", () => {
    const offenders: string[] = [];
    for (const app of ["apps/desktop/src", "apps/mobile/src"]) {
      for (const file of sources(join(ROOT, app))) {
        const rel = relative(ROOT, file).split("\\").join("/");
        if (NOT_A_NAME[rel]) continue;
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          // A vault's path cut to its last segment, or the phone's entry with a fallback of its own.
          if (/vault[A-Za-z]*\??\.split\(\/\[(\/\\\\|\\\\\/)\]\/\).*\.pop\(\)/.test(line) || /\.name \|\| "Plainva"/.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("vaultAppName", () => {
    beforeEach(() => {
      for (const key of Object.keys(storeValues)) delete storeValues[key];
    });

    it("is the name the vault was given, else its folder's", async () => {
      expect(await vaultAppName("/home/kim/Notes")).toBe("Notes");
      storeValues[vaultNameKey("/home/kim/Notes")] = " Work ";
      expect(await vaultAppName("/home/kim/Notes")).toBe("Work");
    });
  });
});
