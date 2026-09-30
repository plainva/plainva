import { Channel, invoke } from "@tauri-apps/api/core";
import type { LocalModelBridge } from "@plainva/ui";

/**
 * The desktop's model packages and ONNX Runtime (plan KI-Harness P2a-3): the
 * Rust commands in `src-tauri/src/model_store.rs` and `embedding.rs`.
 */

type DownloadEvent = { kind: "progress"; received: number; total: number } | { kind: "verifying" };

export const desktopLocalModels: LocalModelBridge = {
  status: (model, files) => invoke<boolean[]>("model_status", { model, files: files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }),
  async download(model, file, url, onProgress) {
    const channel = new Channel<DownloadEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "progress") onProgress(event.received);
    };
    await invoke("model_download", { file: { model, name: file.name, url, bytes: file.bytes, sha256: file.sha256 }, onEvent: channel });
  },
  async cancel(model) {
    await invoke("model_download_cancel", { model });
  },
  freeSpace: () => invoke<number>("model_free_space"),
  async remove(model) {
    await invoke("model_remove", { model });
  },
  readText: (model, name) => invoke<string>("model_read_text", { model, name }),
  load: (modelFile) => invoke<string>("embedding_load", { model: modelFile }),
  run: (handle, batch) => invoke<{ vectors: string; dim: number }>("embedding_run", { handle, request: batch }),
  async unload(handle) {
    await invoke("embedding_unload", { handle });
  },
};
