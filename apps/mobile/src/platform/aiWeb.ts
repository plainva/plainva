import { registerPlugin } from "@capacitor/core";
import type { WebFetcher, WebFetchResult } from "@plainva/core";

/**
 * The phone's page fetch for the assistant (plan KI-Harness P4, threat T2):
 * the `AiWeb` plugin (android/…/AiWebPlugin.java, ios/App/App/AiWebPlugin.swift).
 *
 * A plugin of its own, apart from the AI egress (`AiNet`): it reads public
 * pages and has no way to a provider key. The web view names an address;
 * where a request may go, what it may follow and how much it reads is decided
 * natively (AiWebRules.java, AiWebRules.swift), and `readPage` in the core
 * looks at the answer again.
 */

interface AiWebNative {
  /** One GET of a public https page; every rule about where it may go is applied natively. */
  fetchPage(options: { requestId: string; url: string }): Promise<WebFetchResult>;
  cancel(options: { requestId: string }): Promise<{ cancelled: boolean }>;
}

const AiWeb = registerPlugin<AiWebNative>("AiWeb");

export function createMobileWebFetcher(): WebFetcher {
  return {
    async fetch(url, { requestId, signal }) {
      if (signal?.aborted) return { kind: "failed", code: "cancelled" };
      // STOP reaches a fetch the way it reaches a model call.
      const stop = () => void AiWeb.cancel({ requestId }).catch(() => undefined);
      signal?.addEventListener("abort", stop, { once: true });
      try {
        return await AiWeb.fetchPage({ requestId, url });
      } catch {
        // Where the plugin does not exist (the plain browser), nothing is fetched.
        return { kind: "failed", code: "error" };
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
  };
}
