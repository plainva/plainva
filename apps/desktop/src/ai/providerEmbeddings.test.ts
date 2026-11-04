import { describe, expect, it } from "vitest";
import {
  AI_EMBEDDING_PROFILE,
  DEFAULT_AI_APP_SETTINGS,
  EmbeddingStore,
  SEMANTIC_BY_PROVIDER,
  semanticSourceOf,
  type AiAppSettings,
  type AiEgress,
  type EgressChunk,
  type HttpRequestSpec,
  type SemanticSource,
} from "@plainva/core";
import { createAiVaultStores, createVaultPolicy, LocalEmbeddings, type AiFileStore, type LocalModelBridge, type ProviderEmbeddingHost } from "@plainva/ui";
import { until, vaultWith } from "./embeddingTestVault";

/** App data in memory: the approvals and the ledger of one vault. */
function memoryFiles(): AiFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => void files.set(path, text),
    remove: async (path) => void files.delete(path),
    removeDir: async (dir) => {
      for (const path of [...files.keys()]) if (path.startsWith(`${dir}/`)) files.delete(path);
    },
  };
}

/** Words hashed into 16 buckets: texts sharing words land close — a model, as far as these tests care. */
function wordVector(text: string, salt = 0): number[] {
  const out = new Array<number>(16).fill(0);
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    let hash = 2166136261 ^ salt;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    out[(hash >>> 0) % 16]! += 1;
  }
  out[15]! += 0.01;
  return out;
}

/** The native egress of an OpenAI-compatible provider: every request is recorded; it can go offline. */
function fakeEgress(salt = 0) {
  const sent: HttpRequestSpec[] = [];
  let failure: EgressChunk | null = null;
  const egress: AiEgress = {
    async send(_requestId, spec, onChunk) {
      sent.push(spec);
      if (failure) {
        onChunk(failure);
        return;
      }
      const input = (spec.body as { input: string[] }).input;
      onChunk({ type: "open", status: 200 });
      onChunk({ type: "data", text: JSON.stringify({ data: input.map((text, index) => ({ index, embedding: wordVector(text, salt) })), usage: { prompt_tokens: input.length * 7 } }) });
      onChunk({ type: "done" });
    },
    cancel: async () => undefined,
    setKey: async () => undefined,
    hasKey: async () => true,
    deleteKey: async () => undefined,
    addEndpoint: async () => true,
    removeEndpoint: async () => undefined,
  };
  return {
    egress,
    sent,
    texts: () => sent.flatMap((spec) => (spec.body as { input: string[] }).input),
    offline() {
      failure = { type: "failed", code: "network", message: "connection refused" };
    },
  };
}

const noPackages: LocalModelBridge = {
  status: async (_model, files) => files.map(() => false),
  download: async () => undefined,
  cancel: async () => undefined,
  freeSpace: async () => 5e9,
  remove: async () => undefined,
  readText: async () => "{}",
  load: async () => "h",
  run: async () => ({ vectors: "", dim: 0 }),
  unload: async () => undefined,
};

const NOTES = {
  "Budget.md": "The quarterly budget review is on Friday.",
  "Garden.md": "Water the tomatoes every morning.",
  "Private/Diary.md": "Dear diary, the budget worries me.",
};

function sourceFor(providerId: string, model: string): SemanticSource {
  const settings: AiAppSettings = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId, model } } };
  return semanticSourceOf(settings)!;
}

type Vault = Awaited<ReturnType<typeof vaultWith>>;

async function setup({ notes = NOTES as Record<string, string>, policy = "", encrypted = false, salt = 0, vault }: { notes?: Record<string, string>; policy?: string; encrypted?: boolean; salt?: number; vault?: Vault } = {}) {
  const index = vault ?? (await vaultWith(notes));
  const files = memoryFiles();
  const net = fakeEgress(salt);
  const stores = createAiVaultStores(files, "vtest");
  const provider: ProviderEmbeddingHost = {
    egress: net.egress,
    policy: createVaultPolicy({ readFile: async (path) => (path === ".agent/policy.yml" ? policy || null : (notes[path] ?? null)), resolveLink: async () => null, encrypted: () => encrypted }),
    encrypted: () => encrypted,
    approvals: stores.approvals,
    ledger: stores.ledger,
    newId: () => Math.random().toString(36).slice(2),
    now: () => new Date("2026-09-30T12:00:00Z"),
  };
  const controller = new LocalEmbeddings({ bridge: noPackages, ...index, provider });
  return { controller, net, stores, provider, vault: index };
}

/** Plan KI-Harness P2a-5: search by meaning with the model of the profile "Embeddings". */
describe("search by meaning with an own provider", () => {
  it("computes on a server on this computer without an approval, the probe first", async () => {
    const { controller, net, stores } = await setup();
    await controller.update({ source: sourceFor("ollama", "nomic-embed-text"), mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "ready", source: { key: "provider:ollama/nomic-embed-text" } });
    expect(net.sent[0]!.url).toBe("http://localhost:11434/v1/embeddings");
    expect(net.texts()[0]).toBe("Plainva findet Notizen nach Bedeutung. 会議の議事録。");
    expect(await until(() => controller.snapshot().progress.state === "idle" && controller.snapshot().progress.current === 3)).toBe(true);
    const page = await controller.search.searchOccurrencesPage("budget review");
    expect(page.hits[0]!.path).toBe("Budget.md");
    await controller.close();
    // What the run cost stands in the vault's ledger, as one entry.
    const [entry] = await stores.ledger.load();
    expect(entry).toMatchObject({ providerId: "ollama", model: "nomic-embed-text", stop: "answered", usage: { inputTokens: expect.any(Number) } });
    expect(entry!.steps).toBeGreaterThanOrEqual(2);
  });

  it("asks once before notes go to a cloud, and says what goes", async () => {
    const { controller, net, stores } = await setup({ policy: 'folders:\n  "Private/":\n    cloud: deny\n' });
    await controller.update({ source: sourceFor("openai", "text-embedding-3-small"), mode: "both" });
    const engine = controller.snapshot().engine;
    expect(engine.kind).toBe("approval");
    expect(net.sent).toEqual([]);
    if (engine.kind !== "approval") return;
    expect(engine.manifest).toMatchObject({ providerId: "openai", model: "text-embedding-3-small", standing: { notes: 2 }, withheld: { notes: 1 }, dataClasses: ["notes", "searches"] });

    await controller.approve();
    expect(controller.snapshot().engine.kind).toBe("ready");
    expect(await stores.approvals.load()).toEqual([{ recipient: "openai/text-embedding-3-small", purpose: "embeddings", at: "2026-09-30T12:00:00.000Z" }]);
    expect(await until(() => controller.snapshot().progress.state === "idle" && controller.snapshot().progress.current === 2)).toBe(true);
    // The rules held: nothing of the private note went.
    expect(net.texts().join("\n")).not.toContain("diary");
    expect(controller.snapshot().progress).toMatchObject({ total: 3, current: 2, withheld: 1 });
    await controller.close();
  });

  it("remembers the approval, and stops when it is withdrawn", async () => {
    const first = await setup();
    const source = sourceFor("openai", "text-embedding-3-small");
    await first.controller.update({ source, mode: "both" });
    await first.controller.approve();
    await first.controller.close();

    const again = new LocalEmbeddings({ bridge: noPackages, ...first.vault, provider: first.provider });
    await again.update({ source, mode: "both" });
    expect(again.snapshot().engine.kind).toBe("ready");
    if (source.kind !== "provider" || !source.target) throw new Error("a provider source");
    await again.withdraw(source.target);
    expect(again.snapshot().engine.kind).toBe("approval");
    expect(await first.stores.approvals.load()).toEqual([]);
    const sent = first.net.sent.length;
    again.indexChanged();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.net.sent.length).toBe(sent);
    await again.close();
  });

  it("sends nothing to a cloud from an encrypted workspace", async () => {
    const { controller, net } = await setup({ encrypted: true });
    await controller.update({ source: sourceFor("openai", "text-embedding-3-small"), mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "failed", reason: "encrypted" });
    expect(net.sent).toEqual([]);
  });

  it("names a provider without embeddings, and a profile without a model", async () => {
    const { controller } = await setup();
    await controller.update({ source: sourceFor("anthropic", "any-model"), mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "failed", reason: "no-route" });
    await controller.update({ source: { kind: "provider", key: "provider:", target: null }, mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "failed", reason: "no-model" });
  });

  it("computes again when another model answers under the same name", async () => {
    const first = await setup();
    await first.controller.update({ source: sourceFor("ollama", "nomic-embed-text"), mode: "both" });
    await until(() => first.controller.snapshot().progress.current === 3);
    await first.controller.close();

    // `ollama pull` fetched another model under the same name: its probe answers differently.
    const second = await setup({ salt: 99, vault: first.vault });
    await second.controller.update({ source: sourceFor("ollama", "nomic-embed-text"), mode: "both" });
    expect(await until(() => second.controller.snapshot().progress.state === "idle" && second.controller.snapshot().progress.current === 3)).toBe(true);
    // Every note went to the new model again: no vector of the old one was kept.
    expect(second.net.texts().filter((text) => text.includes("tomatoes"))).toHaveLength(1);
    expect((await new EmbeddingStore(first.vault.db).spaces()).map((space) => space.notes)).toEqual([3]);
    await second.controller.close();
  });

  it("answers by words when the provider cannot be reached, and says so", async () => {
    const { controller, net } = await setup();
    await controller.update({ source: sourceFor("ollama", "nomic-embed-text"), mode: "both" });
    await until(() => controller.snapshot().progress.current === 3);
    net.offline();
    const page = await controller.search.searchOccurrencesPage("tomatoes");
    expect(page.hits.map((hit) => [hit.path, hit.found])).toEqual([["Garden.md", "words"]]);
    expect(controller.snapshot().meaningFailure).toMatchObject({ kind: "offline" });
    await controller.close();
  });

  it("lists what this device keeps but no longer uses, and removes it", async () => {
    const { controller, vault } = await setup();
    await controller.update({ source: sourceFor("ollama", "nomic-embed-text"), mode: "both" });
    await until(() => controller.snapshot().progress.current === 3);
    await controller.update({ source: null, mode: "both" });
    const unused = await controller.unused();
    expect(unused.spaces.map((space) => space.engine)).toEqual(["provider:ollama/nomic-embed-text"]);
    expect(unused.packages).toEqual([]);
    await controller.removeUnused();
    expect(await new EmbeddingStore(vault.db).spaces()).toEqual([]);
  });
});
