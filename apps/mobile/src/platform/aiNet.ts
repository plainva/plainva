import { registerPlugin } from "@capacitor/core";
import type { AiEgress, EgressChunk, EndpointConfirmText, HttpRequestSpec } from "@plainva/core";
import { isPlatformRequest, PlatformModel } from "./platformModel";

/**
 * The phone's native AI egress (ADR 0017): the `AiNet` plugin
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
  setLocalOnly(options: { on: boolean }): Promise<void>;
}

const AiNet = registerPlugin<AiNetNative>("AiNet");

const TERMINAL: ReadonlySet<EgressChunk["type"]> = new Set(["done", "cancelled", "failed", "httpError"]);

/**
 * Tells the native side whether the device is fully local (plan KI-Harness
 * P7, ADR 0030). While it is, the plugins that send something for the
 * assistant refuse — the session's own egress holds the rule first; this is
 * the same rule once more, behind it.
 */
export async function setMobileLocalOnly(on: boolean): Promise<void> {
  await AiNet.setLocalOnly({ on });
}

export function createMobileAiEgress(confirmText: () => EndpointConfirmText): AiEgress {
  /** Requests the system's own model is answering (plan P2c): a cancel goes where the request went. */
  const onDevice = new Set<string>();
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
        // The system's own model answers on the device (plan P2c); everything else goes through the network egress.
        const platform = isPlatformRequest(spec.url);
        if (platform) onDevice.add(requestId);
        const native = platform ? PlatformModel : AiNet;
        void native.request(options, (chunk, error) => {
          if (settled) return;
          if (error || !chunk) {
            settled = true;
            onDevice.delete(requestId);
            reject(error instanceof Error ? error : new Error(String(error ?? "AiNet request failed")));
            return;
          }
          onChunk(chunk);
          if (TERMINAL.has(chunk.type)) {
            settled = true;
            onDevice.delete(requestId);
            resolve();
          }
        }).catch((error: unknown) => {
          if (settled) return;
          settled = true;
          onDevice.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    async cancel(requestId) {
      if (onDevice.has(requestId)) await PlatformModel.cancel({ requestId });
      else await AiNet.cancel({ requestId });
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
