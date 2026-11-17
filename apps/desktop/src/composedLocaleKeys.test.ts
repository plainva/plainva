import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtractSkipReason, QuarantineReasonFamily, WorkspaceQuarantineRecord } from "@plainva/core";
import { QUARANTINE_HINTED_FAMILIES, QUARANTINE_REASON_FAMILIES } from "@plainva/core";
import {
  APP_LANGUAGES,
  deviceStateKey,
  EMOJI_CATEGORIES,
  profileAreaKey,
  quarantineKindKey,
  quarantineReasonKeys,
  type ProfileDeviceState,
  type ProfileFieldArea,
  type RepeatFreq,
} from "@plainva/ui";

/**
 * A key built at runtime exists in every language (F53 of release 0.9.0).
 *
 * `deviceStateKey` builds `settingsSync.diag<State>` from the device's state,
 * so no source line names the four keys. The locale guard counted them as
 * unreachable, they went on 04.08., and since 0.6.2 the diagnostics card of
 * both shells showed the raw key. Two halves close the class: the locale guard
 * sees a key a helper builds (`localeParity.test.ts`, `dynamicKeyShapes`), and
 * this file asks every helper that builds one for every value it can be
 * handed. Each domain is spelled as a `Record` over its type, so a new state,
 * area or reason does not compile until it is listed here — and then needs
 * its words in all ten languages.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCALES = join(ROOT, "packages/ui/src/locales");

type Tree = { [key: string]: string | Tree };
const bundles = new Map(APP_LANGUAGES.map((l) => [l.code, JSON.parse(readFileSync(join(LOCALES, `${l.code}.json`), "utf8")) as Tree]));

/** The text of a key, or of its plural forms; undefined where there is none. */
function textOf(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  const parts = key.split(".");
  for (const [i, part] of parts.entries()) {
    if (typeof node !== "object") return undefined;
    const next: string | Tree | undefined = node[part] ?? (i === parts.length - 1 ? node[`${part}_one`] ?? node[`${part}_other`] : undefined);
    node = next;
  }
  return typeof node === "string" && node.trim() ? node : undefined;
}

function missingIn(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const [lang, tree] of bundles) for (const key of keys) if (!textOf(tree, key)) out.push(`${lang}: ${key}`);
  return out;
}

const DEVICE_STATES = { running: 1, off: 1, locked: 1, waiting: 1 } satisfies Record<ProfileDeviceState, 1>;
const AREAS = { content: 1, backup: 1, sync: 1, mail: 1, calendar: 1, layout: 1, accounts: 1 } satisfies Record<ProfileFieldArea, 1>;
const FREQS = { daily: 1, weekly: 1, monthly: 1, yearly: 1 } satisfies Record<RepeatFreq, 1>;
const ARTIFACT_KINDS = { policy: 1, recovery: 1, operation: 1, object: 1, catalog: 1, checkpoint: 1, head: 1, grant: 1 } satisfies Record<WorkspaceQuarantineRecord["artifactKind"], 1>;
const SKIP_REASONS = { symlink: 1, unsafe_path: 1, too_large: 1, unreadable: 1 } satisfies Record<ExtractSkipReason, 1>;

describe("every key a helper builds exists in every language", () => {
  it("the state of this device in the settings-sync diagnostics (deviceStateKey)", () => {
    expect(missingIn(Object.keys(DEVICE_STATES).map((s) => deviceStateKey(s as ProfileDeviceState)))).toEqual([]);
  });

  it("the areas a settings profile carries (profileAreaKey)", () => {
    expect(missingIn(Object.keys(AREAS).map((a) => profileAreaKey(a as ProfileFieldArea)))).toEqual([]);
  });

  it("a task's repetition (describeRule)", () => {
    expect(missingIn(Object.keys(FREQS).map((f) => `tasks.repeatEvery_${f}`))).toEqual([]);
  });

  it("a quarantined artifact: its kind, and each reason's title, explanation and hint (quarantineKindKey, quarantineReasonKeys)", () => {
    const families: readonly QuarantineReasonFamily[] = QUARANTINE_REASON_FAMILIES;
    const keys = [
      ...Object.keys(ARTIFACT_KINDS).map((k) => quarantineKindKey(k as WorkspaceQuarantineRecord["artifactKind"])),
      ...families.flatMap((family) => {
        const { title, explain, hint } = quarantineReasonKeys(family);
        return [title, explain, ...(hint ? [hint] : [])];
      }),
    ];
    expect(QUARANTINE_HINTED_FAMILIES.length).toBeGreaterThan(0);
    expect(missingIn(keys)).toEqual([]);
  });

  it("the phone's emoji categories (EmojiPickSheet)", () => {
    expect(missingIn(EMOJI_CATEGORIES.map(({ id }) => `emojiPicker.cat${id.charAt(0).toUpperCase()}${id.slice(1)}`))).toEqual([]);
  });

  it("why an archive entry was skipped, in both shells' import (import.archiveSkip)", () => {
    expect(missingIn(Object.keys(SKIP_REASONS).map((r) => `import.archiveSkip.${r}`))).toEqual([]);
  });
});

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

describe("a family of keys built at runtime", () => {
  it("has keys in the language files at all", () => {
    // Every template that begins with a namespace of the language files and
    // part of a key — handed to t() or built by a helper — must name a family
    // that exists. `import.skip.${reason}` on the phone named none, and showed
    // the raw reason (F53).
    const reference = bundles.get("en")!;
    const flat: string[] = [];
    const walk = (tree: Tree, prefix: string) => {
      for (const [k, v] of Object.entries(tree)) {
        if (typeof v === "string") flat.push(prefix + k);
        else walk(v, `${prefix}${k}.`);
      }
    };
    walk(reference, "");
    const empty: string[] = [];
    for (const app of ["packages/ui/src", "apps/desktop/src", "apps/mobile/src"]) {
      for (const file of sources(join(ROOT, app))) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(/`([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z0-9_.]*)\$\{[^}`]*\}([a-zA-Z0-9_.]*)`/g)) {
          const [, namespace, rest, suffix] = m;
          if (!(namespace in reference) || !rest) continue;
          const head = `${namespace}.${rest}`;
          if (!flat.some((key) => key.startsWith(head) && key.endsWith(suffix) && key.length > head.length + suffix.length)) {
            empty.push(`${relative(ROOT, file)}:${text.slice(0, m.index).split("\n").length}: ${m[0]}`);
          }
        }
      }
    }
    expect(empty).toEqual([]);
  });
});
