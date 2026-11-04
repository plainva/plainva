import { invoke } from "@tauri-apps/api/core";
import type { WebFetcher, WebFetchResult } from "@plainva/core";

/**
 * The desktop's page fetch for the assistant (plan KI-Harness P4): the Rust
 * command `ai_web_fetch` in `src-tauri/src/ai_web.rs`. The web view names an
 * address; where a request may go, what it may follow and how much it reads
 * is decided natively, and `readPage` in the core looks at the answer again.
 */
export function createDesktopWebFetcher(): WebFetcher {
  return {
    async fetch(url, { requestId, signal }) {
      if (signal?.aborted) return { kind: "failed", code: "cancelled" };
      // STOP reaches a fetch the way it reaches a model call: the one list of running requests.
      const stop = () => void invoke("ai_http_cancel", { requestId }).catch(() => undefined);
      signal?.addEventListener("abort", stop, { once: true });
      try {
        return await invoke<WebFetchResult>("ai_web_fetch", { url, requestId });
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}
