import { extractContent, type PageContent } from "./extract.js";
import { checkWebUrl, sameSite, WEB_CONTENT_TYPES, type WebUrlProblem } from "./rules.js";

/**
 * Reading one page (plan KI-Harness P4). The request itself is made natively
 * — `ai_web_fetch` on the desktop, the `AiWeb` plugin on the phone — because
 * only there can a rule about the network be enforced: one GET, https, no
 * credentials, no cookies, no body, only public addresses, redirects inside
 * the site. This module is the contract of that call and the second look at
 * its answer: the web view does not trust what comes back from the network
 * any more than the native side trusts what the web view asks for.
 */

export type WebFetchRefusal =
  | WebUrlProblem
  /** The name resolved to an address that is not on the public internet. */
  | "private-address"
  | "too-many"
  | "no-location"
  /** Not text a reader could take: an image, an archive, a program. */
  | "content-type";

export type WebFetchFailure = "offline" | "timeout" | "tls" | "cancelled" | "error";

export type WebFetchResult =
  /** `url` is the address the body came from, after redirects inside the site. */
  | { kind: "page"; url: string; status: number; contentType: string; body: string; truncated: boolean }
  /** A redirect to another site: not followed. */
  | { kind: "elsewhere"; url: string }
  | { kind: "refused"; problem: WebFetchRefusal }
  | { kind: "failed"; code: WebFetchFailure; message?: string };

export interface WebFetcher {
  fetch(url: string, options: { requestId: string; signal?: AbortSignal }): Promise<WebFetchResult>;
}

export type PageRead =
  | { ok: true; url: string; page: PageContent }
  /** `text` is what the model is told; `elsewhere` carries the address of the other site. */
  | { ok: false; kind: "elsewhere"; url: string; text: string }
  | { ok: false; kind: "refused" | "http" | "failed" | "empty"; text: string };

const REFUSAL_TEXT: Record<WebFetchRefusal, string> = {
  "not-a-url": "This is not a web address.",
  scheme: "Only https pages can be read.",
  credentials: "An address with a user name or password in it is not requested.",
  port: "Only the standard https port is requested.",
  host: "This host is not on the public internet (an IP address, a local name or a reserved one).",
  "too-long": "The address is too long.",
  "private-address": "The name leads to an address that is not on the public internet.",
  "too-many": "The page redirects too often.",
  "no-location": "The page redirects without saying where to.",
  "content-type": "The address does not lead to text that can be read (an image, a file or a program).",
};

const FAILURE_TEXT: Record<WebFetchFailure, string> = {
  offline: "The page could not be reached: no connection, or the name does not exist.",
  timeout: "The page did not answer in time.",
  tls: "The connection to the page is not secure (its certificate was not accepted).",
  cancelled: "The request was stopped.",
  error: "The page could not be read.",
};

const contentTypeOf = (header: string) => header.split(";")[0]!.trim().toLowerCase();

/**
 * Reads a page and takes it down as a reader would. Every answer of the
 * native side is checked again against the rules it was asked to keep; an
 * answer that breaks one is treated as refused, whoever let it through.
 */
export async function readPage(fetcher: WebFetcher, rawUrl: string, options: { requestId: string; signal?: AbortSignal }): Promise<PageRead> {
  const asked = checkWebUrl(rawUrl);
  if (!asked.ok) return { ok: false, kind: "refused", text: REFUSAL_TEXT[asked.problem] };
  let result: WebFetchResult;
  try {
    result = await fetcher.fetch(asked.target.url, options);
  } catch {
    return { ok: false, kind: "failed", text: FAILURE_TEXT.error };
  }
  if (result.kind === "refused") return { ok: false, kind: "refused", text: REFUSAL_TEXT[result.problem] ?? REFUSAL_TEXT.host };
  if (result.kind === "failed") return { ok: false, kind: "failed", text: FAILURE_TEXT[result.code] ?? FAILURE_TEXT.error };
  const landed = checkWebUrl(result.url);
  if (!landed.ok) return { ok: false, kind: "refused", text: REFUSAL_TEXT[landed.problem] };
  if (result.kind === "elsewhere") {
    return { ok: false, kind: "elsewhere", url: landed.target.url, text: `The page redirects to another site: ${landed.target.url} — fetch that address if it is the page you need.` };
  }
  // A body from another site than the one asked for means a redirect was followed that should not have been.
  if (!sameSite(asked.target.host, landed.target.host)) return { ok: false, kind: "refused", text: REFUSAL_TEXT["too-many"] };
  if (result.status < 200 || result.status >= 300) return { ok: false, kind: "http", text: `The server answered with status ${result.status}.` };
  const type = contentTypeOf(result.contentType);
  if (type && !WEB_CONTENT_TYPES.includes(type)) return { ok: false, kind: "refused", text: REFUSAL_TEXT["content-type"] };
  const page = extractContent(result.body, result.contentType, landed.target.url);
  if (!page.text) return { ok: false, kind: "empty", text: "The page has no text that can be read (it may need a browser to show its content)." };
  return { ok: true, url: landed.target.url, page: { ...page, truncated: page.truncated || result.truncated } };
}
