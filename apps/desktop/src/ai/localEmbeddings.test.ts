import { describe, expect, it, vi } from "vitest";
import { EmbeddingStore, embeddingModel, toBase64, type EmbeddingPackageFile, type SemanticSource } from "@plainva/core";
import { LocalEmbeddings, type LocalModelBridge } from "@plainva/ui";
import { until, vaultWith } from "./embeddingTestVault";

const spec = embeddingModel("granite-r2-97m")!;
const packaged: SemanticSource = { kind: "package", key: spec.id, spec };

const special = (id: number, content: string) => ({ id, content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true });
const TOKENIZER = JSON.stringify({
  version: "1.0",
  truncation: null,
  padding: null,
  added_tokens: [special(0, "[PAD]"), special(1, "[CLS]"), special(2, "[SEP]")],
  normalizer: { type: "Lowercase" },
  pre_tokenizer: { type: "Whitespace" },
  post_processor: {
    type: "TemplateProcessing",
    single: [{ SpecialToken: { id: "[CLS]", type_id: 0 } }, { Sequence: { id: "A", type_id: 0 } }, { SpecialToken: { id: "[SEP]", type_id: 0 } }],
    pair: [],
    special_tokens: { "[CLS]": { id: "[CLS]", ids: [1], tokens: ["[CLS]"] }, "[SEP]": { id: "[SEP]", ids: [2], tokens: ["[SEP]"] } },
  },
  decoder: null,
  model: { type: "WordLevel", vocab: { "[PAD]": 0, "[CLS]": 1, "[SEP]": 2, "[UNK]": 3, plainva: 4, probe: 5 }, unk_token: "[UNK]" },
});

/** A unit vector whose head is the catalog's reference: what a correct runtime answers for the golden text. */
function goldenVector(shift = 0): Float32Array {
  const head = spec.golden.head.map((_, i, all) => all[(i + shift) % all.length]!);
  const out = new Float32Array(spec.dim);
  out.set(head);
  out[head.length] = Math.sqrt(1 - head.reduce((sum, v) => sum + v * v, 0));
  return out;
}

function fakeBridge({ installed = true, loadError = null as string | null, shift = 0 } = {}) {
  let present = installed;
  const bridge = {
    status: vi.fn(async (_model: string, files: readonly EmbeddingPackageFile[]) => files.map(() => present)),
    download: vi.fn(async (_model: string, file: EmbeddingPackageFile, _url: string, onProgress: (received: number) => void) => {
      onProgress(file.bytes);
    }),
    cancel: vi.fn(async () => undefined),
    freeSpace: vi.fn(async () => 5e9),
    remove: vi.fn(async () => {
      present = false;
    }),
    readText: vi.fn(async (_model: string, name: string) => (name === "tokenizer.json" ? TOKENIZER : "{}")),
    load: vi.fn(async (modelFile: string) => {
      if (loadError) throw new Error(loadError);
      return `h:${modelFile}`;
    }),
    // Every text gets the same vector: enough for the life of the controller, which is what is tested here.
    run: vi.fn(async (_handle: string, batch: { batch: number }) => {
      const one = goldenVector(shift);
      const out = new Float32Array(batch.batch * spec.dim);
      for (let r = 0; r < batch.batch; r++) out.set(one, r * spec.dim);
      return { vectors: toBase64(new Uint8Array(out.buffer)), dim: spec.dim };
    }),
    unload: vi.fn(async () => undefined),
    markInstalled() {
      present = true;
    },
  } satisfies LocalModelBridge & { markInstalled(): void };
  return bridge;
}

describe("search by meaning in a vault (LocalEmbeddings)", () => {
  it("says a chosen model is missing, loads it, checks it and embeds the notes", async () => {
    const vault = await vaultWith({ "A.md": "Plainva probe" });
    const bridge = fakeBridge({ installed: false });
    const controller = new LocalEmbeddings({ bridge, ...vault });
    await controller.update({ source: packaged, mode: "both" });
    expect(controller.snapshot().engine.kind).toBe("missing");

    const progress: number[] = [];
    const unsubscribe = controller.subscribe(() => {
      const download = controller.snapshot().download;
      if (download) progress.push(download.received);
    });
    expect(await controller.install(spec)).toBe(true);
    unsubscribe();
    expect(bridge.download).toHaveBeenCalledTimes(3);
    expect(progress[progress.length - 1]).toBe(spec.model.bytes + spec.tokenizer.bytes + spec.tokenizerConfig.bytes);

    bridge.markInstalled();
    await controller.update({ source: packaged, mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "ready", source: { kind: "package", spec: { id: spec.id } }, check: { ok: true } });
    expect(await until(() => controller.snapshot().progress.current === 1 && controller.snapshot().progress.state === "idle")).toBe(true);
    expect(bridge.load).toHaveBeenCalledWith(`${spec.id}/${spec.model.name}`);
    await controller.close();
  });

  it("keeps a model off that computes wrong on this device", async () => {
    const controller = new LocalEmbeddings({ bridge: fakeBridge({ shift: 3 }), ...(await vaultWith({})) });
    await controller.update({ source: packaged, mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "failed", reason: "check" });
  });

  it("says when the build has no runtime", async () => {
    const controller = new LocalEmbeddings({ bridge: fakeBridge({ loadError: "runtime_missing: C:/app/onnxruntime.dll" }), ...(await vaultWith({})) });
    await controller.update({ source: packaged, mode: "both" });
    expect(controller.snapshot().engine).toMatchObject({ kind: "failed", reason: "runtime" });
  });

  it("does not undo the reader's pause when the app returns to the foreground", async () => {
    const controller = new LocalEmbeddings({ bridge: fakeBridge(), ...(await vaultWith({ "A.md": "Plainva probe" })) });
    await controller.update({ source: packaged, mode: "both" });
    expect(await until(() => controller.snapshot().progress.state === "idle" && controller.snapshot().progress.total === 1)).toBe(true);
    controller.pause("user");
    controller.pause("background");
    controller.resume("background");
    expect(controller.snapshot().progress.state).toBe("paused");
    controller.resume("user");
    expect(await until(() => controller.snapshot().progress.state === "idle")).toBe(true);
    await controller.close();
  });

  it("follows the mode and answers by words while no model is ready", async () => {
    const controller = new LocalEmbeddings({ bridge: fakeBridge({ installed: false }), ...(await vaultWith({ "A.md": "Plainva probe" })) });
    await controller.update({ source: null, mode: "meaning" });
    expect(controller.snapshot().mode).toBe("meaning");
    expect(controller.search.activeMode()).toBe("words");
    const page = await controller.search.searchOccurrencesPage("probe");
    expect(page.hits.map((hit) => hit.path)).toEqual(["A.md"]);
  });

  it("removes a package with every vector it computed", async () => {
    const vault = await vaultWith({ "A.md": "Plainva probe" });
    const bridge = fakeBridge();
    const controller = new LocalEmbeddings({ bridge, ...vault });
    await controller.update({ source: packaged, mode: "both" });
    expect(await until(() => controller.snapshot().progress.current === 1)).toBe(true);
    expect((await new EmbeddingStore(vault.db).spaces()).map((space) => space.notes)).toEqual([1]);
    await controller.remove(spec);
    expect(bridge.remove).toHaveBeenCalledWith(spec.id);
    expect(controller.snapshot().engine.kind).toBe("off");
    expect(await new EmbeddingStore(vault.db).spaces()).toEqual([]);
    expect(await controller.freeSpace()).toBe(5e9);
  });

  it("lists a package on this device that is not chosen as unused", async () => {
    const controller = new LocalEmbeddings({ bridge: fakeBridge(), ...(await vaultWith({})) });
    await controller.update({ source: null, mode: "both" });
    expect((await controller.unused()).packages.map((unused) => unused.id)).toEqual(["granite-r2-97m", "granite-r2-311m", "qwen3-embedding-0.6b"]);
    await controller.update({ source: packaged, mode: "both" });
    expect((await controller.unused()).packages.map((unused) => unused.id)).not.toContain("granite-r2-97m");
    await controller.close();
  });
});
