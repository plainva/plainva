/**
 * Request timeouts that survive a large file.
 *
 * The request budget covers sending the body and waiting for response headers —
 * so a flat 30 s does not mean "the server stopped answering", it means "this
 * upload had to sustain 3 MB/s". A 90 MB attachment on an ordinary home
 * connection never could, and the abort that followed was reported as a network
 * failure, which write operations deliberately do not retry (issue #48).
 *
 * A timeout is there to end a dead connection, not to enforce a speed. So the
 * budget grows with the payload, against a deliberately pessimistic floor: at
 * 50 KB/s even a slow mobile uplink stays inside it, while a genuinely hung
 * socket still gives up in bounded time. Once headers arrive, the response's
 * inactivity timeout lasts until its stream ends; actual progress renews it.
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

/** A caller's cancellation must not start another read attempt. */
export class TransferCancelledError extends Error {
  constructor(reason: unknown) {
    super("The transfer was cancelled", { cause: reason });
    this.name = "AbortError";
  }
}

/** Release an unused response without waiting on a faulty transport's cleanup. */
export function discardResponse(response: Response): void {
  if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
}

/** The providers already consume complete files/listings. Keep network reading
 * inside their retry attempt, without first concatenating a second file buffer.
 * The returned stream only delivers chunks already received from the network. */
function receivedResponse(source: Response, chunks: Array<Uint8Array | undefined>): Response {
  let cursor = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[cursor];
      chunks[cursor++] = undefined;
      if (chunk) controller.enqueue(chunk);
      if (cursor >= chunks.length) { chunks.length = 0; controller.close(); }
    },
    cancel() { chunks.length = 0; },
  });
  const metadata = { url: source.url, redirected: source.redirected, type: source.type };
  const restoreMetadata = (response: Response): Response => {
    for (const [key, value] of Object.entries(metadata)) Object.defineProperty(response, key, { value });
    const clone = response.clone.bind(response);
    Object.defineProperty(response, "clone", { value: () => restoreMetadata(clone()) });
    return response;
  };
  return restoreMetadata(new Response(body, { status: source.status, statusText: source.statusText, headers: source.headers }));
}

/** Sending retains the size-aware upload budget. Receiving has a progress
 * deadline, so large active downloads survive and stalled ones stop. Racing the
 * actual promises also bounds bridges/streams that ignore AbortSignal. */
export async function fetchWithTransferTimeout(
  fetchFn: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const parent = init.signal;
  if (parent?.aborted) throw new TransferCancelledError(parent.reason);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted = false;
  let rejectAbort!: (reason: Error) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  // A synchronous injected fetch can throw before the first race is attached.
  void cancellation.catch(() => {});
  const chunks: Array<Uint8Array | undefined> = [];
  const abort = (reason: Error) => {
    if (aborted) return;
    aborted = true;
    rejectAbort(reason);
    controller.abort(reason);
    if (reader) void reader.cancel(reason).catch(() => {});
    chunks.length = 0;
  };
  const arm = (ms: number, phase: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => abort(Object.assign(new Error(`${phase} timed out after ${ms}ms`), { name: "AbortError" })), ms);
  };
  const onParentAbort = () => abort(new TransferCancelledError(parent?.reason));
  parent?.addEventListener("abort", onParentAbort, { once: true });
  arm(timeoutForBody(timeoutMs, init.body), "request");
  try {
    const fetching = fetchFn(input, { ...init, signal: controller.signal }).then(response => {
      if (aborted) discardResponse(response);
      return response;
    });
    const response = await Promise.race([fetching, cancellation]);
    // Native bridges return fully received bodies. A bodyless response (and
    // older injected fetch implementations without streams) needs no reader.
    if (!response.body?.getReader) return response;
    reader = response.body.getReader();
    arm(timeoutMs, "response");
    while (true) {
      const part = await Promise.race([reader.read(), cancellation]);
      if (part.done) break;
      if (part.value.byteLength > 0) {
        chunks.push(part.value);
        arm(timeoutMs, "response");
      }
    }
    return receivedResponse(response, chunks);
  } catch (error) {
    chunks.length = 0;
    if (reader) void reader.cancel(error).catch(() => {});
    if (!aborted) controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
    reader?.releaseLock();
  }
}
