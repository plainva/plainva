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

/** The two rules themselves: the desktop's own name or folder, the phone's list entry. */
const THE_RULE = new Set(["apps/desktop/src/services/vaultNames.ts", "apps/mobile/src/services/vaultEntryName.ts"]);
/** A line that names a FILE after the vault — a backup archive — says so; its name must not change with a rename. */
const FILE_NAME = "// file name, not a vault name";

/** The entry's name with a fallback of its own: "Plainva", or the label of an entry without a name. */
const OWN_FALLBACK = /\.name(\?\.trim\(\))?\s*(\|\||\?\?)\s*("Plainva"|(i18n\.)?t\("mobile\.vaultLocal"\))/;
/** The phone's list entry, named as it is: "" for an entry without a name. */
const RAW_ENTRY = /getActiveVaultEntry\(\)\)\??\.name\b/;
/** A path cut to its last segment. */
const PATH_TAIL = /\.split\(\/\[[^\]]+\]\/\)(\.filter\(Boolean\))?\.pop\(\)/;
/** …and the cut is a vault's: its receiver names one, or is a vault of a list mapped just above. */
const VAULT_RECEIVER = /(\w+)\??\.split\(\/\[/;
const VAULT_LIST_MAP = /\b\w*[vV]aults\b[^\n]*\.map\(\(?(\w+)/;
/** A basename helper handed a vault's path. */
const BASENAME_OF_VAULT = /\b(basename|getBasename|basenameOf)\((\w*(vault|Vault|section)\w*)\)/;

/** Every line of both shells that names a vault by a rule of its own. */
function offendersIn(rel: string, text: string): string[] {
  if (THE_RULE.has(rel)) return [];
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (line.includes(FILE_NAME)) return;
    const receiver = VAULT_RECEIVER.exec(line)?.[1] ?? "";
    const mapped = lines.slice(Math.max(0, i - 2), i + 1).map((l) => VAULT_LIST_MAP.exec(l)?.[1]).filter(Boolean);
    const vaultTail = PATH_TAIL.test(line) && (/vault/i.test(receiver) || receiver === "loadingTarget" || mapped.includes(receiver));
    const unwrapped = RAW_ENTRY.test(line) && !/vaultEntryName\(|templateVaultName\(/.test(line);
    if (OWN_FALLBACK.test(line) || unwrapped || vaultTail || BASENAME_OF_VAULT.test(line)) out.push(`${rel}:${i + 1}`);
  });
  return out;
}

describe("the vault's name", () => {
  it("no shell derives it on its own", () => {
    const offenders: string[] = [];
    for (const app of ["apps/desktop/src", "apps/mobile/src"]) {
      for (const file of sources(join(ROOT, app))) {
        const rel = relative(ROOT, file).split("\\").join("/");
        offenders.push(...offendersIn(rel, readFileSync(file, "utf8")));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sees each way a name of its own was written", () => {
    // The places the review of 17.11. found past the first guard (F7), as they stood.
    const seen = (line: string, above = "") => offendersIn("x.tsx", `${above}\n${line}`).length > 0;
    expect(seen(`{path.split(/[/\\\\]/).filter(Boolean).pop() ?? path}`, `{recentVaults.slice(0, 5).map((path) => (`)).toBe(true);
    expect(seen(`void getActiveVaultEntry().then((e) => setVaultName(e.name || "Plainva"));`)).toBe(true);
    expect(seen(`source: (await getActiveVaultEntry()).name, target: existing?.name ?? name,`)).toBe(true);
    expect(seen(`const name = entry.name || t("mobile.vaultLocal");`)).toBe(true);
    expect(seen(`const loadingVaultName = loadingTarget ? loadingTarget.split(/[/\\\\]/).pop() : null;`)).toBe(true);
    expect(seen(`rootLabel={basename(section)}`)).toBe(true);
    // A file's own name stays a file's.
    expect(seen(`const name = path.split(/[/\\\\]/).pop() ?? path;`)).toBe(false);
    expect(seen(`const archiveName = entryName || "Plainva"; ${FILE_NAME}`)).toBe(false);
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
