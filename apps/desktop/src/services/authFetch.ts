import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";

// Microsoft's OAuth token host. Only POSTs here are relayed through Rust.
const MS_TOKEN_HOST = "https://login.microsoftonline.com";

/**
 * fetch wrapper for EVERY Microsoft OAuth flow (OneDrive files, Graph calendar,
 * Graph mail). Tauri's webview `fetch` attaches the WebView `Origin` header;
 * Microsoft's token endpoint rejects that for a native client (AADSTS90023:
 * cross-origin token redemption is only allowed for SPA or registered-origin
 * clients). We route ONLY the Microsoft token POST through the Rust
 * `oauth_token_request` command (reqwest sends no Origin), so the app stays a
 * native client with long-lived refresh tokens. Everything else — Microsoft
 * Graph and unrelated hosts — uses the normal Tauri fetch, which those
 * endpoints accept (that is why Dropbox and Google Drive were never affected).
 * The calendar/mail flows launched WITHOUT this wrapper (maintainer finding
 * 2026-07-20, first real Microsoft calendar/mail sign-in) — every
 * exchangeOneDriveCode/refreshOneDriveAccessToken call must go through here.
 */
export const microsoftAuthFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  // Match the token host by exact origin, not startsWith: a look-alike such as
  // https://login.microsoftonline.com.evil.com would pass a prefix check.
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    /* malformed URL — not the token host */
  }
  if (origin === MS_TOKEN_HOST && method === "POST") {
    const body = typeof init?.body === "string" ? init.body : "";
    const res = await invoke<{ status: number; body: string }>("oauth_token_request", { url, body });
    return new Response(res.body, { status: res.status });
  }
  return tauriFetch(input, init);
};
