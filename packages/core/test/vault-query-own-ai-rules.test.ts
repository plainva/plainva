import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { DEFAULT_AI_POLICY, effectivePolicy, gateDecision, notePolicyFrom } from "../src/ai/index.ts";

/**
 * A note's own AI rule, answered by the index (AI harness P4.7).
 *
 * On real SQLite, like the anchor index next door: what is tested is how the
 * indexer stores the nested `plainva` namespace — and that what comes back is
 * what the policy's own parser reads, so that a rule written in a note keeps a
 * title out of a list that is built without reading the note.
 */
class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

async function harness() {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-ai-rules-"));
  const vaultAdapter = new LocalVaultAdapter(tmpDir);
  await vaultAdapter.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  const indexer = new VaultIndexer(vaultAdapter, db);
  const query = new VaultQueryService(db);
  return {
    vaultAdapter,
    indexer,
    query,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

const CLOUD = { recipient: { kind: "cloud" as const, provider: "system-intents", model: "" }, webTools: false };
const allowed = (rules: Map<string, { ai: unknown }>, notePath: string) =>
  gateDecision(effectivePolicy(notePath, notePolicyFrom({ plainva: rules.get(notePath) }), [], DEFAULT_AI_POLICY), CLOUD).allowed;

describe("getOwnAiRules", () => {
  it("answers for every note that carries a rule of its own, and for no other", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("Health/Results.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Results\n");
      await h.vaultAdapter.writeTextFile("Health/Allowed.md", "---\nplainva:\n  ai:\n    cloud: allow\n---\n# Allowed\n");
      // YAML's own word for no.
      await h.vaultAdapter.writeTextFile("Health/Boolean.md", "---\nplainva:\n  ai:\n    cloud: false\n---\n# Boolean\n");
      // The namespace is there for something else: no AI rule, no entry.
      await h.vaultAdapter.writeTextFile("Projects/Icon.md", "---\nplainva:\n  icon: rocket\n---\n# Icon\n");
      await h.vaultAdapter.writeTextFile("Projects/Plain.md", "# Plain\n\nNo properties at all.\n");
      // Something that only looks like a rule, in the text.
      await h.vaultAdapter.writeTextFile("Projects/Quoted.md", "# Quoted\n\n```yaml\nplainva:\n  ai:\n    cloud: deny\n```\n");
      await h.indexer.indexVaultFull();

      const rules = await h.query.getOwnAiRules();
      expect([...rules.keys()].sort()).toEqual(["Health/Allowed.md", "Health/Boolean.md", "Health/Results.md"]);
      expect(rules.get("Health/Results.md")).toEqual({ ai: { cloud: "deny" } });

      // What comes back is what the policy's own parser reads.
      expect(allowed(rules, "Health/Results.md")).toBe(false);
      expect(allowed(rules, "Health/Boolean.md")).toBe(false);
      expect(allowed(rules, "Health/Allowed.md")).toBe(true);
      expect(allowed(rules, "Projects/Plain.md")).toBe(true);
      expect(allowed(rules, "Projects/Quoted.md")).toBe(true);
    } finally {
      await h.dispose();
    }
  });

  it("follows the note: a rule that is added or taken out is there or gone after the next pass", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("Journal/Monday.md", "# Monday\n");
      await h.indexer.indexVaultFull();
      expect((await h.query.getOwnAiRules()).size).toBe(0);

      await h.vaultAdapter.writeTextFile("Journal/Monday.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Monday\n");
      await h.indexer.indexVaultFull();
      expect(allowed(await h.query.getOwnAiRules(), "Journal/Monday.md")).toBe(false);

      await h.vaultAdapter.writeTextFile("Journal/Monday.md", "# Monday\n");
      await h.indexer.indexVaultFull();
      expect((await h.query.getOwnAiRules()).size).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("ignores a rule that is no rule, as the policy does", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("A.md", "---\nplainva:\n  ai: nonsense\n---\n# A\n");
      await h.vaultAdapter.writeTextFile("B.md", "---\nplainva:\n  ai:\n    cloud: maybe\n---\n# B\n");
      await h.indexer.indexVaultFull();
      const rules = await h.query.getOwnAiRules();
      // Returned as written; the parser gives no opinion, and the default decides.
      expect(rules.get("A.md")).toEqual({ ai: "nonsense" });
      expect(allowed(rules, "A.md")).toBe(true);
      expect(allowed(rules, "B.md")).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
