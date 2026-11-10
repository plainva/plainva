import createDOMPurify from "dompurify";

// The package's default export is a FACTORY in module environments — bind it
// lazily to the window (desktop + jsdom tests both have one at call time).
let purifierInstance: ReturnType<typeof createDOMPurify> | null = null;
function purifier(): ReturnType<typeof createDOMPurify> {
  purifierInstance ??= createDOMPurify(window);
  return purifierInstance;
}

/**
 * E-mail HTML sanitizer (PIM stage 5): the sandbox viewer renders FOREIGN,
 * attacker-controlled HTML — the single largest new attack surface of the
 * PIM expansion. Defense in depth:
 *
 *   1. DOMPurify strips scripts/event handlers/forms entirely.
 *   2. REMOTE CONTENT IS HARD-BLOCKED (tracking pixels, remote images, css
 *      url() loaders): every fetching attribute with a remote target is
 *      removed and counted; only self-contained data: images survive.
 *      Links KEEP their (DOMPurify-vetted, safe-scheme) href; the reader routes
 *      a click to the SYSTEM browser (MailView.handleFrameLoad) — a bare
 *      target=_blank never opens inside a Tauri WebView. No scripts and no
 *      remote content run, so a link can only navigate on an explicit click.
 *   3. The caller renders the result into an allow-same-origin sandboxed
 *      <iframe> that has NO allow-scripts (so the mail HTML cannot execute any
 *      code) plus a default-src 'none' CSP meta — belt and braces should 1+2
 *      miss.
 */

export interface SanitizedEmail {
  html: string;
  /** Number of removed remote references (shown as a "blocked" hint). */
  blockedRemote: number;
}

export interface SanitizeEmailOptions {
  /** Explicit user opt-in (per message or the global setting): https: image
   * sources are allowed to load. This is the ONLY relaxation — loading a
   * remote image is by definition a tracking beacon (sender sees IP and open
   * time), which is why the default stays blocked. Everything else (scripts,
   * forms, css url(), srcset/poster/background, non-https schemes, links)
   * remains hard-blocked even with the opt-in. */
  allowRemoteImages?: boolean;
}

const FETCHING_ATTRS = new Set(["src", "srcset", "poster", "background", "xlink:href", "action", "formaction", "ping"]);
const DATA_IMAGE = /^\s*data:image\//i;
const HTTPS_URL = /^\s*https:\/\//i;

export function sanitizeEmailHtml(raw: string, options?: SanitizeEmailOptions): SanitizedEmail {
  let blockedRemote = 0;
  const allowRemoteImages = options?.allowRemoteImages === true;

  const hook = (node: unknown, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    const name = data.attrName.toLowerCase();
    const value = data.attrValue ?? "";
    if (FETCHING_ATTRS.has(name)) {
      // Only self-contained data: images may load; everything else is a
      // network fetch (tracking) or a foreign scheme — cut and count.
      if (name === "src" && DATA_IMAGE.test(value)) return;
      // Opt-in: https images on actual <img> elements (never srcset/poster/
      // background, never other schemes — the frame CSP mirrors this).
      if (
        allowRemoteImages &&
        name === "src" &&
        HTTPS_URL.test(value) &&
        String((node as Element | null)?.tagName ?? "").toLowerCase() === "img"
      ) {
        return;
      }
      blockedRemote++;
      data.keepAttr = false;
      return;
    }
    // href is KEPT: DOMPurify's default URI policy already drops javascript:/
    // data: and other unsafe schemes, leaving safe http/https/mailto/tel links.
    // Opening is handled by the reader (MailView.handleFrameLoad routes a click
    // to the system browser) — no target/rel rewriting needed here.
    if (name === "style" && /url\s*\(/i.test(value)) {
      // css url() is a fetch too (background-image tracking pixels et al.).
      blockedRemote++;
      data.keepAttr = false;
    }
  };

  const dp = purifier();
  dp.addHook("uponSanitizeAttribute", hook);
  let html: string;
  try {
    html = dp.sanitize(raw, {
      // <style> blocks can url()-fetch; forms/meta/base have no business in
      // a read-only viewer.
      FORBID_TAGS: ["style", "link", "form", "input", "button", "select", "textarea", "meta", "base"],
      USE_PROFILES: { html: true },
    });
  } finally {
    dp.removeHook("uponSanitizeAttribute");
  }
  return { html, blockedRemote };
}

/**
 * The reading canvas of the app's theme, for a mail that paints nothing itself
 * (finding X3, review 2026-11-10). Plain colour values: the frame is its own
 * document, where the app's custom properties do not resolve.
 */
export interface MailCanvas {
  text: string;
  background: string;
  link: string;
  /** Whether the canvas is dark, so scrollbars and controls follow it. */
  dark: boolean;
}

/** A colour value as computed styles report it — nothing that could close the rule. */
const SAFE_COLOUR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([0-9a-z.,%\s/+-]*\)|[a-z]+)$/i;

/**
 * Whether a sanitized mail sets colours of its own: a background or a text
 * colour in a `style`, a `bgcolor`/`background` attribute or a `<font color>`.
 *
 * Such a mail is designed against a light page (dark text, a white or coloured
 * table), and a dark canvas would leave its text unreadable — it keeps the
 * white sheet every mail client gives it. A mail that sets nothing is text
 * with markup, and that reads in the app's own colours, exactly like a
 * plain-text mail. Conservative on purpose: any colour at all counts.
 * `<style>` blocks never reach this point (the sanitizer removes them).
 */
export function mailHtmlPaintsItself(sanitizedHtml: string): boolean {
  if (/<[a-z][^>]*\s(bgcolor|background)\s*=/i.test(sanitizedHtml)) return true;
  if (/<font\b[^>]*\scolor\s*=/i.test(sanitizedHtml)) return true;
  return /\sstyle\s*=\s*("[^"]*|'[^']*)\b(background|color)\b[^:;"']*:/i.test(sanitizedHtml);
}

export interface MailFrameOptions extends SanitizeEmailOptions {
  /**
   * The app theme's reading canvas. Used only for a mail that paints nothing
   * itself; without it, or for a mail that does, the frame is the white sheet.
   */
  canvas?: MailCanvas | null;
}

/** The colours of the frame's body: the theme's canvas where it may, else the white sheet. */
export function mailCanvasRules(canvas: MailCanvas | null | undefined, sanitizedHtml: string): string {
  const white = "body{color:#222;background:#fff}";
  if (!canvas || mailHtmlPaintsItself(sanitizedHtml)) return white;
  const text = canvas.text.trim();
  const background = canvas.background.trim();
  const link = canvas.link.trim();
  if (![text, background, link].every((value) => SAFE_COLOUR.test(value))) return white;
  return `:root{color-scheme:${canvas.dark ? "dark" : "light"}}body{color:${text};background:${background}}a{color:${link}}`;
}

/** Full srcdoc for the sandboxed iframe: hardened CSP + readable defaults.
 * With the remote-image opt-in the CSP widens img-src to https: — exactly
 * mirroring what the sanitizer lets through; everything else stays 'none'.
 *
 * The color/font-size literals in the embedded <style> are a documented
 * design-token exception, not an oversight: this string becomes the iframe's
 * OWN document via srcdoc, a separate CSS scope that never inherits the
 * parent app's :root custom properties (var(--bg-primary) etc. would simply
 * fail to resolve here) — so there is no app token to reference. A mail that
 * sets colours of its own gets a fixed reading canvas (dark text on white),
 * as in any mail client's message pane. A mail that sets none gets the app
 * theme's canvas when the host passes one (`options.canvas`, read from the
 * theme by `readMailCanvas`): in the dark design it used to be a white sheet
 * as well, although nothing in it asked for one (finding X3). */
export function buildMailFrameDoc(sanitizedHtml: string, options?: MailFrameOptions): string {
  const imgSrc = options?.allowRemoteImages ? "data: https:" : "data:";
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'">` +
    // Never leak the referrer if a link ever does navigate.
    `<meta name="referrer" content="no-referrer">` +
    `<style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;margin:12px;word-break:break-word}` +
    mailCanvasRules(options?.canvas, sanitizedHtml) +
    // -webkit-touch-callout: a held link shows the APP's sheet with its target
    // (mailLinks.ts), not the system's link preview — which would load the page.
    `img{max-width:100%;height:auto}table{max-width:100%}a{text-decoration:underline;cursor:pointer;-webkit-touch-callout:none}</style>` +
    `</head><body>${sanitizedHtml}</body></html>`
  );
}
