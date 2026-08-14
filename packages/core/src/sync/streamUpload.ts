import type { SyncContentRef, SyncUploader } from "./ISyncTarget.js";
import { fetchWithRetry } from "./httpRetry.js";

/**
 * Bridges the native streaming uploader into the ordinary request path.
 *
 * Every provider reads its answers as a `Response` — `res.ok`, `res.headers.get`,
 * `res.json()` — and the 429/Retry-After rules live in `fetchWithRetry`, which
 * expects one too. Handing back a real `Response` means a streamed upload takes
 * exactly the same route as a buffered one, instead of each provider growing a
 * second, subtly different branch.
 */
export function nativeUploadResponse(answer: {
  status: number;
  headers: Record<string, string>;
  body: string;
}): Response {
  // 204/205/304 must not carry a body — the Response constructor rejects it.
  const bodyless = answer.status === 204 || answer.status === 205 || answer.status === 304;
  return new Response(bodyless ? null : answer.body, {
    status: answer.status,
    headers: answer.headers,
  });
}

/**
 * Streams a byte range of a vault file and returns the answer as a `Response`,
 * with the same retry rules a buffered write gets.
 */
export function streamUpload(
  uploader: SyncUploader,
  args: {
    ref: SyncContentRef;
    url: string;
    method: string;
    headers?: Record<string, string>;
    offset?: number;
    length?: number;
  },
): Promise<Response> {
  return fetchWithRetry(async () => nativeUploadResponse(await uploader(args)), "write");
}
