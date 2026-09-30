import { registerPlugin } from "@capacitor/core";
import type { AiEgress, EgressChunk, EndpointConfirmText, HttpRequestSpec } from "@plainva/core";

/**
 * The phone's native AI egress (ADR 0016): the `AiNet` plugin
 * (android/…/AiNetPlugin.java, ios/App/App/AiNetPlugin.swift). Keys live in
 * the plugin's own store; no method returns them.
 */

interface AiNetNative {
  request(
    options: {
      requestId: string;
      endpointId: string;
      url: string;
      method: "GET" | "POST";
      headers: Record<string, string>;
      body?: Record<string, unknown>;
      rawBody?: { base64: string; contentType: string };
    },
    callback: (chunk: EgressChunk | null, error?: unknown) => void,
  ): Promise<string>;
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>;
  setKey(options: { endpointId: string; value: string }): Promise<void>;
  hasKey(options: { endpointId: string }): Promise<{ present: boolean }>;
  deleteKey(options: { endpointId: string }): Promise<void>;
  addEndpoint(options: { endpointId: string; baseUrl: string; title: string; message: string; confirm: string; cancel: string }): Promise<{ added: boolean }>;
  removeEndpoint(options: { endpointId: string }): Promise<void>;
}

const AiNet = registerPlugin<AiNetNative>("AiNet");

const TERMINAL: ReadonlySet<EgressChunk["type"]> = new Set(["done", "cancelled", "failed", "httpError"]);

export function createMobileAiEgress(confirmText: () => EndpointConfirmText): AiEgress {
  return {
    send(requestId: string, spec: HttpRequestSpec, onChunk: (chunk: EgressChunk) => void) {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const options = {
          requestId,
          endpointId: spec.endpointId,
          url: spec.url,
          method: spec.method,
          headers: spec.headers,
          ...(spec.body ? { body: spec.body } : {}),
          ...(spec.rawBody ? { rawBody: spec.rawBody } : {}),
        };
        void AiNet.request(options, (chunk, error) => {
          if (settled) return;
          if (error || !chunk) {
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error ?? "AiNet request failed")));
            return;
          }
          onChunk(chunk);
          if (TERMINAL.has(chunk.type)) {
            settled = true;
            resolve();
          }
        }).catch((error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    async cancel(requestId) {
      await AiNet.cancel({ requestId });
    },
    async setKey(endpointId, key) {
      await AiNet.setKey({ endpointId, value: key });
    },
    async hasKey(endpointId) {
      return (await AiNet.hasKey({ endpointId })).present;
    },
    async deleteKey(endpointId) {
      await AiNet.deleteKey({ endpointId });
    },
    async addEndpoint(endpointId, baseUrl) {
      return (await AiNet.addEndpoint({ endpointId, baseUrl, ...confirmText() })).added;
    },
    async removeEndpoint(endpointId) {
      await AiNet.removeEndpoint({ endpointId });
    },
  };
}
