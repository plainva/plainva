import { SETTINGS_AREAS, type SettingsWorld } from "./settingsCatalog";
import { SECURITY_AREAS } from "./securityCatalog";
import { SETTINGS_SEARCH_INDEX } from "./settingsSearchIndex";

/**
 * The search over all settings (settings plan 2026-10-29, § 4.3, decision E2).
 *
 * The plan moved explanations behind the ⓘ and moved settings between pages;
 * both cost findability, and the search gives it back. One field at the top of
 * the settings navigation (desktop) or over the area list (phone); a hit is a
 * ROW, shown as page › card › row, and choosing it opens the page, scrolls to
 * the row and lights it up for a moment.
 *
 * What is searched: the label, the visible line, the ⓘ text and a few
 * synonyms - all locale keys, so the search speaks the app language. Where the
 * rows come from: `SETTINGS_SEARCH_INDEX`, generated from the JSX of both
 * shells (`apps/desktop/src/test-settingsIndex.ts`), so a row added to a page
 * is found without anyone remembering to list it.
 */

export type SettingsShell = "desktop" | "mobile";

export interface SettingsIndexEntry {
  shell: SettingsShell;
  /** Catalog area id, or a page only the search knows (`vaultDetails`). */
  area: string;
  /** The sub-page the entry sits on: account, service:files, syncChain, a security area ... */
  sub?: string;
  kind: "page" | "card" | "row";
  /** The card (desktop) or group heading (phone) the row stands in. */
  card?: string;
  /** The row's label, or a sub-page's title. */
  label?: string;
  /** Visible lines under the row. */
  desc?: string[];
  /** What stands behind the row's (or card's, or page's) info button. */
  info?: string[];
}

type T = (key: string, options?: Record<string, unknown>) => string;

/** Names of the sub-pages a hit can sit on, for its path. */
export const SETTINGS_SUB_LABELS: Readonly<Record<string, string>> = {
  customTheme: "themes.names.custom",
  syncChain: "settingsSync.chainLabel",
  syncDiagnostics: "settings.groupDiagnostics",
  account: "cloudAccounts.accountGroup",
  "service:files": "cloudAccounts.serviceFiles",
  "service:calendar": "cloudAccounts.serviceCalendar",
  "service:mail": "cloudAccounts.serviceMail",
  access: "workspaceSecurity.groupAccess",
  sharing: "workspaceSecurity.groupSharing",
  ...Object.fromEntries(SECURITY_AREAS.map((area) => [area.id, area.labelKey])),
};

/**
 * Pages the search knows that are not areas of the catalog: the phone's own
 * vault screen (rename, export, delete), reached from "Active vault".
 */
export const SETTINGS_EXTRA_PAGES: Readonly<Record<string, { world: SettingsWorld; labelKey: string }>> = {
  vaultDetails: { world: "vault", labelKey: "mobile.activeVault" },
};

/**
 * Other words people use for a setting, keyed by the row's label key. Each
 * value is a locale key whose text is a comma-separated list, in every
 * language - a synonym is a word of that language, not a translation of ours.
 */
export const SETTINGS_SYNONYMS: Readonly<Record<string, string>> = {
  "settings.themeMode": "settings.searchSynonymDarkMode",
  "settings.language": "settings.searchSynonymLanguage",
  "mobile.settingLanguage": "settings.searchSynonymLanguage",
  "settings.uiZoom": "settings.searchSynonymZoom",
  "settings.syncInterval": "settings.searchSynonymSyncInterval",
  "settings.spellcheck": "settings.searchSynonymSpellcheck",
  "settings.weekStart": "settings.searchSynonymWeekStart",
  "cloudAccounts.signOutHere": "settings.searchSynonymSignOut",
  "settings.dailyNotesFolder": "settings.searchSynonymDailyNotes",
};

export interface SettingsSearchHit {
  /** Stable React key. */
  id: string;
  kind: SettingsIndexEntry["kind"];
  world: SettingsWorld;
  area: string;
  sub?: string;
  /** What the hit is called (the row, the card or the page). */
  title: string;
  /** Where it is: page › sub-page › card (without the title itself). */
  path: string;
  /** The translated card heading, for finding the row on the page. */
  cardText?: string;
  /** The page is not shown in this state (no account carries its service). */
  hidden: boolean;
}

/** Lower case, without accents and `{{placeholders}}`, for matching. */
export function normalizeSearchText(text: string): string {
  return text.replace(/\{\{[^{}]*\}\}/g, " ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function worldOf(area: string): SettingsWorld | undefined {
  return SETTINGS_AREAS.find((a) => a.id === area)?.world ?? SETTINGS_EXTRA_PAGES[area]?.world;
}

/** The page name of an area in a shell (the phone names some areas its own way). */
export function settingsPageLabel(area: string, shell: SettingsShell, t: T): string {
  const def = SETTINGS_AREAS.find((a) => a.id === area);
  if (def) return t(shell === "mobile" ? def.mobileLabelKey ?? def.labelKey : def.labelKey);
  const extra = SETTINGS_EXTRA_PAGES[area];
  return extra ? t(extra.labelKey) : area;
}

export interface SettingsSearchOptions {
  shell: SettingsShell;
  t: T;
  /** The worlds shown: the vault world only when a vault is. */
  worlds?: readonly SettingsWorld[];
  /** Areas hidden in this state - their hits stay, marked. */
  hiddenAreas?: readonly string[];
  limit?: number;
  index?: readonly SettingsIndexEntry[];
}

/**
 * The hits for a query, best first. Every word of the query has to occur
 * somewhere in a hit's texts; a hit whose label starts with the query ranks
 * above one that only mentions it behind its ⓘ.
 */
export function searchSettings(query: string, opts: SettingsSearchOptions): SettingsSearchHit[] {
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const { shell, t } = opts;
  const phrase = words.join(" ");
  const worlds = opts.worlds ?? ["app", "vault"];
  const hidden = new Set(opts.hiddenAreas ?? []);
  const index = (opts.index ?? SETTINGS_SEARCH_INDEX).filter((entry) => entry.shell === shell);
  const scored: Array<{ hit: SettingsSearchHit; score: number }> = [];
  const seen = new Set<string>();

  const texts = (keys: readonly string[] | undefined) => (keys ?? []).map((key) => t(key));
  const consider = (hit: SettingsSearchHit, title: string, more: { desc?: string[]; info?: string[]; synonyms?: string[] }) => {
    if (!worlds.includes(hit.world) || seen.has(hit.id)) return;
    const name = normalizeSearchText(title);
    const all = [name, ...(more.desc ?? []), ...(more.info ?? []), ...(more.synonyms ?? [])].map(normalizeSearchText);
    const haystack = all.join("\n");
    if (!words.every((word) => haystack.includes(word))) return;
    let score = 10;
    if (name.startsWith(phrase)) score = 100;
    else if (name.split(/[\s\-/(]+/).some((part) => part.startsWith(words[0]))) score = 80;
    else if (name.includes(phrase)) score = 60;
    else if ((more.synonyms ?? []).some((s) => normalizeSearchText(s).includes(phrase))) score = 50;
    else if ((more.desc ?? []).some((s) => normalizeSearchText(s).includes(phrase))) score = 30;
    if (hit.kind === "page") score += 5;
    if (hit.hidden) score -= 5;
    seen.add(hit.id);
    scored.push({ hit, score });
  };

  // Pages: every area of the catalog the shell shows.
  for (const area of SETTINGS_AREAS) {
    if (shell === "mobile" && area.mobileOmitted) continue;
    const title = settingsPageLabel(area.id, shell, t);
    consider({ id: `page:${area.id}`, kind: "page", world: area.world, area: area.id, title, path: "", hidden: hidden.has(area.id) }, title, { desc: [t(area.descKey)] });
  }

  for (const entry of index) {
    const world = worldOf(entry.area);
    if (!world) continue;
    const page = settingsPageLabel(entry.area, shell, t);
    const subName = entry.sub ? t(SETTINGS_SUB_LABELS[entry.sub] ?? entry.sub) : "";
    const cardText = entry.card ? t(entry.card) : undefined;
    const isHidden = hidden.has(entry.area);
    if (entry.kind === "page") {
      if (!entry.label) continue;
      const title = t(entry.label);
      consider({ id: `sub:${entry.area}:${entry.sub ?? ""}`, kind: "page", world, area: entry.area, sub: entry.sub, title, path: page, hidden: isHidden }, title, { desc: texts(entry.desc), info: texts(entry.info) });
    } else if (entry.kind === "card") {
      if (!cardText) continue;
      const path = [page, subName].filter(Boolean).join(" › ");
      consider({ id: `card:${entry.area}:${entry.sub ?? ""}:${entry.card}`, kind: "card", world, area: entry.area, sub: entry.sub, title: cardText, path, cardText, hidden: isHidden }, cardText, { info: texts(entry.info) });
    } else if (entry.label) {
      const title = t(entry.label);
      const path = [page, subName, cardText].filter(Boolean).join(" › ");
      const synonymKey = SETTINGS_SYNONYMS[entry.label];
      const synonyms = synonymKey ? t(synonymKey).split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : [];
      consider(
        { id: `row:${entry.area}:${entry.sub ?? ""}:${entry.card ?? ""}:${entry.label}`, kind: "row", world, area: entry.area, sub: entry.sub, title, path, cardText, hidden: isHidden },
        title,
        { desc: texts(entry.desc), info: texts(entry.info), synonyms },
      );
    }
  }

  scored.sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title));
  return scored.slice(0, opts.limit ?? 40).map((entry) => entry.hit);
}

/* ---------- finding the row on the page ---------- */

/** Group headings of both shells, in document order with the rows. */
const HEAD_SELECTOR = ".pv-setgroup-label, .pv-grouplabel, .pv-setpage-title";
/** Row containers of both shells and the element that holds each one's label. */
const ROW_SELECTOR = ".pv-setrow, .pv-grouprow, .pv-rowfield";
const ROW_LABEL_SELECTOR = ".pv-setrow-label, .pv-grouprow-title, .pv-rowfield-label";

/** An element's own words: without badges and buttons (the ⓘ, the device badge). */
function ownText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll(".pv-badge, button, [aria-hidden='true']").forEach((node) => node.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

function shown(element: Element): boolean {
  const el = element as HTMLElement & { checkVisibility?: (o?: object) => boolean };
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

export interface SettingsRevealTarget {
  /** The translated label of the row (absent: the card heading itself). */
  title?: string;
  /** The translated card heading the row stands in. */
  cardText?: string;
}

/**
 * The element of a hit inside a page root: the row whose label reads `title`
 * under the card `cardText` (a row of that name elsewhere when the card has
 * none), or the card heading itself.
 */
export function findSettingElement(root: ParentNode, target: SettingsRevealTarget): HTMLElement | null {
  // The hits themselves are rows too (the phone draws them as rows): never a target.
  const nodes = Array.from(root.querySelectorAll(`${HEAD_SELECTOR}, ${ROW_SELECTOR}`)).filter((node) => shown(node) && !node.closest(".pv-setsearch-hits"));
  let card: string | undefined;
  let fallback: HTMLElement | null = null;
  for (const node of nodes) {
    if (node.matches(HEAD_SELECTOR)) {
      card = ownText(node);
      if (!target.title && target.cardText && card === target.cardText) return (node.closest(".pv-setgroup") as HTMLElement | null) ?? (node as HTMLElement);
      continue;
    }
    if (!target.title) continue;
    const label = node.querySelector(ROW_LABEL_SELECTOR);
    if (!label || ownText(label) !== target.title) continue;
    if (!target.cardText || card === target.cardText) return node as HTMLElement;
    fallback ??= node as HTMLElement;
  }
  if (fallback) return fallback;
  // A row inside a folded group is not shown until the group opens.
  if (target.title) {
    for (const details of Array.from(root.querySelectorAll("details:not([open])"))) {
      const label = Array.from(details.querySelectorAll(ROW_LABEL_SELECTOR)).find((el) => ownText(el) === target.title);
      if (label) return label.closest(ROW_SELECTOR) as HTMLElement;
    }
  }
  return null;
}

/** How long the found row stays lit (the CSS animation runs as long). */
export const SETTING_FOUND_MS = 1600;

/**
 * Waits for the page of a hit to be on screen, then scrolls to the row and
 * lights it up. Gives up after `timeoutMs` (the page may not draw the row in
 * this state - an account without that service); the page is open either way.
 */
export function revealSetting(getRoot: () => ParentNode | null, target: SettingsRevealTarget, opts: { timeoutMs?: number } = {}): Promise<HTMLElement | null> {
  const until = Date.now() + (opts.timeoutMs ?? 2500);
  return new Promise((resolve) => {
    const attempt = () => {
      const root = getRoot();
      const found = root ? findSettingElement(root, target) : null;
      if (found) {
        const details = found.closest("details");
        if (details && !details.open) details.open = true;
        const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        found.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
        found.classList.remove("pv-setfound");
        // Restart the animation when the same row is found twice in a row.
        void found.offsetWidth;
        found.classList.add("pv-setfound");
        // The last row a hit opened keeps the mark (light goes, the mark stays),
        // so a test and a screen reader can tell which one it was.
        found.ownerDocument.querySelectorAll("[data-setting-found]").forEach((el) => el.removeAttribute("data-setting-found"));
        found.setAttribute("data-setting-found", "true");
        // The keyboard lands where the eye is sent.
        if (!found.hasAttribute("tabindex") && !found.matches("button, a, input, select, textarea")) found.setAttribute("tabindex", "-1");
        found.focus?.({ preventScroll: true });
        window.setTimeout(() => found.classList.remove("pv-setfound"), SETTING_FOUND_MS);
        resolve(found);
        return;
      }
      if (Date.now() >= until) { resolve(null); return; }
      window.setTimeout(attempt, 60);
    };
    // Not at once: the page switch the hit asked for renders first.
    window.setTimeout(attempt, 30);
  });
}
