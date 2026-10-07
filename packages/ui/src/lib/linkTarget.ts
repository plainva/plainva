/**
 * Where a link leads — one description for every surface that shows a
 * stranger's link (plan Befunde 06.10., M1): the description of a calendar
 * event, the body of a mail, the phone's link sheet.
 *
 * Three questions, answered once:
 *
 *  - WHAT OPENS is always the address as written. A Microsoft Safe Link opens
 *    as the Safe Link: the check an organisation put in front of the target is
 *    not ours to skip.
 *  - WHAT IS SHOWN is the destination — for a Safe Link its real target — with
 *    the host singled out, because the host is the part that answers "where".
 *    The host comes from the URL parser, never from the text: `user@` tricks
 *    (`https://bank.example@evil.example/`) and percent-encoding do not move
 *    it, and an internationalised name is shown in its punycode form, which is
 *    what tells a look-alike apart from the name it imitates.
 *  - DOES THE VISIBLE TEXT NAME ANOTHER PLACE? Only asked when the text itself
 *    is an address or a domain; ordinary words never raise it.
 *
 * Pure and linear: no regular expression here walks foreign text with nested
 * quantifiers.
 */

/** Hosts of Microsoft's Safe Links rewriter (commercial and US government clouds). */
const SAFE_LINK_SUFFIXES = [".safelinks.protection.outlook.com", ".safelinks.protection.office365.us"];

const MAX_TIP = 96;
/** Far beyond any honest address; what is longer is cut rather than laid out. */
const MAX_SHOWN = 2000;
const MAX_USERINFO = 24;

export type LinkTargetKind = "web" | "mailto" | "tel";

export interface LinkTarget {
  /** What opens — ALWAYS the address as written, a Safe Link included. */
  href: string;
  kind: LinkTargetKind;
  /** The destination, split around its host: `before` + `host` + `after`. */
  before: string;
  /** The host the link leads to (a Safe Link's target; a mail address's domain). Empty for `tel:`. */
  host: string;
  after: string;
  /** The address is a Microsoft Safe Link; the parts above name its target. */
  viaSafeLinks: boolean;
  /**
   * The visible text is itself an address or a domain, and it names another
   * registrable host than the destination. Carries the host the text names.
   */
  textHost: string | null;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function httpUrl(raw: string): URL | null {
  const url = parseUrl(raw);
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url : null;
}

/** Cuts a long address to a readable tooltip, keeping its start. */
export function shortenUrl(url: string, max = MAX_TIP): string {
  return url.length > max ? `${url.slice(0, max - 1)}…` : url;
}

/** The destination of an http(s) address: itself, or a Safe Link's target. */
function httpDestination(href: string): { url: URL; viaSafeLinks: boolean } | null {
  const url = httpUrl(href);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  if (SAFE_LINK_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    const target = httpUrl(url.searchParams.get("url") ?? "");
    if (target) return { url: target, viaSafeLinks: true };
  }
  return { url, viaSafeLinks: false };
}

/**
 * The destination of an http(s) link as host and full address — what the
 * event description's chip is built from. `null` for anything that is not
 * http(s) (`javascript:`, `data:`, `file:`, `mailto:` …).
 */
export function describeHttpLink(href: string): { href: string; host: string; address: string; viaSafeLinks: boolean } | null {
  const clean = href.trim();
  const dest = httpDestination(clean);
  if (!dest) return null;
  return { href: clean, host: dest.url.hostname, address: dest.url.href, viaSafeLinks: dest.viaSafeLinks };
}

/** Second-level labels that are public registries under a two-letter country code (`co.uk`, `com.au`). */
const REGISTRY_SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne", "go", "mil", "nom", "sch"]);

/**
 * The part of a host a person registers (`mail.bank.example` → `bank.example`).
 * A heuristic without the public-suffix list: the last two labels, or three
 * when the second-level label is a known registry under a country code. Where
 * it is wrong it is wrong towards "same place" (two names under an unknown
 * shared suffix compare equal) — it never invents a warning.
 */
export function registrableHost(host: string): string {
  const clean = host.toLowerCase().replace(/\.$/, "");
  // An IP address is its own identity.
  if (clean.includes(":") || /^[0-9.]+$/.test(clean)) return clean;
  const labels = clean.split(".");
  if (labels.length <= 2) return clean;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && REGISTRY_SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Endings that make a dotted word a FILE name rather than a domain (`report.pdf`). */
const FILE_ENDINGS = new Set([
  "pdf", "htm", "html", "php", "asp", "aspx", "jsp", "md", "txt", "rtf", "csv", "json", "xml", "yml", "yaml",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "ics", "eml", "msg", "vcf",
  "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tif", "tiff", "heic", "mp3", "mp4", "mov", "avi", "wav", "webm",
  "zip", "rar", "gz", "tar", "exe", "dmg", "apk", "js", "ts", "css", "py", "rs", "sh", "bat", "log",
]);

function isDomainChar(code: number): boolean {
  // a-z, 0-9, hyphen, dot — and anything beyond ASCII (an internationalised name).
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45 || code === 46 || code > 127;
}

function isLetters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || c > 127)) return false;
  }
  return text.length > 0;
}

/**
 * The host a piece of visible text names, when the text IS an address or a
 * domain — else `null`. Deliberately narrow: one unbroken token, either with a
 * scheme, or a dotted name whose last label is letters and not a file ending.
 * "Read more", "z.B.", "report.pdf" and "3.5" name no host.
 */
export function hostNamedByText(text: string): string | null {
  let token = text.trim();
  if (!token || token.length > MAX_SHOWN) return null;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 160) return null;
  }
  // Brackets and sentence punctuation around an address are not part of it.
  while (token && "<([\"'".includes(token[0])) token = token.slice(1);
  while (token && ">)].,;:!?\"'".includes(token[token.length - 1])) token = token.slice(0, -1);
  if (!token) return null;
  const lower = token.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    const url = httpUrl(token);
    return url ? url.hostname.toLowerCase() : null;
  }
  // A scheme we do not compare (mailto:, tel:, ftp: …) names no web host.
  const colon = lower.indexOf(":");
  const slash = lower.indexOf("/");
  if (colon !== -1 && (slash === -1 || colon < slash)) {
    const port = lower.slice(colon + 1, slash === -1 ? undefined : slash);
    if (!/^[0-9]{1,5}$/.test(port)) return null;
  }
  if (lower.includes("@")) return null;
  let end = 0;
  while (end < lower.length && isDomainChar(lower.charCodeAt(end))) end++;
  const name = lower.slice(0, end);
  const rest = lower.slice(end);
  if (rest && !"/:?#".includes(rest[0])) return null;
  const labels = name.split(".");
  if (labels.length < 2 || labels.some((label) => !label)) return null;
  const last = labels[labels.length - 1];
  if (last.length < 2 || !isLetters(last)) return null;
  // Without a path or a `www.`, a dotted word may just be a file name.
  if (!rest && labels[0] !== "www" && FILE_ENDINGS.has(last)) return null;
  // Through the URL parser, so an internationalised name compares in the same
  // (punycode) form the destination's host has.
  const url = httpUrl(`https://${name}/`);
  return url ? url.hostname.toLowerCase() : null;
}

/** The domain of a mail address written as text (`anna@bank.example`), else null. */
function mailDomainOf(text: string): string | null {
  const token = text.trim().toLowerCase();
  const at = token.lastIndexOf("@");
  if (at <= 0 || at === token.length - 1 || token.indexOf(" ") !== -1) return null;
  let domain = token.slice(at + 1);
  while (domain && ">).,;".includes(domain[domain.length - 1])) domain = domain.slice(0, -1);
  return domain.includes(".") ? domain : null;
}

function cut(text: string): string {
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text;
}

/**
 * Describes a link for display — or `null` for a scheme nobody should follow
 * from a stranger's text (`javascript:`, `data:`, `file:` …).
 *
 * `visibleText` is what the link shows; pass it to have the description say
 * when that text names another place than the link leads to.
 */
export function describeLink(href: string, visibleText?: string | null): LinkTarget | null {
  const clean = href.trim();
  const lower = clean.slice(0, 8).toLowerCase();

  if (lower.startsWith("mailto:")) {
    const rest = clean.slice("mailto:".length);
    const query = rest.indexOf("?");
    let address = query === -1 ? rest : rest.slice(0, query);
    try {
      address = decodeURIComponent(address);
    } catch {
      /* show it as written */
    }
    const at = address.lastIndexOf("@");
    const host = at === -1 ? "" : address.slice(at + 1).toLowerCase();
    const named = visibleText ? mailDomainOf(visibleText) : null;
    return {
      href: clean,
      kind: "mailto",
      before: cut(`mailto:${at === -1 ? address : address.slice(0, at + 1)}`),
      host,
      after: "",
      viaSafeLinks: false,
      textHost: named && host && registrableHost(named) !== registrableHost(host) ? named : null,
    };
  }

  if (lower.startsWith("tel:")) {
    return { href: clean, kind: "tel", before: cut(clean), host: "", after: "", viaSafeLinks: false, textHost: null };
  }

  const dest = httpDestination(clean);
  if (!dest) return null;
  const { url, viaSafeLinks } = dest;
  const host = url.hostname;
  // `https://bank.example@evil.example/`: the part before the `@` is a name the
  // sender made up, and a long one would push the real host out of sight. It
  // is shown, but short — the host after it is the destination.
  const user = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}` : "";
  const userinfo = user ? `${user.length > MAX_USERINFO ? `${user.slice(0, MAX_USERINFO - 1)}…` : user}@` : "";
  const after = `${url.port ? `:${url.port}` : ""}${url.pathname === "/" && !url.search && !url.hash ? "" : url.pathname}${url.search}${url.hash}`;
  const named = visibleText ? hostNamedByText(visibleText) : null;
  return {
    href: clean,
    kind: "web",
    before: `${url.protocol}//${userinfo}`,
    host,
    after: cut(after),
    viaSafeLinks,
    textHost: named && registrableHost(named) !== registrableHost(host) ? named : null,
  };
}
