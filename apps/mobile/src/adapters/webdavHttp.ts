import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * fetch over the native WebDavHttp plugin (M3). CapacitorHttp cannot send
 * WebDAV methods (HttpURLConnection rejects PROPFIND & friends), so the
 * shared sync targets get this natively backed fetch and the plain browser
 * fetch on the web dev server. Android registers the OkHttp plugin in
 * MainActivity; iOS the URLSession twin in MainViewController (P7).
 */

interface WebDavHttpNative {
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    bodyBase64?: boolean;
  }): Promise<{ status: number; headers: Record<string, string>; bodyBase64: string }>;
  allowOrigin(options: { origin: string }): Promise<void>;
}

const WebDavHttp = registerPlugin<WebDavHttpNative>("WebDavHttp");

/**
 * Registers a USER-CONFIGURED server origin with the native bridge's origin
 * policy (hardening P4.3, finding M8): fixed provider hosts (Google/MS/
 * Dropbox/S3-AWS) are baked into the native layer; everything else — a
 * WebDAV URL, a custom S3 endpoint, deliberately including private-network
 * targets the user typed in — must be allowed here before the first request.
 * No-op on the web dev server (the browser fetch has no such gate).
 */
export async function allowHttpOrigin(urlOrOrigin: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WebDavHttp.allowOrigin({ origin: urlOrOrigin });
  } catch (e) {
    console.warn("[webdavHttp] allowOrigin failed", e);
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const nativeFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));

  let body: string | undefined;
  let bodyBase64 = false;
  const raw = init?.body;
  if (typeof raw === "string") {
    body = raw;
  } else if (raw instanceof Uint8Array) {
    body = bytesToB64(raw);
    bodyBase64 = true;
  } else if (raw instanceof ArrayBuffer) {
    body = bytesToB64(new Uint8Array(raw));
    bodyBase64 = true;
  } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
    // Drive's multipart upload builds a Blob (metadata + bytes) — without
    // this branch every NEW file push to Drive failed while folder
    // creation (JSON) worked.
    body = bytesToB64(new Uint8Array(await raw.arrayBuffer()));
    bodyBase64 = true;
  } else if (ArrayBuffer.isView(raw)) {
    body = bytesToB64(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    bodyBase64 = true;
  } else if (raw instanceof URLSearchParams) {
    body = raw.toString();
  } else if (raw != null) {
    throw new Error("unsupported request body type for native WebDAV fetch");
  }

  const res = await WebDavHttp.request({ url, method, headers, body, bodyBase64 });
  const bytes = b64ToBytes(res.bodyBase64);
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  // b64ToBytes allocates fresh, so .buffer is exactly the payload.
  return new Response(nullBody ? null : (bytes.buffer as ArrayBuffer), {
    status: res.status,
    headers: res.headers,
  });
};

/** Native: OkHttp bridge (any method). Web dev server: the browser fetch. */
export const webdavFetch: typeof fetch = Capacitor.isNativePlatform()
  ? nativeFetch
  : (...args) => window.fetch(...args);
