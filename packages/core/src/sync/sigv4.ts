/**
 * Minimal AWS Signature Version 4 signer for the S3-compatible sync target (P1 of the
 * sync-provider plan, 2026-07-04). Implemented against the official AWS documentation
 * and verified by unit tests that reproduce the published AWS SigV4 test vectors
 * (examplebucket, 2013-05-24). WebCrypto only — no new dependency.
 *
 * S3 specifics honoured here:
 * - The canonical URI is single-encoded (S3 is the one AWS service that must NOT be
 *   double-encoded); the caller passes the already-encoded path.
 * - The payload hash is the hex SHA-256 of the request body (empty-body hash for
 *   GET/DELETE), sent as `x-amz-content-sha256` and included in the signature.
 *   UNSIGNED-PAYLOAD is deliberately not used: some S3-compatible stores reject it.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface SigV4SignInput {
  method: string;
  /** Host header value as it will go on the wire (may include a non-default port). */
  host: string;
  /** Already RFC-3986-encoded absolute path, starting with "/". */
  canonicalUri: string;
  /** Raw (un-encoded) query parameters; encoded + sorted here. */
  queryParams?: Record<string, string>;
  /** Extra headers to sign (e.g. x-amz-copy-source, range). Lower/upper case accepted. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the request body. Use sha256Hex(new Uint8Array()) for no body. */
  payloadHash: string;
  credentials: SigV4Credentials;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface SigV4SignResult {
  /**
   * Headers to put on the request: the caller's signable extra headers plus
   * x-amz-date, x-amz-content-sha256 and Authorization. The Host header is part of
   * the signature but intentionally NOT returned — fetch derives it from the URL
   * (and forbids setting it manually); it matches as long as the URL host equals
   * `host`.
   */
  headers: Record<string, string>;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(digest);
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return globalThis.crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

/**
 * RFC 3986 strict percent-encoding (the SigV4 flavour): unreserved characters
 * [A-Za-z0-9-._~] stay literal, everything else is %XX — including the characters
 * `encodeURIComponent` leaves alone (! ' ( ) *).
 */
export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Encodes an S3 object key for the URI path: each segment encoded, "/" kept. */
export function encodeS3Key(key: string): string {
  return key
    .split("/")
    .map((segment) => rfc3986Encode(segment))
    .join("/");
}

function amzTimestamp(now: Date): { amzDate: string; dateStamp: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const amzDate = `${dateStamp}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return { amzDate, dateStamp };
}

function canonicalQueryString(params?: Record<string, string>): string {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => [rfc3986Encode(k), rfc3986Encode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/**
 * Signs one S3 request. Returns the headers to send (see {@link SigV4SignResult}).
 */
export async function signS3Request(input: SigV4SignInput): Promise<SigV4SignResult> {
  const { amzDate, dateStamp } = amzTimestamp(input.now ?? new Date());
  const service = "s3";

  // All signed headers: caller extras + the SigV4 required set. Keys lowercased,
  // values trimmed (we control every caller, so no multi-space collapsing needed).
  const signable: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    signable[k.toLowerCase()] = v.trim();
  }
  signable["host"] = input.host;
  signable["x-amz-content-sha256"] = input.payloadHash;
  signable["x-amz-date"] = amzDate;

  const sortedNames = Object.keys(signable).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${signable[n]}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.canonicalUri,
    canonicalQueryString(input.queryParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.credentials.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${input.credentials.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, input.credentials.region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  headers["x-amz-content-sha256"] = input.payloadHash;
  headers["x-amz-date"] = amzDate;
  headers["Authorization"] = authorization;
  return { headers };
}
