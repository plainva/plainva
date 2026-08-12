/**
 * "Is this server address unencrypted AND reachable from outside my network?"
 *
 * Plainva allows `http://` — a self-hosted server on a home network is a normal
 * thing to sync against, and blocking it outright made those setups impossible
 * on Android (issue #48). But the two cases are not equally harmless: WebDAV
 * authenticates with Basic auth, so the password travels on EVERY request. On a
 * LAN that is a risk someone may knowingly take. Across the internet it is not a
 * risk, it is a mistake — and that is the only case worth interrupting someone
 * over.
 *
 * So this answers the narrow question, and the forms warn only when it says yes.
 * Nothing here blocks anything; the decision stays with the person typing.
 */

/** RFC 1918 / RFC 4193 / loopback / link-local — "inside my own network". */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  // Unique local addresses (fc00::/7) and IPv6 link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  // Names that only resolve inside a local network. `.local` is mDNS; the
  // others are the reserved private-use TLDs people actually use at home.
  if (/\.(local|internal|lan|home|intranet|localdomain)$/.test(h)) return true;
  // A bare hostname with no dot cannot be a public name.
  if (!h.includes(".") && !/^\d+$/.test(h)) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, Number(v4[2]), Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    if (a === 127 || a === 10) return true; // loopback, 10/8
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64/10) — Tailscale et al.
  }
  return false;
}

/**
 * True when the address uses plain http AND its host is not a private one —
 * i.e. credentials would cross a network the user does not control.
 *
 * Anything unparseable returns false: a half-typed address is not a finding,
 * and a warning that fires while someone is still typing gets ignored.
 */
export function isInsecurePublicUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  return !isPrivateHost(url.hostname);
}
