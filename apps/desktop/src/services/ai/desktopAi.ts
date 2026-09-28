import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, remove } from "@tauri-apps/plugin-fs";
import i18n from "@plainva/ui/i18n";
import type { AiAppSettings, IVaultAdapter, VaultQueryService } from "@plainva/core";
import {
  aiDefaultSettings,
  AiSession,
  aiVaultKey,
  calendarDay,
  createAiVaultHost,
  createVaultPolicy,
  flushPendingSave,
  getPlatformServices,
  noteDisplayName,
  plannerRowsFromTasks,
  type AiFileStore,
  type AiNavigationCommand,
  type AiVaultHost,
  type VaultPolicyHost,
} from "@plainva/ui";
import { checkedReadTextFile } from "../../adapters/checkedFilesystem";
import { isOwnerWindow } from "../windowContext";
import { createDesktopAiEgress } from "./desktopAiEgress";

/**
 * The desktop's AI session (plan KI-Harness P1a). AI v1 runs in the central
 * window only: it owns the vault's write paths, and the native egress answers
 * no other window. An auxiliary window gets no session, and its surfaces
 * render nothing.
 */

const SETTINGS_KEY = "ai";

let aiRootPromise: Promise<{ dir: string; rootId: string }> | null = null;

/** `<appData>/ai` — registered once as a write root of the atomic write command. */
async function aiRoot(): Promise<{ dir: string; rootId: string }> {
  if (!aiRootPromise) {
    aiRootPromise = (async () => {
      const dir = await join(await appDataDir(), "ai");
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      const rootId = await invoke<string>("register_write_root", { path: dir });
      return { dir, rootId };
    })().catch((error: unknown) => {
      aiRootPromise = null;
      throw error;
    });
  }
  return aiRootPromise;
}

export const desktopAiFiles: AiFileStore = {
  async read(relPath) {
    const { rootId } = await aiRoot();
    return checkedReadTextFile(rootId, relPath);
  },
  async write(relPath, text) {
    const { rootId } = await aiRoot();
    await invoke("write_file_atomic", { rootId, relPath, contents: text, encoding: "utf8" });
  },
  async remove(relPath) {
    const { dir } = await aiRoot();
    const file = await join(dir, ...relPath.split("/"));
    if (await exists(file)) await remove(file);
  },
  async removeDir(relPath) {
    const { dir } = await aiRoot();
    const folder = await join(dir, ...relPath.split("/"));
    if (await exists(folder)) await remove(folder, { recursive: true });
  },
};

/** Removes the AI data of one vault — part of "forget app data". */
export async function forgetAiVaultData(vaultPath: string): Promise<void> {
  await desktopAiFiles.removeDir(aiVaultKey(vaultPath));
}

function englishLanguageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "English";
  } catch {
    return "English";
  }
}

let session: AiSession | null = null;

/** The one AI session of this process; null outside the central window. */
export function getDesktopAiSession(defaults: AiAppSettings = aiDefaultSettings()): AiSession | null {
  if (!isOwnerWindow()) return null;
  if (!session) {
    session = new AiSession({
      egress: createDesktopAiEgress(() => ({
        title: i18n.t("ai.add.confirmTitle"),
        message: i18n.t("ai.add.confirmMessage"),
        confirm: i18n.t("ai.add.confirmAction"),
        cancel: i18n.t("common.cancel"),
      })),
      async loadSettings() {
        const store = await getPlatformServices().loadSettings();
        return store.get(SETTINGS_KEY);
      },
      async saveSettings(settings) {
        const store = await getPlatformServices().loadSettings();
        await store.set(SETTINGS_KEY, settings);
        await store.save();
      },
      defaults,
      language: () => englishLanguageName(i18n.language || "en"),
      today: () => calendarDay(),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    });
    void session.load();
  }
  return session;
}

export interface DesktopVaultInput {
  vaultPath: string;
  adapter: IVaultAdapter;
  query: VaultQueryService;
  encrypted: () => boolean;
  /** The path open in the focused pane, if it is a note. */
  activePath: () => string | null;
  /** Navigation the assistant may trigger: views and notes, nothing that changes data. */
  commands: () => AiNavigationCommand[];
}

let currentPolicy: VaultPolicyHost | null = null;

/** The policy of the vault the session reads — the settings invalidate it after writing the rules. */
export function currentAiPolicy(): VaultPolicyHost | null {
  return currentPolicy;
}

/** The vault side of the session for the open desktop vault. */
export function createDesktopVaultHost(input: DesktopVaultInput): { host: AiVaultHost; policy: VaultPolicyHost } {
  const read = async (path: string): Promise<string | null> => {
    try {
      return (await input.adapter.exists(path)) ? await input.adapter.readTextFile(path) : null;
    } catch {
      return null;
    }
  };
  const note = async (path: string) => {
    if (!/\.md$/i.test(path)) return null;
    await flushPendingSave(path);
    const text = await read(path);
    return text === null ? null : { path, title: noteDisplayName(path), text };
  };
  const policy = createVaultPolicy({
    readFile: read,
    resolveLink: (target) => input.query.resolveNotePath(target),
    encrypted: input.encrypted,
  });
  currentPolicy = policy;
  const host = createAiVaultHost({
    files: desktopAiFiles,
    vaultKey: aiVaultKey(input.vaultPath),
    policy,
    async activeNote() {
      const path = input.activePath();
      return path ? note(path) : null;
    },
    readNote: note,
    toolDeps: {
      async search(query, limit, offset) {
        const hits = await input.query.searchFullText(query, limit, offset);
        return hits.map((hit) => ({ path: hit.path, title: hit.title || noteDisplayName(hit.path), snippet: hit.snippet ?? null }));
      },
      readNote: read,
      async taskRows() {
        return plannerRowsFromTasks((await input.query.listTasks()).filter((task) => !task.excluded));
      },
      todayKey: () => calendarDay(),
      commands: input.commands,
    },
  });
  return { host, policy };
}
