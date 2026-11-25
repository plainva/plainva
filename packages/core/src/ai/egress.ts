import type { HttpRequestSpec, ProviderEndpoint, ModelRequest } from "./providers.js";
import { buildRequest } from "./providers.js";
import { createSseParser, createStreamDecoder, type StreamEvent, type StopReason } from "./streams.js";
import { parseRetryAfterMs } from "../sync/httpRetry.js";
import { connectionFailureCode } from "../sync/connectionFailure.js";

/**
 * The shells' native AI egress, as the core sees it (ADR 0017): the desktop
 * implements it with the Rust commands `ai_http` / `ai_http_cancel`, the phone
 * with the `AiNet` plugin. Keys go in, never out.
 */

export type EgressChunk =
  | { type: "open"; status: number }
  | { type: "data"; text: string }
  /** `retryAfter` is the provider's Retry-After header, when it sent one. */
  | { type: "httpError"; status: number; body: string; retryAfter?: string | null }
  | { type: "failed"; code: string; message: string }
  | { type: "done" }
  | { type: "cancelled" };

/**
 * The texts of the native confirmation for a new server, in the app's
 * language. The shells add the address themselves, below the message, so
 * the dialog always shows where requests will go.
 */
export interface EndpointConfirmText {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
}

export interface AiEgress {
  /** Sends the request; chunks arrive in order; resolves after the last one. */
  send(requestId: string, spec: HttpRequestSpec, onChunk: (chunk: EgressChunk) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  /** Write-only: there is no way to read a key back. */
  setKey(endpointId: string, key: string): Promise<void>;
  hasKey(endpointId: string): Promise<boolean>;
  deleteKey(endpointId: string): Promise<void>;
  /**
   * Adds a recipient the user typed in. The shell confirms it NATIVELY — the
   * web view cannot widen the allowlist on its own. False when declined.
   */
  addEndpoint(endpointId: string, baseUrl: string): Promise<boolean>;
  removeEndpoint(endpointId: string): Promise<void>;
}

/** Why a model call failed, in terms the UI can act on (§11.4). */
export type ModelFailure =
  | { kind: "no_key" }
  | { kind: "invalid_key"; status: number }
  | { kind: "rate_limited"; status: number; retryAfterSeconds?: number }
  | { kind: "overloaded"; status: number }
  | { kind: "context_too_long"; status: number }
  | { kind: "not_found"; status: number; message: string }
  | { kind: "refused_by_provider"; status: number; message: string }
  | { kind: "unknown_endpoint"; message: string }
  | { kind: "offline"; message: string }
  /**
   * Nothing was sent: the device never had a connection to the recipient — its name did not resolve, the connection was
   * refused, there was no route, the device has no network (plan Umsetzung 0.9.x, B7). The native egress of each shell
   * says so only where the connection provably never stood; whatever broke after it stood is `offline`, which may have
   * arrived.
   */
  | { kind: "unreachable"; message: string }
  /**
   * The secure connection was not accepted (F72): the certificate expired, is not valid yet, names another host or
   * comes from an authority this device does not trust — `code` says which, in the codes every shell's sync already
   * speaks (`connectionFailure.ts`). Said as what it is, not as "could not reach". Of the second class: nothing says
   * where in the exchange each platform's TLS stopped.
   */
  | { kind: "certificate"; code: "TLS_CERTIFICATE_EXPIRED" | "TLS_CERTIFICATE_NOT_YET_VALID" | "TLS_HOSTNAME_MISMATCH" | "TLS_CERTIFICATE_UNTRUSTED" | "TLS_HANDSHAKE_FAILED"; message: string }
  | { kind: "stream_broken"; message: string }
  | { kind: "provider_error"; message: string; code?: string }
  /**
   * The system's model is not there (plan P2c): the device is not eligible,
   * Apple Intelligence is off, the model is still loading or can be loaded,
   * the app is in the background — `reason` names which, for the settings to say.
   */
  | { kind: "platform_unavailable"; reason: string }
  /**
   * Nothing was sent: the conversation carries what this recipient may not
   * have (ADR 0018). A conversation is append-only, so each request takes all
   * of it along — and a model on this device may have been given a note whose
   * rule keeps it from every cloud. Such a conversation goes on with a model
   * on this device, or not at all; no provider ever answers with this.
   */
  | { kind: "kept_on_device" }
  /**
   * Nothing was sent: the device is fully local (ADR 0030), and this request
   * was for a recipient that is not the device. No provider answers with
   * this either — the egress refused before anything left.
   */
  | { kind: "local_only" }
  /**
   * Nothing was sent: the request would not fit the window the user stated
   * for a model on this device (ADR 0030). A local server would cut it
   * without a word; `needed` and `window` say by how much it misses.
   */
  | { kind: "window_too_small"; needed: number; window: number }
  /**
   * Nothing was sent: the request is larger than the device sends (the native egress of each shell refuses it before
   * it connects — MAX_BODY_BYTES on the desktop, the same check on the phone). Mostly an image (F72 of release 0.9.0).
   */
  | { kind: "too_large" }
  /**
   * Nothing was sent: Plainva put together a request its own egress does not take (a body of the wrong form). A fault
   * of Plainva's, never of the network or the provider (F72).
   */
  | { kind: "invalid_request"; message: string };

/** The code an egress refuses with while the device is fully local. */
export const LOCAL_ONLY_CODE = "local_only";

/**
 * The one place "fully local" holds (plan P7, ADR 0030). Every request to
 * a model passes the session's egress — a conversation, a review, a
 * transcription, a picture, embeddings through a provider, a connection
 * test —, so the promise is kept here and not at each of them: while the
 * device is fully local, a request whose endpoint is not on the device is
 * answered with a failure and handed to nobody. Keys and endpoints can
 * still be managed; managing sends nothing.
 */
export interface LocalOnlyEgress extends AiEgress {
  /** The switch was turned on: every request under way to anyone but this device is stopped, like the user's own STOP. */
  rest(): void;
}

export function localOnlyEgress(inner: AiEgress, guard: { on(): boolean; onDevice(endpointId: string): boolean }): LocalOnlyEgress {
  /** Request id to endpoint id, for as long as a request is under way. */
  const underWay = new Map<string, string>();
  return {
    async send(requestId, spec, onChunk) {
      if (guard.on() && !guard.onDevice(spec.endpointId)) {
        onChunk({ type: "failed", code: LOCAL_ONLY_CODE, message: "fully local: the recipient is not this device" });
        return;
      }
      underWay.set(requestId, spec.endpointId);
      try {
        await inner.send(requestId, spec, onChunk);
      } finally {
        underWay.delete(requestId);
      }
    },
    rest() {
      for (const [requestId, endpointId] of underWay) if (!guard.onDevice(endpointId)) void inner.cancel(requestId).catch(() => undefined);
    },
    cancel: (requestId) => inner.cancel(requestId),
    setKey: (endpointId, key) => inner.setKey(endpointId, key),
    hasKey: (endpointId) => inner.hasKey(endpointId),
    deleteKey: (endpointId) => inner.deleteKey(endpointId),
    addEndpoint: (endpointId, baseUrl) => inner.addEndpoint(endpointId, baseUrl),
    removeEndpoint: (endpointId) => inner.removeEndpoint(endpointId),
  };
}

export interface ModelCallResult {
  stop: StopReason | "cancelled" | null;
  failure?: ModelFailure;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

/** A provider's error body, shortened to its message where it has one. */
export function providerErrorMessage(body: string): string {
  const text = body.slice(0, 2000);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const inner = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? parsed.message;
    if (typeof inner === "string" && inner.trim()) return inner.trim().slice(0, 500);
  } catch {
    // not JSON: the text itself
  }
  return text.trim().slice(0, 500);
}

export function failureFromHttp(status: number, body: string, retryAfter?: string | null): ModelFailure {
  const message = providerErrorMessage(body);
  if (status === 401 || status === 403) return { kind: "invalid_key", status };
  if (status === 429) {
    const waitMs = parseRetryAfterMs(retryAfter ?? null);
    return waitMs === null ? { kind: "rate_limited", status } : { kind: "rate_limited", status, retryAfterSeconds: Math.ceil(waitMs / 1000) };
  }
  if (status === 529 || status === 503) return { kind: "overloaded", status };
  if (status === 404) return { kind: "not_found", status, message };
  if (status === 413 || /context|too long|maximum.*tokens|token limit/i.test(message)) return { kind: "context_too_long", status };
  return { kind: "refused_by_provider", status, message };
}

/**
 * The two classes of a failed request (plan Umsetzung 0.9.x, B7; M9, F71). "never_sent": the device decided before
 * anything left it — a check on the device, or a connection that provably never stood. Only then may anything say
 * "nothing was sent", and only then does a typed question go back into the field. Every other failure is
 * "maybe_sent": a provider answered, the time ran out, or the connection broke after it stood; the request may have
 * arrived, so the conversation keeps it with its record. In doubt, the second class.
 */
export type FailureClass = "never_sent" | "maybe_sent";

const NEVER_SENT: ReadonlySet<ModelFailure["kind"]> = new Set<ModelFailure["kind"]>([
  "local_only",
  "kept_on_device",
  "window_too_small",
  "unknown_endpoint",
  "no_key",
  "invalid_request",
  "too_large",
  "unreachable",
]);

export function failureClassOf(failure: ModelFailure): FailureClass {
  return NEVER_SENT.has(failure.kind) ? "never_sent" : "maybe_sent";
}

export function failureFromChunk(code: string, message: string): ModelFailure {
  switch (code) {
    case "no_key":
      return { kind: "no_key" };
    case "unknown_endpoint":
    case "url_not_allowed":
      return { kind: "unknown_endpoint", message };
    case "idle_timeout":
      return { kind: "stream_broken", message };
    // The platform plugins' own codes (plan P2c): no HTTP status, the same meanings.
    case "platform_unavailable":
      return { kind: "platform_unavailable", reason: message };
    case "context_too_long":
      return { kind: "context_too_long", status: 0 };
    case "rate_limited":
      return { kind: "rate_limited", status: 0 };
    case "overloaded":
      return { kind: "overloaded", status: 0 };
    case "platform_refused":
      return { kind: "refused_by_provider", status: 0, message };
    case "platform_error":
      return { kind: "provider_error", message };
    case LOCAL_ONLY_CODE:
      return { kind: "local_only" };
    // Decided by the native egress of every shell before it connects (F72): never "offline".
    case "too_large":
      return { kind: "too_large" };
    case "invalid_request":
      return { kind: "invalid_request", message };
    // The connection never stood (B7): decided by the native egress, never guessed from a message.
    case "unreachable":
      return { kind: "unreachable", message };
    // The phone's own codes for a failure after the request may have gone (Android, F72): a time-out is the provider
    // that did not answer, like `idle_timeout` on the desktop and iOS — never "could not reach".
    case "HTTP_TIMEOUT":
      return { kind: "stream_broken", message };
    default: {
      // A certificate the device did not accept (F72): the phone names it in its code, the desktop in its message.
      const tls = connectionFailureCode(`${code} ${message}`);
      if (tls && tls.startsWith("TLS_")) return { kind: "certificate", code: tls as Extract<ModelFailure, { kind: "certificate" }>["code"], message };
      return { kind: "offline", message };
    }
  }
}

/**
 * One model call: build the request, stream it through the egress, decode the
 * provider's events into Plainva's. `onEvent` sees every text delta, complete
 * tool call and reasoning part in order; the result says how it ended.
 */
export async function runModelCall(
  egress: AiEgress,
  endpoint: ProviderEndpoint,
  request: ModelRequest,
  onEvent: (event: StreamEvent) => void,
  options: { requestId: string; signal?: AbortSignal },
): Promise<ModelCallResult> {
  const spec = buildRequest(endpoint, request);
  const parser = createSseParser();
  const decoder = createStreamDecoder(endpoint.api);
  const result: ModelCallResult = { stop: null, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const handle = (event: StreamEvent) => {
    if (event.type === "usage") {
      result.usage.inputTokens = event.inputTokens ?? result.usage.inputTokens;
      result.usage.outputTokens = event.outputTokens ?? result.usage.outputTokens;
      result.usage.cacheReadTokens = event.cacheReadTokens ?? result.usage.cacheReadTokens;
      result.usage.cacheWriteTokens = event.cacheWriteTokens ?? result.usage.cacheWriteTokens;
    } else if (event.type === "stop") {
      result.stop = event.reason;
    } else if (event.type === "error") {
      result.failure = { kind: "provider_error", message: event.message, code: event.code };
    }
    onEvent(event);
  };
  if (options.signal?.aborted) return { ...result, stop: "cancelled" };
  const abort = () => void egress.cancel(options.requestId);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    await egress.send(options.requestId, spec, (chunk) => {
      switch (chunk.type) {
        case "data":
          for (const message of parser.push(chunk.text)) for (const event of decoder.push(message)) handle(event);
          return;
        case "done":
          for (const message of parser.finish()) for (const event of decoder.push(message)) handle(event);
          return;
        case "httpError":
          result.failure = failureFromHttp(chunk.status, chunk.body, chunk.retryAfter);
          return;
        case "failed":
          result.failure = failureFromChunk(chunk.code, chunk.message);
          return;
        case "cancelled":
          result.stop = "cancelled";
          return;
        case "open":
          return;
      }
    });
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  return result;
}

/**
 * A request whose answer is one JSON document (the model list of the
 * connection test). The egress still delivers it in chunks; they are joined.
 */
export async function fetchProviderJson(
  egress: AiEgress,
  spec: HttpRequestSpec,
  requestId: string,
): Promise<{ ok: true; json: unknown } | { ok: false; failure: ModelFailure }> {
  let text = "";
  let failure: ModelFailure | undefined;
  await egress.send(requestId, spec, (chunk) => {
    if (chunk.type === "data") text += chunk.text;
    else if (chunk.type === "httpError") failure = failureFromHttp(chunk.status, chunk.body, chunk.retryAfter);
    else if (chunk.type === "failed") failure = failureFromChunk(chunk.code, chunk.message);
    else if (chunk.type === "cancelled") failure = { kind: "offline", message: "cancelled" };
  });
  if (failure) return { ok: false, failure };
  try {
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: "provider_error", message: "the answer was not JSON" } };
  }
}
