/**
 * Request timeouts that survive a large file.
 *
 * The per-request timeout is wall clock over the WHOLE exchange, body included —
 * so a flat 30 s does not mean "the server stopped answering", it means "this
 * upload had to sustain 3 MB/s". A 90 MB attachment on an ordinary home
 * connection never could, and the abort that followed was reported as a network
 * failure, which write operations deliberately do not retry (issue #48).
 *
 * A timeout is there to end a dead connection, not to enforce a speed. So the
 * budget grows with the payload, against a deliberately pessimistic floor: at
 * 50 KB/s even a slow mobile uplink stays inside it, while a genuinely hung
 * socket still gives up in bounded time.
 */
export const MIN_TRANSFER_BYTES_PER_SECOND = 50 * 1024;

/** Byte length of a request body we can measure. Anything else yields undefined. */
export function bodyByteLength(body: unknown): number | undefined {
  if (!body) return undefined;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  if (typeof body === "string") return body.length;
  return undefined;
}

/** Base timeout plus the time the payload alone needs at the floor throughput. */
export function timeoutForBody(baseMs: number, body: unknown): number {
  const bytes = bodyByteLength(body);
  if (!bytes) return baseMs;
  return baseMs + Math.ceil((bytes / MIN_TRANSFER_BYTES_PER_SECOND) * 1000);
}
