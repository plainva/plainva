/**
 * The rules of the AI's way onto the internet (plan §17.1, threat T2).
 *
 * The internet is off until the user switches it on for a vault, and even
 * then a page is only ever READ: one GET, no credentials, no cookies, no
 * body. What is decided here is decided again natively — the shells' fetch
 * commands mirror these functions and their test vectors — because the web
 * view is not where a network rule can be enforced.
 *
 * Three questions are answered here: where may a request go (`checkWebUrl`,
 * `isPublicAddress`), what may it follow (`redirectDecision`), and what did
 * the user allow without being asked again (`hostAllowed`).
 */

/** Longer addresses are refused: a page address this long carries a payload. */
export const WEB_URL_MAX = 2048;
/** A page that needs more hops than this is not worth following. */
export const WEB_MAX_REDIRECTS = 5;
/** The body is cut here; what a reader needs of a page is its beginning. */
export const WEB_MAX_BYTES = 2_000_000;
export const WEB_TIMEOUT_MS = 20_000;

/** What the native fetch accepts as a page: text a reader can extract from. */
export const WEB_CONTENT_TYPES: readonly string[] = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

export type WebUrlProblem =
  /** Not an address at all. */
  | "not-a-url"
  /** Anything but https: plain http shows the address to the network and can be rewritten on the way. */
  | "scheme"
  /** `user:password@host` — a request never carries credentials. */
  | "credentials"
  /** A port other than 443: services on other ports are not pages. */
  | "port"
  /** No public host name: an IP address, a single label, a name reserved for local networks. */
  | "host"
  | "too-long";

export interface WebTarget {
  /** The address as it is requested: normalised, without a fragment. */
  url: string;
  /** Lowercase host name (punycode for international names). */
  host: string;
}

/**
 * Names that never leave the local network or are reserved for it (RFC 6761,
 * RFC 6762, RFC 8375 and what routers and companies commonly use). A name
 * ending in one of these is refused before any lookup.
 */
const LOCAL_SUFFIXES: readonly string[] = ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "home.arpa", "test", "example", "invalid", "onion", "arpa"];

function hostProblem(host: string): boolean {
  if (!host || host.length > 253) return true;
  // IPv6 literals keep their brackets in `hostname`; IPv4 in any spelling (hex, octal, fewer parts) is normalised to dotted decimal by the URL parser.
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return true;
  const labels = host.split(".");
  if (labels.length < 2) return true;
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-"))) return true;
  // A top-level name is letters or punycode — never digits, which would be an address in disguise.
  const tld = labels[labels.length - 1]!;
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(tld)) return true;
  return LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** Whether a request may go to this address at all. The answer is the same in every shell. */
export function checkWebUrl(raw: string): { ok: true; target: WebTarget } | { ok: false; problem: WebUrlProblem } {
  const text = raw.trim();
  // Control characters and whitespace inside an address are how a parser is made to disagree with a reader.
  if (!text || [...text].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return { ok: false, problem: "not-a-url" };
  if (text.length > WEB_URL_MAX) return { ok: false, problem: "too-long" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: "not-a-url" };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "scheme" };
  if (url.username || url.password) return { ok: false, problem: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, problem: "port" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostProblem(host)) return { ok: false, problem: "host" };
  url.hostname = host;
  url.port = "";
  url.hash = "";
  if (url.href.length > WEB_URL_MAX) return { ok: false, problem: "too-long" };
  return { ok: true, target: { url: url.href, host } };
}

function ipv4Parts(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function publicIpv4(parts: readonly number[]): boolean {
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false; // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // protocol assignments, documentation
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // documentation
  if (a === 203 && b === 0 && c === 113) return false; // documentation
  return a < 224; // multicast, reserved, broadcast
}

/** The eight groups of an IPv6 address, or null when it is none. Accepts `::` and a trailing dotted IPv4. */
function ipv6Groups(text: string): number[] | null {
  let source = text.toLowerCase();
  const zone = source.indexOf("%");
  if (zone >= 0) source = source.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(source) || !source.includes(":")) return null;
  // A dotted IPv4 may stand for the last two groups (`::ffff:192.0.2.1`).
  let last: number[] = [];
  const colon = source.lastIndexOf(":");
  const tail = source.slice(colon + 1);
  if (tail.includes(".")) {
    const v4 = ipv4Parts(tail);
    if (!v4) return null;
    last = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    source = source.slice(0, colon + 1);
    // What remains ends in the separator before the IPv4 — unless that colon is half of a `::`.
    if (!source.endsWith("::")) source = source.slice(0, -1);
  }
  const gap = source.indexOf("::");
  if (gap !== source.lastIndexOf("::")) return null;
  const read = (part: string): number[] => (part === "" ? [] : part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN)));
  if (gap < 0) {
    const all = [...read(source), ...last];
    return all.length === 8 && !all.some(Number.isNaN) ? all : null;
  }
  const head = read(source.slice(0, gap));
  const rest = read(source.slice(gap + 2));
  const known = head.length + rest.length + last.length;
  if (known > 7 || [...head, ...rest].some(Number.isNaN)) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...last];
}

function publicIpv6(groups: readonly number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const embedded = () => publicIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    // IPv4-mapped is only as public as the address inside; `::`, `::1` and the deprecated IPv4-compatible form are not public.
    return g5 === 0xffff && embedded();
  }
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(); // NAT64
  if (g0 === 0x2002) return publicIpv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]); // 6to4
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false; // site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return false; // multicast
  return (g0 & 0xe000) === 0x2000; // global unicast is 2000::/3; everything else is unassigned
}

/**
 * Whether an address a host name resolved to lies on the public internet.
 * The native fetch connects only when EVERY address of the name does — a name
 * that answers with a public address first and a private one second is the
 * rebinding trick, and the request it serves would reach the user's router,
 * another device at home or a cloud's metadata service.
 */
export function isPublicAddress(address: string): boolean {
  const text = address.trim().replace(/^\[|\]$/g, "");
  const v4 = ipv4Parts(text);
  if (v4) return publicIpv4(v4);
  const v6 = ipv6Groups(text);
  return v6 ? publicIpv6(v6) : false;
}

const withoutWww = (host: string) => host.replace(/^www\./, "");

/** One site for a redirect: the same host, `www.` or not, or one name below the other. */
export function sameSite(a: string, b: string): boolean {
  const [x, y] = [withoutWww(a.toLowerCase()), withoutWww(b.toLowerCase())];
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

export type RedirectDecision =
  | { kind: "follow"; target: WebTarget }
  /** Another site: the request stops, and the page says where it wanted to go. A new request is a new decision. */
  | { kind: "elsewhere"; target: WebTarget }
  | { kind: "refused"; problem: WebUrlProblem | "too-many" | "no-location" };

/**
 * What to do with a redirect. `location` is the header as the server sent it
 * (it may be relative), `from` the address that was requested, `hops` how many
 * redirects were followed already. A redirect inside the site is followed; one
 * to another site is not — the user approved a page of this site, and an
 * address chosen by a server is exactly where a request can be made to carry
 * something.
 */
export function redirectDecision(from: WebTarget, location: string | null | undefined, hops: number): RedirectDecision {
  if (hops >= WEB_MAX_REDIRECTS) return { kind: "refused", problem: "too-many" };
  if (!location || !location.trim()) return { kind: "refused", problem: "no-location" };
  let next: string;
  try {
    next = new URL(location.trim(), from.url).href;
  } catch {
    return { kind: "refused", problem: "not-a-url" };
  }
  const checked = checkWebUrl(next);
  if (!checked.ok) return { kind: "refused", problem: checked.problem };
  return sameSite(from.host, checked.target.host) ? { kind: "follow", target: checked.target } : { kind: "elsewhere", target: checked.target };
}

/**
 * A host as the user allows it for a vault: what they typed, reduced to the
 * name. `https://docs.example.org/guide` and `*.example.org` both read as a
 * name; null when it is none.
 */
export function normalizeAllowedHost(raw: string): string | null {
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  // Whatever scheme was typed, a rule is about the name; the request itself is always https.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\*\./, "");
  const checked = checkWebUrl(`https://${text}`);
  return checked.ok ? checked.target.host : null;
}

/** A host the user allowed, or one below it: `example.org` covers `docs.example.org`, never the other way round. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  const name = host.toLowerCase();
  return allow.some((rule) => name === rule || name.endsWith(`.${rule}`));
}

/** Per vault, on this device: whether the AI may use the internet here at all, and which sites it need not ask for. */
export interface WebSettings {
  enabled: boolean;
  /** Hosts whose pages are fetched without asking each time. Searches are always asked for while private data is in the run. */
  allow: string[];
}

/** A vault nobody decided about has no way onto the internet. */
export const DEFAULT_WEB_SETTINGS: WebSettings = { enabled: false, allow: [] };

export const WEB_ALLOW_MAX = 200;

/** The stored settings, field by field; what does not read is the default. */
export function readWebSettings(raw: string | null): WebSettings {
  if (raw === null) return DEFAULT_WEB_SETTINGS;
  let value: { version?: unknown; enabled?: unknown; allow?: unknown };
  try {
    value = JSON.parse(raw) as typeof value;
  } catch {
    return DEFAULT_WEB_SETTINGS;
  }
  if (!value || typeof value !== "object" || value.version !== 1) return DEFAULT_WEB_SETTINGS;
  const allow: string[] = [];
  for (const item of Array.isArray(value.allow) ? value.allow : []) {
    const host = typeof item === "string" ? normalizeAllowedHost(item) : null;
    if (host && !allow.includes(host) && allow.length < WEB_ALLOW_MAX) allow.push(host);
  }
  return { enabled: value.enabled === true, allow };
}

export function serializeWebSettings(settings: WebSettings): string {
  return JSON.stringify({ version: 1, enabled: settings.enabled, allow: settings.allow }, null, 2);
}

/** Adds a host to the allowed ones; a host already covered by a wider rule changes nothing. */
export function allowHost(settings: WebSettings, raw: string): WebSettings {
  const host = normalizeAllowedHost(raw);
  if (!host || hostAllowed(host, settings.allow) || settings.allow.length >= WEB_ALLOW_MAX) return settings;
  // The new rule replaces narrower ones it covers.
  return { ...settings, allow: [...settings.allow.filter((rule) => !rule.endsWith(`.${host}`)), host].sort() };
}

export function disallowHost(settings: WebSettings, host: string): WebSettings {
  const allow = settings.allow.filter((rule) => rule !== host);
  return allow.length === settings.allow.length ? settings : { ...settings, allow };
}
