import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { atomicWriteBytes, BRIDGE_PART_BYTES, nativeReadBytes, sweepAtomicTemps } from "../platform/atomicFile";
import { connectionFailureCode } from "@plainva/core";
import { logDiagnostic } from "@plainva/ui";

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
    /**
     * Stream this sandbox file as the request body instead of `body` (issue
     * #48). The content never crosses the bridge; the native side opens the
     * file and sends the requested byte range straight into the socket.
     */
    bodyFilePath?: string;
    bodyOffset?: number;
    bodyLength?: number;
  }): Promise<NativeResponse>;
  allowOrigin(options: { origin: string }): Promise<void>;
}

/**
 * The plugin's answer. A body up to `BRIDGE_PART_BYTES` comes in it as base64;
 * a larger one waits in `bodyFile` (relative to `bodyDirectory`, Data when
 * absent), which is read in parts and removed - no body crosses the bridge in
 * one message (`BRIDGE_PART_BYTES`).
 */
interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
  bodyFile?: string;
  bodyDirectory?: "DATA" | "LIBRARY";
  bodySize?: number;
}

const WebDavHttp = registerPlugin<WebDavHttpNative>("WebDavHttp");

/** Where a large request body waits for the plugin (Data; a dot folder no vault and no Files app shows). */
const REQUEST_FOLDER = ".plainva-http";

let swept: Promise<void> | null = null;
/** Once per lifetime: the body files a killed process left (older than ten minutes). */
function sweepHttpFiles(): Promise<void> {
  swept ??= (async () => {
    try {
      await sweepAtomicTemps(REQUEST_FOLDER);
      if (Capacitor.getPlatform() === "ios") await sweepAtomicTemps("Caches/plainva-http", "LIBRARY");
    } catch {
      // silent: a folder that is not there holds nothing to sweep; what stays is swept at a later start.
    }
  })();
  return swept;
}

/** Removes the file a body waited in. */
async function dropBodyFile(res: NativeResponse): Promise<void> {
  if (!res.bodyFile) return;
  await Filesystem.deleteFile({ path: res.bodyFile, directory: res.bodyDirectory === "LIBRARY" ? Directory.Library : Directory.Data })
    .catch((error: unknown) => {
      // silent: a hidden temp file; the next start sweeps it.
      console.warn("[webdav] a response file stays until the next start", error);
    });
}

/** The body of a native answer, read in parts where it waits in a file. */
async function bodyOf(res: NativeResponse): Promise<Uint8Array> {
  if (!res.bodyFile) return b64ToBytes(res.bodyBase64 ?? "");
  const directory = res.bodyDirectory ?? "DATA";
  try {
    // In the background lane: a download never holds up what the person opens.
    return await nativeReadBytes(res.bodyFile, directory, "background");
  } finally {
    await Filesystem.deleteFile({ path: res.bodyFile, directory: directory === "LIBRARY" ? Directory.Library : Directory.Data })
      .catch((error: unknown) => {
        // silent: the body was read; the file is a hidden temp the next start sweeps.
        console.warn("[webdav] a response file stays until the next start", error);
      });
  }
}

/** Log only a bounded code/method, never the native exception (which may
 * contain credentials, private paths or certificate subject names). */
async function requestNative(options: Parameters<WebDavHttpNative["request"]>[0], signal?: AbortSignal | null) {
  void sweepHttpFiles();
  try {
    return await WebDavHttp.request(options);
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    const code = connectionFailureCode(error) ?? "HTTP_REQUEST_FAILED";
    const method = /^(GET|HEAD|POST|PUT|DELETE|OPTIONS|PROPFIND|MKCOL|MOVE|COPY|REPORT)$/.test(options.method) ? options.method : "OTHER";
    logDiagnostic("native-http", `${method}: ${code}`);
    throw Object.assign(new Error(code), { code });
  }
}

/**
 * Registers a USER-CONFIGURED server origin with the native bridge's origin
 * policy (hardening P4.3, finding M8): fixed provider hosts (Google/MS/
 * Dropbox/S3-AWS) are baked into the native layer; everything else — a
 * WebDAV URL, a custom S3 endpoint, deliberately including private-network
 * targets the user typed in — must be allowed here before the first request.
 * No-op on the web dev server (the browser fetch has no such gate).
 *
 * Both native platforms enforce this since 2026-07-26 (H8b). If registration
 * fails, stop before the request and report the same redacted policy error.
 */
export async function allowHttpOrigin(urlOrOrigin: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WebDavHttp.allowOrigin({ origin: urlOrOrigin });
  } catch {
    logDiagnostic("native-http", "allow-origin: HTTP_ORIGIN_BLOCKED");
    throw Object.assign(new Error("HTTP_ORIGIN_BLOCKED"), { code: "HTTP_ORIGIN_BLOCKED" });
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

function abortError(signal: AbortSignal): Error {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason instanceof Error) return reason;
  return typeof DOMException !== "undefined"
    ? new DOMException("The operation was aborted.", "AbortError")
    : Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

/**
 * Settles as soon as EITHER the plugin call settles or `signal` aborts. The
 * sync targets wrap every request in a timeout AbortController; the browser
 * fetch honours it, but the Capacitor bridge has no cancellation channel —
 * ignoring the signal here disabled every provider's request timeout on
 * device, so one hung native call wedged the SyncWorker until a force-close
 * (its `isSyncing` flag never cleared and every manual trigger became a
 * no-op). Rejecting on abort frees the awaiting cycle; the orphaned native
 * call is bounded by the plugin-side timeouts (OkHttp callTimeout /
 * URLSession resource timeout) and its late result is discarded. A response
 * the JS side never observes is exactly the "upload committed but base not
 * advanced" case the sync engine's pending-push journal detects.
 */
function raceAbort<T>(call: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    call.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Who counts a native request whose answer the app stopped waiting for. The
 * bridge cannot cancel a call: after the request's own time limit the JS
 * side goes on (`raceAbort`), while the native call runs on until its plugin
 * gives up — up to an hour for a large transfer — and may still reach the
 * provider. A request of a vault's sync belongs to the vault runtime that
 * sent it: counted there (`VaultCallOff.track`), the same vault opens again
 * only once it has ended — never two runtimes at one vault, also not at the
 * provider. Mail, calendars and sign-ins send through `webdavFetch`, which
 * counts nothing: their calls are no vault runtime's.
 */
type RequestCounter = (call: Promise<unknown>) => unknown;

/** The bridge's fetch for one vault runtime's sync: what it gives up waiting for is counted by `count`. */
export function webdavFetchCountedIn(count: RequestCounter): typeof fetch {
  if (!Capacitor.isNativePlatform()) return webdavFetch;
  return (input, init) => nativeFetchCounted(input, init, count);
}

const nativeFetch: typeof fetch = (input, init) => nativeFetchCounted(input, init, null);

const nativeFetchCounted = async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], count: RequestCounter | null): Promise<Response> => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const signal = init?.signal ?? null;
  if (signal?.aborted) throw abortError(signal);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};
  if (init?.headers) new Headers(init.headers).forEach((v, k) => (headers[k] = v));

  let text: string | undefined;
  let bytesBody: Uint8Array | undefined;
  const raw = init?.body;
  if (typeof raw === "string") {
    text = raw;
  } else if (raw instanceof Uint8Array) {
    bytesBody = raw;
  } else if (raw instanceof ArrayBuffer) {
    bytesBody = new Uint8Array(raw);
  } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
    // Drive's multipart upload builds a Blob (metadata + bytes) — without
    // this branch every NEW file push to Drive failed while folder
    // creation (JSON) worked.
    bytesBody = new Uint8Array(await raw.arrayBuffer());
  } else if (ArrayBuffer.isView(raw)) {
    bytesBody = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  } else if (raw instanceof URLSearchParams) {
    text = raw.toString();
  } else if (raw != null) {
    throw new Error("unsupported request body type for native WebDAV fetch");
  }
  // A text body is sent as its UTF-8 bytes once it is larger than one part.
  if (text !== undefined && text.length > BRIDGE_PART_BYTES / 4) {
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > BRIDGE_PART_BYTES) {
      bytesBody = encoded;
      text = undefined;
    }
  }

  // A Blob may have yielded while converting its body. Do not start a native
  // write after the request was cancelled during that preparation.
  if (signal?.aborted) throw abortError(signal);
  let staged: string | null = null;
  let request: Parameters<WebDavHttpNative["request"]>[0];
  if (bytesBody && bytesBody.length > BRIDGE_PART_BYTES) {
    // A large body is written to a file in parts and streamed from there by the plugin.
    staged = `${REQUEST_FOLDER}/.plainva-tmp-req-${crypto.randomUUID()}`;
    await atomicWriteBytes(staged, bytesBody);
    request = { url, method, headers, bodyFilePath: staged, bodyOffset: 0, bodyLength: bytesBody.length };
  } else if (bytesBody) {
    request = { url, method, headers, body: bytesToB64(bytesBody), bodyBase64: true };
  } else {
    request = { url, method, headers, body: text, bodyBase64: false };
  }
  let bytes: Uint8Array;
  let res: NativeResponse;
  try {
    const call = requestNative(request, signal);
    // A request given up still gets its answer from the plugin later; a body it
    // brought in a file is removed then, not left until a later start.
    if (signal) {
      void call.then((late) => {
        if (signal.aborted && late.bodyFile) void dropBodyFile(late);
      }, () => {
        // silent: the request failed; there is no body to remove.
      });
      // Given up before the plugin answered: the runtime that sent it counts it until the native call has ended.
      if (count) {
        let settled = false;
        void call.then(() => { settled = true; }, () => { settled = true; });
        signal.addEventListener("abort", () => {
          if (!settled) count(call.then(() => undefined, () => undefined));
        }, { once: true });
      }
    }
    res = signal ? await raceAbort(call, signal) : await call;
    bytes = await bodyOf(res);
  } finally {
    if (staged) {
      const file = staged;
      await Filesystem.deleteFile({ path: file, directory: Directory.Data })
        .catch((error: unknown) => {
          // silent: the request is done; the file is a hidden temp the next start sweeps.
          console.warn("[webdav] a request body file stays until the next start", error);
        });
    }
  }
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
  // bodyOf allocates fresh (b64ToBytes or a read in parts), so .buffer is exactly the payload.
  return new Response(nullBody ? null : (bytes.buffer as ArrayBuffer), {
    status: res.status,
    headers: res.headers,
  });
};

/** Native: OkHttp bridge (any method). Web dev server: the browser fetch. */
export const webdavFetch: typeof fetch = Capacitor.isNativePlatform()
  ? nativeFetch
  : (...args) => window.fetch(...args);

/**
 * Streams a byte range of a sandbox file as a request body (issue #48).
 *
 * Deliberately not routed through `webdavFetch`: a fetch body is a value in
 * memory, and the whole point here is that the bytes stay on disk.
 */
export async function webdavRequest(opts: {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyFilePath: string;
  bodyOffset: number;
  bodyLength: number;
}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const res = await requestNative(opts);
  const bytes = await bodyOf(res);
  return {
    status: res.status,
    headers: res.headers,
    body: new TextDecoder().decode(bytes),
  };
}
