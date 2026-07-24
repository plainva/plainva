import {
  applyResolved,
  clampContentFontSize,
  DEFAULT_CONTENT_FONT_SIZE,
  DEFAULT_THEME_NAME,
  getPlatformServices,
  getThemeDef,
} from "@plainva/ui";
import { changeAppLanguage } from "@plainva/ui/i18n";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { getActiveVaultEntry, listVaults, LOCAL_VAULT_ID } from "./vaultRegistry";
import {
  VAULT_DEFAULTS,
  VAULT_KEYS,
  pickVault,
  stripVaultKeys,
  vaultRecordsToSeed,
  type VaultScopedSettings,
} from "./mobileSettingsScope";

/**
 * Mobile app settings (P1): tiny synchronous module cache over the platform
 * ISettingsStore (desktop initDefaultViewMode pattern — screens need the
 * values without awaiting). initMobileSettings() runs before first render.
 *
 * Package A (2026-07-24 vault isolation): settings split into two scopes to
 * match the desktop. APP-wide fields (theme, language, tab layout, …) live in
 * the global `mobile-settings` key; PER-VAULT fields (folders + backup
 * retention, see mobileSettingsScope) live in `mobile-vault-<id>`. `cache`
 * always mirrors the ACTIVE vault (app-wide fields + that vault's per-vault
 * fields), so getMobileSettings() stays synchronous and every consumer is
 * unchanged; updateMobileSettings() routes each field to the right store.
 * reloadMobileSettingsForActiveVault() refreshes the per-vault slice on a
 * vault switch.
 */

export type ThemeMode = "system" | "light" | "dark";
export type DefaultView = "read" | "edit";
export type MotionPref = "system" | "on" | "off";

export interface MobileSettings {
  themeMode: ThemeMode;
  /** Bundled theme id from the shared registry (package D3); single-mode
   * themes pin `data-theme` regardless of `themeMode`. */
  themeName: string;
  defaultView: DefaultView;
  dailyFolder: string;
  /** ＋-capture target when no folder is open (R3.6). */
  inboxFolder: string;
  /** Where "insert template" / "new from template" look for .md templates
   * (R3.4; same default as the desktop's per-vault setting). */
  templateFolder: string;
  /** Empty = follow the system language. */
  language: string;
  /** First-start onboarding shown and answered. */
  onboarded: boolean;
  /** Bottom-bar screens (R2.2), sanitized by navigation.sanitizeTabSlots. */
  tabSlots: string[];
  /** Discovered easter-egg theme ids (D5; same semantics as the desktop). */
  unlockedThemes: string[];
  /** Collected LCARS palette variant ids (D5). */
  unlockedThemeVariants: string[];
  /** Theme active before an easter-egg theme took over (for the off toggle). */
  themeBefore: string;
  /** Active variant per theme, e.g. { lcars: "engage" }. */
  themeVariants: Record<string, string>;
  /** Note content font size in px, 12–24 (D6; shared limits, issue #5). */
  contentFontSize: number;
  /** Chrome motion: follow the OS, force on (OS says reduce), or force off. */
  motion: MotionPref;
  /** Snapshot retention (package G) — PER VAULT (package A, matching desktop):
   * min seconds between snapshots (0 = every write), max per file, max age
   * in days (0 = unlimited). Applied to the active vault via updatePolicy. */
  backupIntervalSeconds: number;
  backupMaxPerFile: number;
  backupMaxAgeDays: number;
  /** Template file name (inside templateFolder) seeding new daily notes; empty = plain skeleton. */
  dailyTemplate: string;
}

/** Re-export so consumers (mobileSettingsSync) keep importing the type from here. */
export type VaultSettings = VaultScopedSettings;

const KEY = "mobile-settings";
/** One-time flag: the pre-package-A shared blob has been split per vault. */
const MIGRATION_KEY = "mobile-settings-per-vault-migrated";
const vaultKey = (id: string) => `mobile-vault-${id}`;

const DEFAULTS: MobileSettings = {
  themeMode: "system",
  themeName: DEFAULT_THEME_NAME,
  defaultView: "read",
  language: "",
  onboarded: false,
  tabSlots: ["notes", "today", "tags", "bookmarks"],
  unlockedThemes: [],
  unlockedThemeVariants: [],
  themeVariants: {},
  themeBefore: "",
  contentFontSize: DEFAULT_CONTENT_FONT_SIZE,
  motion: "system",
  ...VAULT_DEFAULTS,
};

let cache: MobileSettings = { ...DEFAULTS };
let activeVaultId: string = LOCAL_VAULT_ID;
let media: MediaQueryList | null = null;

type Store = Awaited<ReturnType<ReturnType<typeof getPlatformServices>["loadSettings"]>>;

async function loadVaultRecord(store: Store, id: string): Promise<VaultScopedSettings> {
  const rec = await store.get<Partial<VaultScopedSettings>>(vaultKey(id));
  return pickVault(rec ?? {});
}

/**
 * One-time migration from the pre-package-A shared blob: seed every existing
 * vault's per-vault record from the OLD shared folder/retention values so no
 * vault loses its settings (see vaultRecordsToSeed — non-destructive).
 */
async function migrateToPerVault(store: Store, oldBlob: Partial<MobileSettings> | null): Promise<void> {
  if ((await store.get<boolean>(MIGRATION_KEY)) === true) return;
  try {
    const vaults = await listVaults();
    const present = new Set<string>();
    for (const v of vaults) {
      if (await store.get(vaultKey(v.id))) present.add(v.id);
    }
    for (const { id, record } of vaultRecordsToSeed(oldBlob, vaults.map((v) => v.id), (id) => present.has(id))) {
      await store.set(vaultKey(id), record);
    }
  } catch {
    /* registry unavailable — the active-vault load below falls back to defaults */
  }
  await store.set(MIGRATION_KEY, true);
  await store.save();
}

/** Native status bar icon/text color must track the RESOLVED app theme, not the
 *  system (Android + iOS). Per @capacitor/status-bar, Style.Dark = LIGHT (white)
 *  content for a dark background; Style.Light = DARK (black) content for a light
 *  background. So a dark app theme wants Style.Dark and a light theme Style.Light
 *  — the previous mapping was inverted, leaving the bar unreadable in both modes
 *  (package B, maintainer 2026-07-24). No-op on web. */
function syncNativeStatusBar(mode: "light" | "dark"): void {
  if (Capacitor.getPlatform() === "web") return;
  void StatusBar.setStyle({ style: mode === "dark" ? Style.Dark : Style.Light }).catch(() => {});
}

function applyTheme(): void {
  // Shared applier (D3): writes data-theme-name AND the resolved data-theme —
  // single-mode themes (Midnight, LCARS, …) pin their mode; themes with a
  // default variant get it applied. themeMode maps 1:1 onto ThemePref.
  const name = getThemeDef(cache.themeName) ? cache.themeName : DEFAULT_THEME_NAME;
  applyResolved(cache.themeMode, name, cache.themeVariants[name]);
  const root = document.documentElement;
  // D6: note content size (chrome text is untouched — desktop contract).
  root.style.setProperty("--content-font-size", `${clampContentFontSize(cache.contentFontSize)}px`);
  // D6: chrome motion — the shared tokens.css collapses on data-motion="off"
  // and skips the OS reduce-collapse on "on"; absent = follow the system.
  if (cache.motion === "system") root.removeAttribute("data-motion");
  else root.setAttribute("data-motion", cache.motion);
  // Drive the native status bar from the RESOLVED theme (applyResolved just
  // wrote data-theme, so mode-pinning/variants are already accounted for) —
  // otherwise a light app under a dark OS shows unreadable white status text.
  syncNativeStatusBar(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
}

export async function initMobileSettings(): Promise<void> {
  media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    if (cache.themeMode === "system") applyTheme();
  });
  try {
    const store = await getPlatformServices().loadSettings();
    const saved = (await store.get<Partial<MobileSettings>>(KEY)) ?? null;
    activeVaultId = (await getActiveVaultEntry()).id;
    await migrateToPerVault(store, saved);
    const vaultRec = await loadVaultRecord(store, activeVaultId);
    cache = { ...DEFAULTS, ...(saved ? stripVaultKeys(saved) : {}), ...vaultRec };
  } catch {
    /* fresh install / plain web — defaults apply */
    activeVaultId = LOCAL_VAULT_ID;
  }
  applyTheme();
  if (cache.language) await changeAppLanguage(cache.language).catch(() => {});
}

/**
 * Refreshes the per-vault slice after the active vault changed (vault switch).
 * App-wide fields stay in the cache; folders/retention swap to the new vault.
 * Called from switchVault BEFORE the next boot reads the backup policy.
 */
export async function reloadMobileSettingsForActiveVault(): Promise<void> {
  try {
    const store = await getPlatformServices().loadSettings();
    activeVaultId = (await getActiveVaultEntry()).id;
    cache = { ...cache, ...(await loadVaultRecord(store, activeVaultId)) };
  } catch {
    /* keep the current cache */
  }
  applyTheme();
  window.dispatchEvent(new CustomEvent("m-settings-changed"));
}

export function getMobileSettings(): MobileSettings {
  return cache;
}

export async function updateMobileSettings(patch: Partial<MobileSettings>): Promise<void> {
  cache = { ...cache, ...patch };
  applyTheme();
  if (patch.language !== undefined) {
    // Empty string = back to the system language.
    const target = patch.language || navigator.language;
    await changeAppLanguage(target).catch(() => {});
  }
  // The app shell re-reads tab slots (and other live settings) on this.
  window.dispatchEvent(new CustomEvent("m-settings-changed"));
  const store = await getPlatformServices().loadSettings();
  await store.set(KEY, stripVaultKeys(cache));
  // Per-vault fields land in the ACTIVE vault's record only when touched.
  if (VAULT_KEYS.some((k) => k in patch)) {
    await store.set(vaultKey(activeVaultId), pickVault(cache));
  }
  await store.save();
}

/**
 * Reads a specific vault's per-vault settings (package A / A4). Used by the
 * settings-sync profile port so syncing vault X never touches the active
 * vault's cache. For the active vault the live cache is authoritative.
 */
export async function getVaultSettings(vaultId: string): Promise<VaultScopedSettings> {
  if (vaultId === activeVaultId) return pickVault(cache);
  const store = await getPlatformServices().loadSettings();
  return loadVaultRecord(store, vaultId);
}

/**
 * Writes a specific vault's per-vault settings (package A / A4). Only mirrors
 * into the live cache when that vault is the active one, so a background apply
 * for another vault can never clobber the folders the user currently sees.
 */
export async function applyVaultSettings(vaultId: string, patch: Partial<VaultScopedSettings>): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  const current = vaultId === activeVaultId ? pickVault(cache) : await loadVaultRecord(store, vaultId);
  const next = { ...current, ...patch };
  await store.set(vaultKey(vaultId), next);
  await store.save();
  if (vaultId === activeVaultId) {
    cache = { ...cache, ...next };
    applyTheme();
    window.dispatchEvent(new CustomEvent("m-settings-changed"));
  }
}
