import { registerPlugin } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import type { LocalModelBridge } from "@plainva/ui";

/**
 * The phone's model packages and ONNX Runtime (plan KI-Harness P2a-3): the
 * native `LocalModels` plugin, the twin of the desktop's Rust commands.
 */
interface LocalModelsNative {
  status(options: { model: string; files: { name: string; bytes: number; sha256: string }[] }): Promise<{ present: boolean[] }>;
  download(options: { model: string; name: string; url: string; bytes: number; sha256: string }): Promise<void>;
  cancel(options: { model: string }): Promise<void>;
  freeSpace(): Promise<{ bytes: number }>;
  memory(): Promise<{ resident: number | null; peak: number | null }>;
  remove(options: { model: string }): Promise<void>;
  /** At most one part of a checked package file from `offset`, base64, with the file's size. */
  readPart(options: { model: string; name: string; offset: number; length: number }): Promise<{ data: string; size: number }>;
  load(options: { model: string }): Promise<{ handle: string }>;
  run(options: { handle: string; ids: string; mask: string; batch: number; seq: number; pooling: string }): Promise<{ vectors: string; dim: number }>;
  unload(options: { handle: string }): Promise<void>;
  addListener(event: "downloadProgress", listener: (event: { model: string; name: string; received: number }) => void): Promise<PluginListenerHandle>;
}

const LocalModels = registerPlugin<LocalModelsNative>("LocalModels");

/** One answer's most bytes, as every file's part on the phone (`BRIDGE_PART_BYTES`). */
const PART_BYTES = 256 * 1024;

/**
 * A package file's text, part by part: a tokenizer is 11 to 33 MB, and as
 * one answer it was a string Android parses on its UI thread at every start
 * (release list F54, the class of F51). The bytes are gathered and decoded
 * once, so no character is cut at a part's edge. A package file is checked and
 * never written in place; one whose size changes is not read on.
 */
export async function readPackageText(readPart: (options: { offset: number; length: number }) => Promise<{ data: string; size: number }>): Promise<string> {
  const first = await readPart({ offset: 0, length: PART_BYTES });
  const size = first.size;
  const bytes = new Uint8Array(size);
  let filled = 0;
  for (let answer = first; ; answer = await readPart({ offset: filled, length: PART_BYTES })) {
    if (answer.size !== size) throw new Error("the model file changed while it was read");
    const bin = atob(answer.data);
    if (bin.length === 0 && filled < size) throw new Error("the model file ended early");
    if (filled + bin.length > size) throw new Error("the model file changed while it was read");
    for (let i = 0; i < bin.length; i += 1) bytes[filled + i] = bin.charCodeAt(i);
    filled += bin.length;
    if (filled >= size) break;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export const mobileLocalModels: LocalModelBridge = {
  async status(model, files) {
    return (await LocalModels.status({ model, files: files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) })).present;
  },
  async download(model, file, url, onProgress) {
    const listener = await LocalModels.addListener("downloadProgress", (event) => {
      if (event.model === model && event.name === file.name) onProgress(event.received);
    });
    try {
      await LocalModels.download({ model, name: file.name, url, bytes: file.bytes, sha256: file.sha256 });
    } finally {
      await listener.remove();
    }
  },
  cancel: (model) => LocalModels.cancel({ model }),
  freeSpace: async () => (await LocalModels.freeSpace()).bytes,
  memory: () => LocalModels.memory(),
  remove: (model) => LocalModels.remove({ model }),
  readText: (model, name) => readPackageText((options) => LocalModels.readPart({ model, name, ...options })),
  load: async (modelFile) => (await LocalModels.load({ model: modelFile })).handle,
  run: (handle, batch) => LocalModels.run({ handle, ...batch }),
  unload: (handle) => LocalModels.unload({ handle }),
};
