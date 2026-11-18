import { beforeAll, describe, expect, it } from "vitest";
import ts from "typescript";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Every place in both shells and the shared package where a key is built from
 * a value (review 17.11.: 250 of them). The TypeScript checker says which
 * values each can be handed — the union of string literals of the value's
 * type —, and every key that makes must exist in all ten languages. A value
 * whose type is an open `string` (a server's code, a provider's id) cannot be
 * listed; such a family is named below with why it is safe, or it fails. A new
 * value in a type, a new place, a new family: each is asked for here without
 * anybody remembering it — the six helpers above were the first half of that.
 */
/**
 * Families of keys built from an open `string`, and why that is safe: every
 * place that builds one hands t() a fallback (`defaultValue`, or the default
 * string), which the test checks too. A closed domain never stands here — its
 * type is made narrow enough at the place for the checker to see it.
 */
const OPEN: Record<string, string> = {
  "inputRejected.{}": "the reason an input was refused, from errors of any part of the app; unknown ones keep their own message",
  "writeFailed.{}": "the kind of a failed write, from errors of any part of the app; unknown ones keep their own message",
  "ai.tool.{}": "tool names include those of MCP servers and scripts; an unknown tool is named as it calls itself",
  "ai.ext.outcome.{}": "the outcome an external tool server reports; an unknown one is shown as reported",
  "ai.toolDirect.{}": "tool names include those of MCP servers; an unknown tool falls back to its label",
  "import.sources.{}": "a source id from a stored import plan or a deep link; an unknown one keeps the importer's name",
  "import.archiveSkip.{}": "the reason the archive reader reports; an unknown one reads as \"unreadable\"",
  "whatsNew.highlight{}Title": "numbered by the catalog's count; localeParity.test.ts holds the count to the texts",
  "whatsNew.highlight{}": "numbered by the catalog's count; localeParity.test.ts holds the count to the texts",
  "themes.names.{}": "theme ids include imported themes; an unknown one keeps the theme's own label",
  "themes.variants.{}": "variant ids of the themes, imported ones included; an unknown one keeps the variant's own label",
};

interface Site { at: string; family: string; keys: string[] | null; open: string[]; fallback: boolean }

function composedSites(probe?: string): Site[] {
  const reference = bundles.get("en")!;
  const isNamespace = (ns: string) => typeof reference[ns] === "object";
  const roots = [...["packages/ui/src", "apps/desktop/src", "apps/mobile/src"].flatMap((dir) => sourceFiles(join(ROOT, dir))), ...(probe ? [probe] : [])];
  const program = ts.createProgram(roots, {
    noEmit: true, skipLibCheck: true, strict: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
    resolveJsonModule: true, types: [], baseUrl: ROOT,
    paths: { "@plainva/core": ["packages/core/src/index.ts"], "@plainva/ui": ["packages/ui/src/index.ts"], "@plainva/ui/*": ["packages/ui/src/*"] },
  });
  const checker = program.getTypeChecker();
  /** The values a part of a key can be: its string, number or boolean literals, or null where the type is open. */
  const valuesOf = (expression: ts.Expression): string[] | null => {
    const type = checker.getTypeAtLocation(expression);
    const parts = type.isUnion() ? type.types : [type];
    const out: string[] = [];
    for (const part of parts) {
      if (part.isStringLiteral() || part.isNumberLiteral()) out.push(String(part.value));
      else if (part.flags & ts.TypeFlags.BooleanLiteral) out.push(checker.typeToString(part));
      else if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) continue;
      else return null;
    }
    return out;
  };
  /** Whether the key goes to t() with a fallback: a default string, or options with `defaultValue`. */
  const hasFallback = (key: ts.Expression): boolean => {
    const call = key.parent;
    if (!ts.isCallExpression(call) || call.arguments[0] !== key) return false;
    const second = call.arguments[1];
    if (!second) return false;
    if (ts.isStringLiteralLike(second) || ts.isTemplateExpression(second) || ts.isIdentifier(second)) return true;
    return ts.isObjectLiteralExpression(second) && second.properties.some((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === "defaultValue");
  };
  /** `t(…)` or `i18n.t(…)`. */
  const isTranslate = (callee: ts.Expression) =>
    (ts.isIdentifier(callee) && callee.text === "t") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "t");
  const unwrap = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) ? unwrap(e.expression) : e);
  const isJoin = (e: ts.Expression): e is ts.CallExpression =>
    ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "join" && ts.isArrayLiteralExpression(unwrap(e.expression.expression));
  /** A built key the namespace scan above does not see: not a literal, not `ns.…${}` and not `"ns.…" + value`. */
  const builtElsewhere = (raw: ts.Expression): boolean => {
    const e = unwrap(raw);
    if (ts.isTemplateExpression(e)) return !/^[a-zA-Z][a-zA-Z0-9]*\./.test(e.head.text);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return !ts.isStringLiteral(e.left);
    // A choice counts where one of its keys is built so; a choice between a literal and a lookup is the lookup's business.
    if (ts.isConditionalExpression(e)) return builtElsewhere(e.whenTrue) || builtElsewhere(e.whenFalse);
    return isJoin(e);
  };
  /** Every key a built expression can be, or null where a part is open. */
  const keysOf = (raw: ts.Expression): string[] | null => {
    const e = unwrap(raw);
    const cross = (a: string[] | null, b: string[] | null, sep = "") => (a && b ? a.flatMap((x) => b.map((y) => x + sep + y)) : null);
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isTemplateExpression(e)) {
      let out: string[] | null = [e.head.text];
      for (const span of e.templateSpans) out = cross(cross(out, keysOf(span.expression)), [span.literal.text]);
      return out;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return cross(keysOf(e.left), keysOf(e.right));
    if (ts.isConditionalExpression(e)) {
      const a = keysOf(e.whenTrue), b = keysOf(e.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    if (isJoin(e)) {
      const sep = e.arguments[0] && ts.isStringLiteralLike(e.arguments[0]) ? e.arguments[0].text : ",";
      let out: string[] | null = [""];
      (unwrap((e.expression as ts.PropertyAccessExpression).expression) as ts.ArrayLiteralExpression).elements.forEach((el, i) => {
        out = cross(out, keysOf(el), i === 0 ? "" : sep);
      });
      return out;
    }
    return valuesOf(e);
  };
  /** The form of a built key, its open parts as `{}` — the family it stands for. */
  const formOf = (raw: ts.Expression): string => {
    const e = unwrap(raw);
    if (ts.isStringLiteralLike(e)) return e.text;
    if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => `{}${s.literal.text}`).join("");
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return formOf(e.left) + formOf(e.right);
    if (ts.isConditionalExpression(e)) return `(${formOf(e.whenTrue)}|${formOf(e.whenFalse)})`;
    if (isJoin(e)) return (unwrap((e.expression as ts.PropertyAccessExpression).expression) as ts.ArrayLiteralExpression).elements.map((el) => formOf(el)).join(".");
    return "{}";
  };
  const sites: Site[] = [];
  for (const file of program.getSourceFiles()) {
    if (!roots.includes(file.fileName)) continue;
    const at = (node: ts.Node) => `${relative(ROOT, file.fileName)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    const visit = (node: ts.Node) => {
      // `ns.part${value}rest` — a template that begins with a namespace of the language files.
      if (ts.isTemplateExpression(node)) {
        const ns = /^([a-zA-Z][a-zA-Z0-9]*)\./.exec(node.head.text)?.[1];
        if (ns && isNamespace(ns)) {
          let keys: string[] | null = [node.head.text];
          const open: string[] = [];
          let family = node.head.text;
          for (const span of node.templateSpans) {
            family += `{}${span.literal.text}`;
            const values = valuesOf(span.expression);
            if (values === null) { open.push(span.expression.getText(file)); keys = null; continue; }
            if (keys) keys = keys.flatMap((head) => values.map((v) => head + v + span.literal.text));
          }
          sites.push({ at: at(node), family, keys, open, fallback: hasFallback(node) });
        }
      }
      // "ns.part." + value
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteral(node.left)) {
        const head = node.left.text;
        const ns = /^([a-zA-Z][a-zA-Z0-9]*)\.[a-zA-Z0-9_.]*$/.exec(head)?.[1];
        if (ns && isNamespace(ns)) {
          const values = valuesOf(node.right);
          sites.push({ at: at(node), family: `${head}{}`, keys: values?.map((v) => head + v) ?? null, open: values ? [] : [node.right.getText(file)], fallback: hasFallback(node) });
        }
      }
      // A key handed to t() in any other built form (review 18.11.): a namespace
      // in a variable (`${ns}.label`), a concatenation with a name on its left,
      // `[...].join(".")`, a choice between two such keys. Each part's values
      // come from its type as above; what cannot be listed is an open family.
      if (ts.isCallExpression(node) && isTranslate(node.expression) && node.arguments[0] && builtElsewhere(node.arguments[0])) {
        const key = node.arguments[0];
        const keys = keysOf(key);
        sites.push({ at: at(key), family: formOf(key), keys, open: keys ? [] : [key.getText(file)], fallback: hasFallback(key) });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return sites;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path.split("\\").join("/"));
  }
  return out;
}

describe("every key built from a value", () => {
  let sites: Site[] = [];
  // One program over the three source trees; the checker answers each value's type.
  let took = 0;
  /** The forms the app does not write today, in a file of their own, read by the same program and kept out of the checks. */
  let probes: Site[] = [];
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "composed-keys-"));
    const probe = join(dir, "probe.ts").split("\\").join("/");
    writeFileSync(probe, [
      "export {};",
      "declare const t: (key: string) => string;",
      "declare const area: \"import\" | \"settings\";",
      "declare const step: \"label\" | \"open\";",
      "declare const prefix: \"import.notionToken.\";",
      "declare const anything: string;",
      "t([area, step].join(\".\"));",
      "t(prefix + step);",
      "t(anything + \".label\");",
      "",
    ].join("\n"));
    const start = performance.now();
    const all = composedSites(probe);
    took = performance.now() - start;
    const ofProbe = (site: Site) => site.at.startsWith(relative(ROOT, probe));
    probes = all.filter(ofProbe);
    sites = all.filter((site) => !ofProbe(site));
    rmSync(dir, { recursive: true, force: true });
  });

  it("sees a key built in each form: a namespace in a value, a join, a name joined on the left (review 18.11.)", () => {
    expect(probes.map((p) => (p.keys ? [...p.keys].sort() : null))).toEqual([
      ["import.label", "import.open", "settings.label", "settings.open"],
      ["import.notionToken.label", "import.notionToken.open"],
      null,
    ]);
    // The same forms in the app: the credential guide of an API source, the theme mode of the preview banner.
    expect(sites.find((site) => site.family === "{}.label")?.keys).toEqual(["import.notionToken.label"]);
    expect(sites.find((site) => site.family === "{}.{}")?.keys).toEqual(expect.arrayContaining(["mobile.themeDark", "settings.themeSystem"]));
  });

  it("finds the places (a sanity bound: the scan sees them), and says when it grows slow", () => {
    expect(sites.length).toBeGreaterThan(200);
    // 8 s when it was built; past about 15 s it says so here instead of growing slower unseen.
    if (took > 15_000) console.warn(`composedLocaleKeys: the checker took ${(took / 1000).toFixed(1)} s over ${sites.length} places — past the 15 s it was built for`);
  });

  it("exists in every language for every value the value's type allows", () => {
    const missing = sites.flatMap((site) => (site.keys ? missingIn(site.keys).map((m) => `${site.at}: ${m}`) : []));
    expect(missing).toEqual([]);
  });

  it("is built from an open string only in a family named with its reason, and with a fallback at every place", () => {
    const unnamed = sites.filter((site) => site.keys === null && !OPEN[site.family]).map((site) => `${site.at}: ${site.family} (${site.open.join(", ")})`);
    expect(unnamed).toEqual([]);
    const bare = sites.filter((site) => site.keys === null && !site.fallback).map((site) => `${site.at}: ${site.family}`);
    expect(bare).toEqual([]);
    // A family that is closed by now leaves the list.
    const stale = Object.keys(OPEN).filter((family) => !sites.some((site) => site.family === family && site.keys === null));
    expect(stale).toEqual([]);
  });
});
