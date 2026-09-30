import { Channel, invoke } from "@tauri-apps/api/core";
import type { AiEgress, EgressChunk, EndpointConfirmText, HttpRequestSpec } from "@plainva/core";

/**
 * The desktop's native AI egress (ADR 0017): the Rust commands in
 * `src-tauri/src/ai_egress.rs`. The key never comes back — there is no
 * command that returns it, and the egress scrubs it from every error text.
 */

const TERMINAL: ReadonlySet<EgressChunk["type"]> = new Set(["done", "cancelled", "failed", "httpError"]);

function wire(requestId: string, spec: HttpRequestSpec) {
  // `auth` stays behind: the egress decides where the key goes, not the web view.
  return { requestId, endpointId: spec.endpointId, url: spec.url, method: spec.method, headers: spec.headers, body: spec.body ?? null, rawBody: spec.rawBody ?? null };
}

export function createDesktopAiEgress(confirmText: () => EndpointConfirmText): AiEgress {
  return {
    send(requestId, spec, onChunk) {
      return new Promise<void>((resolve, reject) => {
        const channel = new Channel<EgressChunk>();
        let settled = false;
        channel.onmessage = (chunk) => {
          if (settled) return;
          onChunk(chunk);
          if (TERMINAL.has(chunk.type)) {
            settled = true;
            resolve();
          }
        };
        invoke("ai_http", { request: wire(requestId, spec), onEvent: channel }).catch((error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    async cancel(requestId) {
      await invoke("ai_http_cancel", { requestId });
    },
    async setKey(endpointId, key) {
      await invoke("ai_key_set", { endpointId, value: key });
    },
    hasKey(endpointId) {
      return invoke<boolean>("ai_key_present", { endpointId });
    },
    async deleteKey(endpointId) {
      await invoke("ai_key_delete", { endpointId });
    },
    addEndpoint(endpointId, baseUrl) {
      return invoke<boolean>("ai_endpoint_add", { endpointId, baseUrl, text: confirmText() });
    },
    async removeEndpoint(endpointId) {
      await invoke("ai_endpoint_remove", { endpointId });
    },
  };
}
