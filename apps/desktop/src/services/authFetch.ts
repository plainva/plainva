import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

// Microsoft's OAuth token host. Only POSTs here are relayed through Rust.
const MS_TOKEN_HOST = "https://login.microsoftonline.com";

/**
 * fetch wrapper for the OneDrive flows. Tauri's webview `fetch` attaches the WebView
 * `Origin` header; Microsoft's token endpoint rejects that for a native client
 * (AADSTS90023: cross-origin token redemption is only allowed for SPA or
 * registered-origin clients). We route ONLY the Microsoft token POST through the Rust
 * `oauth_token_request` command (reqwest sends no Origin), so OneDrive stays a native
 * client with long-lived refresh tokens. Everything else — Microsoft Graph and unrelated
 * hosts — uses the normal Tauri fetch, which those endpoints accept (that is why Dropbox
 * and Google Drive were never affected).
 */
export const oneDriveFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  if (url.startsWith(MS_TOKEN_HOST) && method === "POST") {
    const body = typeof init?.body === "string" ? init.body : "";
    const res = await invoke<{ status: number; body: string }>("oauth_token_request", { url, body });
    return new Response(res.body, { status: res.status });
  }
  return tauriFetch(input, init);
};
