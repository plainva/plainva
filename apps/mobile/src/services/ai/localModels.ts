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
  remove(options: { model: string }): Promise<void>;
  readText(options: { model: string; name: string }): Promise<{ text: string }>;
  load(options: { model: string }): Promise<{ handle: string }>;
  run(options: { handle: string; ids: string; mask: string; batch: number; seq: number; pooling: string }): Promise<{ vectors: string; dim: number }>;
  unload(options: { handle: string }): Promise<void>;
  addListener(event: "downloadProgress", listener: (event: { model: string; name: string; received: number }) => void): Promise<PluginListenerHandle>;
}

const LocalModels = registerPlugin<LocalModelsNative>("LocalModels");

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
  remove: (model) => LocalModels.remove({ model }),
  readText: async (model, name) => (await LocalModels.readText({ model, name })).text,
  load: async (modelFile) => (await LocalModels.load({ model: modelFile })).handle,
  run: (handle, batch) => LocalModels.run({ handle, ...batch }),
  unload: (handle) => LocalModels.unload({ handle }),
};
