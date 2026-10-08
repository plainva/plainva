import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Which notes a link could mean is one question in both shells (plan
 * KI-Harness P5-7b, ADR 0018): the privacy gate and the source check ask the
 * names of all files, not the rule this shell follows a link by. That only
 * holds while every place that builds the policy host hands it those names —
 * a host built without them falls back to the shell's own rule, silently, and
 * a link that rule does not follow carries a kept note's name to a cloud.
 *
 * So this is checked on the source, in both shells: every call of
 * `createVaultPolicy` outside a test names `fileNames`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");

/** Every TypeScript source below `dir` that is no test and no test's helper. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/(Harness|TestHost)\.ts$/.test(name)) out.push(path);
  }
  return out;
}

/** The argument of each `createVaultPolicy(` call in a source: from the bracket that opens it to the one that closes it. */
function policyCalls(text: string): string[] {
  const calls: string[] = [];
  let at = text.indexOf("createVaultPolicy(");
  while (at >= 0) {
    const open = at + "createVaultPolicy(".length;
    let depth = 1;
    let end = open;
    while (end < text.length && depth > 0) {
      const char = text[end];
      if (char === "(") depth++;
      else if (char === ")") depth--;
      end++;
    }
    calls.push(text.slice(open, end - 1));
    at = text.indexOf("createVaultPolicy(", end);
  }
  return calls;
}

describe("the names of all files reach every policy host (plan P5-7b)", () => {
  const shells = ["apps/desktop/src", "apps/mobile/src"] as const;

  for (const shell of shells) {
    it(`${shell}: every policy host is built with the names of the vault's files`, () => {
      const found: { file: string; call: string }[] = [];
      for (const file of sources(join(repo, ...shell.split("/")))) {
        const text = readFileSync(file, "utf8");
        // The function's own definition and its import are no call.
        for (const call of policyCalls(text)) if (call.trim().startsWith("{")) found.push({ file: relative(repo, file).replace(/\\/g, "/"), call });
      }
      // The assistant's host, the embeddings and the gists: three places per shell that decide what a note may go to.
      expect(found.map((entry) => entry.file).sort()).toHaveLength(3);
      const without = found.filter((entry) => !/\bfileNames\s*:/.test(entry.call)).map((entry) => entry.file);
      expect(without, "a policy host without the names of the vault's files asks the shell's own link rule").toEqual([]);
      // Each of them still says where a tap leads: the note a command opens is the shell's own.
      expect(found.every((entry) => /\bresolveLink\s*:/.test(entry.call))).toBe(true);
    });
  }

  it("the two shells name the same three places", () => {
    const names = (shell: string) =>
      sources(join(repo, ...shell.split("/")))
        .filter((file) => policyCalls(readFileSync(file, "utf8")).some((call) => call.trim().startsWith("{")))
        .map((file) => relative(repo, file).replace(/\\/g, "/"))
        .sort();
    expect(names("apps/desktop/src")).toEqual(["apps/desktop/src/components/ai/useDesktopEmbeddings.ts", "apps/desktop/src/components/ai/useDesktopGists.ts", "apps/desktop/src/services/ai/desktopAi.ts"]);
    expect(names("apps/mobile/src")).toEqual(["apps/mobile/src/services/ai/mobileAi.ts", "apps/mobile/src/services/ai/mobileEmbeddings.ts", "apps/mobile/src/services/ai/mobileGists.ts"]);
  });
});
