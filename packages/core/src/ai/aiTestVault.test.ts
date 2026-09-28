import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { aiTestVaultFiles, LANGUAGES, LOCKED_FACTS } from "../../../../scripts/ai-test-vault.mjs";
import { effectivePolicy, notePolicyFrom, parsePolicyFile } from "./policy.js";
import { hardGate, redactDeniedLinks } from "./egressGate.js";
import { preWriteLint } from "./preWriteLint.js";
import { stripInvisible } from "./trust.js";

/**
 * The AI test vault (scripts/ai-test-vault.mjs) is the ground truth for the
 * golden queries and for testing by hand in a Labs build. These checks keep it
 * honest: its locks really lock under the policy engine, its injections really
 * are caught, and every golden query points at files that exist.
 */

const { files, golden } = aiTestVaultFiles();
const byPath = new Map(files);

function frontmatter(text: string): unknown {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? parseYaml(m[1]!) : {};
}

const rules = parsePolicyFile(byPath.get(".agent/policy.yml")!).rules;
const policyOf = (path: string) => effectivePolicy(path, notePolicyFrom(frontmatter(byPath.get(path) ?? "")), rules);
const cloud = { recipient: { kind: "cloud" as const, provider: "p", model: "m" }, webTools: false };

describe("AI test vault", () => {
  it("has three golden queries per language, all pointing at existing notes", () => {
    for (const lang of LANGUAGES) expect(golden.filter((g) => g.lang === lang && !g.locked && !g.injection && !g.sensitive && !g.today).length, lang).toBe(3);
    for (const g of golden) for (const p of [...g.expect, ...(g.locked ?? [])]) expect(byPath.has(p), `${g.id}: ${p}`).toBe(true);
  });

  it("keeps every locked fact away from a cloud recipient", () => {
    const notes = files.map(([p]) => p).filter((p) => p.endsWith(".md"));
    const { allowed, excluded } = hardGate(notes, (p) => p, policyOf, cloud);
    expect(excluded.map((e) => e.path).sort()).toEqual(["Finance/Bank.md", "Private/Codes.md", "Private/Health.md", "Work/Review notes.md"]);
    const leaked = allowed.flatMap((p) => LOCKED_FACTS.filter((fact) => byPath.get(p)!.includes(fact)).map((fact) => `${p}: ${fact}`));
    expect(leaked).toEqual([]);
  });

  it("withholds the names of locked notes in an allowed note's links", () => {
    const denied = new Set(["Bank", "Review notes"]);
    const { text } = redactDeniedLinks(byPath.get("Work/Weekly.md")!, (t) => denied.has(t));
    expect(text).not.toContain("[[Bank]]");
    expect(text).not.toContain("[[Review notes]]");
    expect(text).toContain("[[Harbour Bridge Lighting]]");
  });

  it("its inbox injections are caught by the linter and the invisible-character filter", () => {
    for (const [path, text] of files.filter(([p]) => p.startsWith("Inbox/"))) {
      const linted = preWriteLint(text).text;
      expect(linted, path).not.toMatch(/(?:https?:)?\/\/attacker\.example/);
      expect(stripInvisible(linted).text, path).not.toMatch(/\p{Cf}/u);
    }
  });

  it("marks the sensitive classes it plants", () => {
    const daily = files.filter(([p]) => p.startsWith("Daily/"));
    expect(daily).toHaveLength(7);
    for (const [, text] of daily) {
      expect(text).toMatch(/^mood: \d+$/m);
      expect(text).toContain("📍");
    }
  });
});
