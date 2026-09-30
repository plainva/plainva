import {
  createEmbeddingTokenizer,
  createOnnxEmbeddingEngine,
  embeddingFileUrl,
  embeddingPackageFiles,
  fromBase64,
  toBase64,
  type EmbeddingEngine,
  type EmbeddingModelSpec,
  type EmbeddingPackageFile,
  type EmbeddingPooling,
  type OnnxEmbeddingRunner,
} from "@plainva/core";

/**
 * Local model packages in both shells (plan KI-Harness P2a-3): the shells only
 * move bytes — a download into app storage, a model into the native ONNX
 * Runtime — and this module does the rest the same way on the desktop and the
 * phone: which files a package has, progress over all of them, the tokenizer,
 * and the engine the pipeline and the search use.
 */

/** The native side of a shell: the desktop's Tauri commands, the phone's plugin. */
export interface LocalModelBridge {
  /** Whether each file is present and checked, in the order given. */
  status(model: string, files: readonly EmbeddingPackageFile[]): Promise<boolean[]>;
  /** Downloads one file into the package; resumes, checks size and SHA-256. */
  download(model: string, file: EmbeddingPackageFile, url: string, onProgress: (received: number) => void): Promise<void>;
  cancel(model: string): Promise<void>;
  /** Free space where packages are stored, in bytes. */
  freeSpace(): Promise<number>;
  /** The app's memory now and at its peak, in bytes, where the system says (the device check, plan P2a-6). */
  memory?(): Promise<{ resident: number | null; peak: number | null }>;
  remove(model: string): Promise<void>;
  /** A checked text file of a package (the tokenizer). */
  readText(model: string, name: string): Promise<string>;
  load(modelFile: string): Promise<string>;
  run(handle: string, batch: { ids: string; mask: string; batch: number; seq: number; pooling: EmbeddingPooling }): Promise<{ vectors: string; dim: number }>;
  unload(handle: string): Promise<void>;
}

export interface PackageProgress {
  received: number;
  total: number;
  /** The file being fetched. */
  file: string;
}

export async function packageInstalled(bridge: LocalModelBridge, spec: EmbeddingModelSpec): Promise<boolean> {
  return (await bridge.status(spec.id, embeddingPackageFiles(spec))).every(Boolean);
}

/**
 * Downloads a package file by file (the model last), reporting progress over
 * the whole package. Files already checked are skipped, so a second try
 * continues where the first stopped.
 */
export async function downloadPackage(bridge: LocalModelBridge, spec: EmbeddingModelSpec, onProgress: (progress: PackageProgress) => void): Promise<void> {
  const files = embeddingPackageFiles(spec);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  const present = await bridge.status(spec.id, files);
  let done = files.reduce((sum, file, i) => sum + (present[i] ? file.bytes : 0), 0);
  for (const [i, file] of files.entries()) {
    if (present[i]) continue;
    onProgress({ received: done, total, file: file.name });
    await bridge.download(spec.id, file, embeddingFileUrl(spec, file), (received) => onProgress({ received: done + received, total, file: file.name }));
    done += file.bytes;
  }
  onProgress({ received: total, total, file: "" });
}

/** The native runtime behind the core seam: typed arrays in, base64 over the bridge. */
export function bridgeRunner(bridge: LocalModelBridge): OnnxEmbeddingRunner {
  return {
    load: (modelPath) => bridge.load(modelPath),
    async run(handle, batch) {
      const result = await bridge.run(handle, {
        ids: toBase64(new Uint8Array(batch.ids.buffer, batch.ids.byteOffset, batch.ids.byteLength)),
        mask: toBase64(batch.mask),
        batch: batch.batch,
        seq: batch.seq,
        pooling: batch.pooling,
      });
      // A copy: the decoded bytes need not start on a four-byte boundary.
      return new Float32Array(fromBase64(result.vectors).slice().buffer);
    },
    unload: (handle) => bridge.unload(handle),
  };
}

/** An installed package as an engine: tokenizer here, model in the native runtime. */
export async function openPackage(bridge: LocalModelBridge, spec: EmbeddingModelSpec): Promise<EmbeddingEngine> {
  const [tokenizer, config] = await Promise.all([bridge.readText(spec.id, spec.tokenizer.name), bridge.readText(spec.id, spec.tokenizerConfig.name)]);
  return createOnnxEmbeddingEngine({
    spec,
    tokenizer: createEmbeddingTokenizer(JSON.parse(tokenizer), JSON.parse(config), spec.maxTokens),
    runner: bridgeRunner(bridge),
    modelPath: `${spec.id}/${spec.model.name}`,
  });
}
