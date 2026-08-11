/**
 * Reading `List-Unsubscribe` (S23, plan P12).
 *
 * Newsletters carry the way out in their own headers (RFC 2369, and RFC 8058
 * for the one-click variant). Plainva does not guess it from the body, and it
 * does not click anything on the reader's behalf: it reads what the sender
 * declared and offers it. What follows the offer is a browser or a mail — both
 * visible acts, neither of them silent.
 *
 * The distinction that matters is between a `mailto:` and an `https:` route.
 * A mailto unsubscribe is a message the reader SENDS, so it must be shown before
 * it leaves. An https route is a page, and only becomes a one-click POST when
 * the sender also sent `List-Unsubscribe-Post` — without that header, a POST is
 * a request nobody asked for.
 */

export interface UnsubscribeRoute {
  kind: "mailto" | "http";
  /** The address for a mailto route, or the URL for an http one. */
  target: string;
  /** Subject the sender asked for in a mailto route, if any. */
  subject?: string;
  /**
   * The sender declared RFC 8058 one-click. Only then may a client POST; without
   * it the http route is a page to open, not an action to perform.
   */
  oneClick: boolean;
}

/** Everything a message offers, in the order a UI should prefer it. */
export interface UnsubscribeOffer {
  routes: UnsubscribeRoute[];
  /** Whether anything was declared at all. */
  available: boolean;
}

const ANGLE = /<([^>]+)>/g;

/**
 * Parses the two headers into routes.
 *
 * `List-Unsubscribe` is a comma-separated list of angle-bracketed URIs; senders
 * commonly give both a mailto and an https route. Anything that is neither is
 * dropped rather than passed on — an unknown scheme in a header from a stranger
 * is not something to hand to the system opener.
 */
export function parseUnsubscribe(headers: {
  listUnsubscribe?: string | null;
  listUnsubscribePost?: string | null;
}): UnsubscribeOffer {
  const raw = headers.listUnsubscribe ?? "";
  const oneClick = /one-?click/i.test(headers.listUnsubscribePost ?? "");
  const routes: UnsubscribeRoute[] = [];

  ANGLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANGLE.exec(raw))) {
    const uri = (m[1] ?? "").trim();
    if (/^mailto:/i.test(uri)) {
      const rest = uri.slice("mailto:".length);
      const [addr, query = ""] = rest.split("?", 2);
      const address = (addr ?? "").trim();
      if (!address) continue;
      const subject = new URLSearchParams(query).get("subject") ?? undefined;
      routes.push({ kind: "mailto", target: address, subject: subject || undefined, oneClick: false });
      continue;
    }
    if (/^https:\/\//i.test(uri)) {
      routes.push({ kind: "http", target: uri, oneClick });
      continue;
    }
    // Plain http:// is dropped along with everything else: an unsubscribe over
    // an unencrypted connection sends an address that identifies the reader.
  }

  return { routes, available: routes.length > 0 };
}

/**
 * The route to offer first.
 *
 * A one-click https route wins — it is the one the sender promised would work
 * without a form. Otherwise a plain https page beats a mailto, because opening
 * a page asks nothing of the reader's own mailbox.
 */
export function preferredRoute(offer: UnsubscribeOffer): UnsubscribeRoute | null {
  return (
    offer.routes.find((r) => r.kind === "http" && r.oneClick) ??
    offer.routes.find((r) => r.kind === "http") ??
    offer.routes.find((r) => r.kind === "mailto") ??
    null
  );
}
