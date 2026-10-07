import { Preferences } from "@capacitor/preferences";
import { DEFAULT_AI_POLICY, effectivePolicy, gateDecision, notePolicyFrom, parsePolicyFile, type EgressRecipient, type ParsedPolicyFile } from "@plainva/core";
import {
  AI_POLICY_FILE,
  buildIntentDirectory,
  calendarDay,
  captureVocabularyOf,
  createTaskInDatabase,
  INTENT_DIRECTORY_MAX_NOTES,
  intentNoteKey,
  notifyFileOps,
  parseTaskCapture,
  planIntentOrders,
  readIntentOrders,
  readIntentRefTable,
  rememberSearchSession,
  resolveIntentNavigation,
  serializeIntentDirectory,
  toast,
  type IntentDirectory,
  type IntentNavigation,
  type IntentOrder,
  type IntentRefTable,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { clearIntentDirectory, clearIntentOrders, onIntentOrders, readIntentOrdersRaw, systemIntentsAvailable, writeIntentDirectory } from "../platform/intentBridge";

/**
 * Plainva as a tool of the system's assistant (AI harness P4.7): what Siri and
 * Shortcuts may know of the open vault, and what becomes of what they asked.
 *
 * The phone runs no JavaScript while the app is closed, so an intent can work
 * nothing out and write nothing. This file is therefore the two moments at
 * which the app does it for them: it WRITES the directory of titles while it
 * runs (`systemIntents.ts` decides what is in it, the privacy gate decides
 * which notes), and it REDEEMS the orders the intents left when it comes back
 * to the front — a journal entry through the journal, a task through the task
 * database, a note opened through the shell.
 *
 * Nothing here throws at its caller. But unlike a widget, a directory is not
 * cosmetic: where the app cannot tell whether a title may be named — the
 * rules cannot be read, the index does not answer — it names none.
 */

/**
 * The system's assistant as a recipient at the privacy gate: a cloud, whatever
 * it runs on — and one that may use the internet, which is the run `web: deny`
 * keeps a note out of. What it does with a title is not Plainva's to know, so
 * a note kept from EITHER is never named to it.
 */
export const SYSTEM_ASSISTANT: EgressRecipient = { kind: "cloud", provider: "system-assistant", model: "" };
const SYSTEM_ASSISTANT_RUN = { recipient: SYSTEM_ASSISTANT, webTools: true } as const;

/** Asked for more than the directory carries, so that notes the gate keeps back do not use up its rows. */
const NOTE_QUERY_LIMIT = INTENT_DIRECTORY_MAX_NOTES * 3;

const REFS_KEY = "intent-refs-v1";
const SECRET_KEY = "intent-secret-v1";
const DEBOUNCE_MS = 600;

/**
 * Why the system is told no title right now: the switch is off, the open vault
 * is an encrypted workspace, its rules cannot be read in full, or there is
 * simply nothing that may be named.
 */
export type IntentDirectoryWhy = "off" | "sealed" | "rules" | "empty";

export interface IntentDirectorySources {
  vaultName: string;
  /** The device's switch is on and the AI is on. */
  enabled: boolean;
  /** The open vault is an encrypted workspace, locked or open: its titles are what it seals. */
  sealed: boolean;
  /** This device's secret for the notes' keys: in the app's own storage, never beside the directory. */
  secret: string;
  /** The vault's notes, the ones changed last first. */
  notes(limit: number): Promise<{ path: string; title: string }[]>;
  /** The rule each note carries itself, for every note that carries one. */
  ownRules(): Promise<Map<string, { ai: unknown }>>;
  /** The folder rules. Rejects where they cannot be read — "cannot tell" is never "none". */
  folderRules(): Promise<ParsedPolicyFile>;
}

export interface GatheredIntentDirectory {
  directory: IntentDirectory;
  table: IntentRefTable;
  /** Set exactly when the directory names nothing. */
  why: IntentDirectoryWhy | null;
}

/** The directory and which note each of its keys means — empty wherever the gate could not be asked. */
export async function gatherIntentDirectory(sources: IntentDirectorySources, now: Date = new Date()): Promise<GatheredIntentDirectory> {
  const key = (path: string) => intentNoteKey(sources.secret, path);
  const none = (why: IntentDirectoryWhy): GatheredIntentDirectory => ({
    ...buildIntentDirectory({ vaultName: sources.vaultName, enabled: false, notes: [], allowed: () => false, key, now }),
    why,
  });
  if (!sources.enabled) return none("off");
  if (sources.sealed) return none("sealed");
  // No secret, no keys: a key anybody could work out from a path would be the path.
  if (!sources.secret) return none("empty");
  let folder: ParsedPolicyFile;
  try {
    folder = await sources.folderRules();
  } catch {
    return none("rules");
  }
  /*
   * A rule the file spells wrongly is skipped by the parser, and the assistant
   * inside the app says so where its context is shown. A directory can say
   * nothing: the folder that rule meant to keep back would simply be named.
   * So rules with a problem name nobody, until the file reads cleanly.
   */
  if (folder.problems.length > 0) return none("rules");
  try {
    const [notes, own] = await Promise.all([sources.notes(NOTE_QUERY_LIMIT), sources.ownRules()]);
    const allowed = (path: string) =>
      gateDecision(effectivePolicy(path, notePolicyFrom({ plainva: own.get(path) }), folder.rules, DEFAULT_AI_POLICY), SYSTEM_ASSISTANT_RUN).allowed;
    const built = buildIntentDirectory({ vaultName: sources.vaultName, enabled: true, notes, allowed, key, now });
    return { ...built, why: built.directory.notes.length === 0 ? "empty" : null };
  } catch {
    return none("empty");
  }
}

/** What the system can read of the open vault right now, as far as this app knows. */
export interface IntentDirectoryStatus {
  /** Titles in the directory on disk. */
  count: number;
  /** Why there are none; null while there are some, and before the first pass. */
  why: IntentDirectoryWhy | null;
}

let status: IntentDirectoryStatus = { count: 0, why: null };
const statusListeners = new Set<() => void>();

export function getIntentDirectoryStatus(): IntentDirectoryStatus {
  return status;
}

export function subscribeIntentDirectoryStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function setStatus(next: IntentDirectoryStatus): void {
  if (next.count === status.count && next.why === status.why) return;
  status = next;
  for (const listener of [...statusListeners]) listener();
}

/** This device's secret for the notes' keys, made once. Empty where the app's storage does not answer. */
async function deviceSecret(): Promise<string> {
  try {
    const stored = (await Preferences.get({ key: SECRET_KEY })).value;
    if (stored && /^[0-9a-f]{32}$/.test(stored)) return stored;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const made = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    await Preferences.set({ key: SECRET_KEY, value: made });
    return made;
  } catch {
    return "";
  }
}

async function saveRefs(table: IntentRefTable): Promise<void> {
  try {
    await Preferences.set({ key: REFS_KEY, value: JSON.stringify(table) });
  } catch {
    /* a key that cannot be resolved becomes a search for its title */
  }
}

/** Which note each key of the directory on disk means. Null when there is none. */
export async function readIntentRefs(): Promise<IntentRefTable | null> {
  try {
    const stored = await Preferences.get({ key: REFS_KEY });
    return stored.value ? readIntentRefTable(JSON.parse(stored.value)) : null;
  } catch {
    return null;
  }
}

/**
 * A module that is loaded when it is first needed — once, whoever asks first.
 * Three of them are asked for from two places each, and those can run at the
 * same time (the start writes the list while an order is being redeemed): one
 * loader each, so that both places always hold the very same module. A load
 * that failed is forgotten, and the next asker tries again.
 */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    }));
}

const mobileAi = once(() => import("./ai/mobileAi"));
const vaultServiceModule = once(() => import("./vaultService"));
const vaultRegistryModule = once(() => import("./vaultRegistry"));

/** The AI settings of this device, once they are read; null where they never arrive. */
async function aiSettings(): Promise<{ enabled: boolean; systemFind: boolean } | null> {
  const { getMobileAiSession } = await mobileAi();
  const session = getMobileAiSession();
  const loaded = () => {
    const state = session.getState();
    return state.loaded ? { enabled: state.settings.enabled, systemFind: state.settings.systemFind } : null;
  };
  const now = loaded();
  if (now) return now;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve(loaded());
    }, 5000);
    const stop = session.subscribe(() => {
      const state = loaded();
      if (!state) return;
      clearTimeout(timer);
      stop();
      resolve(state);
    });
  });
}

/** What the open vault hands the directory. */
async function sourcesOfOpenVault(): Promise<IntentDirectorySources> {
  const [{ getMobileVault }, { getActiveVaultEntry }, { getMobileWorkspaceStatus }, settings, secret] = await Promise.all([
    vaultServiceModule(),
    vaultRegistryModule(),
    import("./mobileWorkspaceSecurity"),
    aiSettings(),
    deviceSecret(),
  ]);
  const entry = await getActiveVaultEntry();
  const vault = await getMobileVault();
  // The vault in memory is the one the registry calls open — or nothing of it is named.
  const query = vault.vaultId === entry.id ? vault.queryService : null;
  // An encrypted workspace names nothing, locked or open: its titles are what it seals. Asked twice — of the
  // device's record and of the vault in memory — and a question that cannot be answered is answered with yes.
  const workspace = await getMobileWorkspaceStatus(entry.id).then((found) => found !== null, () => true);
  return {
    vaultName: entry.name || "Plainva",
    enabled: Boolean(settings?.enabled && settings.systemFind),
    sealed: workspace || vault.workspaceState !== null || vault.workspaceRuntime !== null,
    secret,
    notes: (limit) => (query ? query.getRecentlyChangedNotes(limit) : Promise.reject(new Error("no index"))),
    ownRules: () => (query ? query.getOwnAiRules() : Promise.reject(new Error("no index"))),
    folderRules: async () => ((await vault.files.exists(AI_POLICY_FILE)) ? parsePolicyFile(await vault.files.readTextFile(AI_POLICY_FILE)) : { rules: [], problems: [] }),
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let queued = false;
let wired = false;
const wiredListeners: [string, () => void][] = [];
let unsubscribeAi: (() => void) | null = null;
/** What the last write left on disk: a directory with rows, or none. Null until the first one. */
let onDisk: "rows" | "none" | null = null;

/**
 * Writes what the system may know until the app next runs.
 *
 * Coalesced like the widgets' snapshot: while one run is in flight a second
 * request only sets a flag, and the run repeats once at the end.
 */
export async function refreshIntentDirectory(): Promise<void> {
  if (!systemIntentsAvailable()) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      await writeOnce();
    } while (queued);
  } finally {
    running = false;
  }
}

async function writeOnce(): Promise<void> {
  try {
    const { directory, table, why } = await gatherIntentDirectory(await sourcesOfOpenVault());
    if (directory.notes.length === 0) {
      // Nothing to name: no file at all, rather than an empty one that says a vault is here.
      if (onDisk !== "none") {
        // A wipe that failed leaves the old directory standing; the status keeps saying so, and the next pass tries again.
        if (!(await clearIntentDirectory())) return;
        onDisk = "none";
        await saveRefs({ writtenAt: 0, refs: {} });
      }
      setStatus({ count: 0, why: why ?? "empty" });
      return;
    }
    // The table first, the directory second: a process killed in between leaves a table nothing points at.
    await saveRefs(table);
    if (await writeIntentDirectory(serializeIntentDirectory(directory))) {
      onDisk = "rows";
      setStatus({ count: directory.notes.length, why: null });
    }
    // A directory that could not be written must not leave an older one standing: that one may name what this one no longer does.
    else await clearIntentDirectoryNow();
  } catch {
    // The vault is not open, or something on the way did not answer: nothing may be named until it does.
    await clearIntentDirectoryNow();
  }
}

/** Wipes what the system may know — the vault was locked, switched or removed, or the switch went off. */
export async function clearIntentDirectoryNow(why: IntentDirectoryWhy = "empty"): Promise<void> {
  if (!systemIntentsAvailable()) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (await clearIntentDirectory()) {
    onDisk = "none";
    setStatus({ count: 0, why });
  } else {
    // Not wiped: whatever was there still is, and the status must not say otherwise.
    onDisk = null;
  }
  await saveRefs({ writtenAt: 0, refs: {} });
}

/** Coalesces a burst of triggers into one write. */
export function scheduleIntentDirectory(): void {
  if (!systemIntentsAvailable()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void refreshIntentDirectory();
  }, DEBOUNCE_MS);
}

/* ---- the orders ------------------------------------------------------------------------------------- */

export interface IntentRedeemDeps {
  now(): number;
  readOrders(): Promise<unknown[]>;
  clearOrders(ids: readonly number[]): Promise<void>;
  refs(): Promise<IntentRefTable | null>;
  /** Writes one journal entry, stamped with the moment it was said. Has to be idempotent. */
  journal(order: IntentOrder): Promise<void>;
  /** Creates one task. */
  task(order: IntentOrder): Promise<void>;
  navigate(target: IntentNavigation): void;
  /** Tells the user what was written down and what still waits. */
  report(done: { journal: number; task: number }, waiting: number): void;
}

/**
 * Redeems what the intents left. An order only ever RECORDED what somebody
 * said; this is where it becomes a change, through the very paths the app's
 * own surfaces use.
 *
 * A capture that cannot be written now — a sealed workspace, a vault that is
 * not open — stays in the queue and is tried again; it is cleared the moment
 * it is written, one by one, so that a kill in between repeats at most one.
 * Somewhere to go is different: it is about now, and is cleared either way.
 */
export async function redeemIntentOrdersWith(deps: IntentRedeemDeps): Promise<{ journal: number; task: number; waiting: number }> {
  const orders = readIntentOrders(await deps.readOrders());
  if (orders.length === 0) return { journal: 0, task: 0, waiting: 0 };
  const plan = planIntentOrders(orders, deps.now());
  await deps.clearOrders(plan.moot);

  const done = { journal: 0, task: 0 };
  let waiting = 0;
  for (const order of plan.captures) {
    try {
      if (order.kind === "journal") await deps.journal(order);
      else await deps.task(order);
    } catch {
      waiting += 1;
      continue;
    }
    if (order.kind === "journal") done.journal += 1;
    else done.task += 1;
    await deps.clearOrders([order.id]);
  }

  if (plan.navigation) {
    const target = resolveIntentNavigation(plan.navigation, await deps.refs().catch(() => null));
    await deps.clearOrders([plan.navigation.id]);
    if (target) deps.navigate(target);
  }
  if (done.journal + done.task > 0 || waiting > 0) deps.report(done, waiting);
  return { ...done, waiting };
}

let parked: IntentNavigation | null = null;

/** Takes the place somebody asked to be taken to, if the shell has not drained it yet. */
export function consumeIntentNavigation(): IntentNavigation | null {
  const target = parked;
  parked = null;
  return target;
}

/** The open vault, where something may be written into it now. */
async function writableVault() {
  const [{ getMobileVault, vaultOps }, { getActiveVaultEntry }] = await Promise.all([vaultServiceModule(), vaultRegistryModule()]);
  const vault = await getMobileVault();
  if ((await getActiveVaultEntry()).id !== vault.vaultId) throw new Error("another vault");
  // A sealed workspace takes nothing until it is unlocked; the order waits.
  if (vault.workspaceState !== null && vault.workspaceRuntime === null) throw new Error("locked");
  return { vault, vaultOps };
}

async function writeJournal(order: IntentOrder, task = false): Promise<void> {
  const { vault } = await writableVault();
  const { appendPlannedJournalEntry, planSharedJournalEntry } = await import("./journalService");
  // Day and time are those of the moment it was said: the plan is the same on every try, so a retry finds its own entry.
  const { date, time, heading } = planSharedJournalEntry(new Date(order.at));
  await appendPlannedJournalEntry(vault, { date, time, heading, text: order.text, ...(task ? { task: true } : {}) });
}

async function writeTask(order: IntentOrder): Promise<void> {
  const { getMobileSettings } = await import("./mobileSettings");
  const settings = getMobileSettings();
  const taskDb = settings.taskDatabase.trim();
  // Without a task database a task is what it is everywhere else in Plainva: a checkbox line — in the journal of that moment.
  if (!taskDb) return writeJournal(order, true);
  const { vault, vaultOps } = await writableVault();
  const adapter = {
    readTextFile: (path: string) => vaultOps.read(vault, path),
    writeTextFile: (path: string, content: string) => vaultOps.save(vault, path, content),
    exists: (path: string) => vault.files.exists(path),
  };
  // The same reading as a line typed into the capture field — with "today" being the day it was said.
  const line = order.text.replace(/\n+/g, " ");
  const read = parseTaskCapture(line, captureVocabularyOf((key) => i18n.t(key), i18n.language), calendarDay(new Date(order.at)));
  const title = read.title.trim() || line;
  const created = await createTaskInDatabase({
    adapter,
    dbPath: taskDb,
    title,
    noteType: settings.defaultNoteType,
    ...(read.due ? { dueDate: read.due, dueMinutes: read.minutes } : {}),
    tags: read.tags,
    priority: read.priority,
    repeat: read.repeat,
  });
  if (!created.ok) throw new Error(created.reason);
  notifyFileOps([{ type: "create", path: created.notePath }]);
  // The note is the deliverable and exists; the provider's copy is the addition, and reports its own failure.
  const { providerListLabel, sendTaskToProviderList } = await import("./pim/taskToProvider");
  if (await providerListLabel(adapter, taskDb).catch(() => null)) await sendTaskToProviderList(adapter, taskDb, created.notePath, title, read.due ?? undefined);
  const { syncSoon } = await import("./syncService");
  syncSoon();
}

let redeeming = false;
let redeemAgain = false;

/** Redeems the orders that wait, with the app's own paths. */
export async function redeemIntentOrders(): Promise<void> {
  if (!systemIntentsAvailable()) return;
  if (redeeming) {
    redeemAgain = true;
    return;
  }
  redeeming = true;
  try {
    do {
      redeemAgain = false;
      await redeemIntentOrdersWith({
        now: () => Date.now(),
        readOrders: readIntentOrdersRaw,
        clearOrders: clearIntentOrders,
        refs: readIntentRefs,
        journal: (order) => writeJournal(order),
        task: writeTask,
        navigate(target) {
          parked = target;
          // Parked and signalled, like a tapped widget row: an intent can be what STARTED the app.
          if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m-intent-nav"));
        },
        report(done, waiting) {
          if (done.journal + done.task > 0) toast.info(i18n.t("ai.system.filed", { journal: String(done.journal), tasks: String(done.task) }));
          if (waiting > 0) toast.info(i18n.t("ai.system.waiting", { count: String(waiting) }));
        },
      });
    } while (redeemAgain);
  } catch {
    /* an order that could not be read now is read again at the next return */
  } finally {
    redeeming = false;
  }
}

/**
 * Forgets everything this module remembers between calls and unhooks what
 * `initIntentService` hooked. Tests only: on a device the module lives exactly
 * as long as the app.
 */
export function resetIntentServiceForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  running = false;
  queued = false;
  wired = false;
  onDisk = null;
  redeeming = false;
  redeemAgain = false;
  parked = null;
  status = { count: 0, why: null };
  statusListeners.clear();
  if (typeof window !== "undefined") for (const [event, handler] of wiredListeners.splice(0)) window.removeEventListener(event, handler);
  unsubscribeAi?.();
  unsubscribeAi = null;
}

/** Opens the search on words an intent asked for: the screen starts from the session the vault remembers. */
export function seedIntentSearch(vaultId: string, query: string): void {
  rememberSearchSession(vaultId, query, 0);
}

/** What the app does about the system's assistant when it comes back: redeem, then write. */
export async function catchUpIntents(): Promise<void> {
  await redeemIntentOrders();
  await refreshIntentDirectory();
}

/**
 * Wires the moments at which the directory can have gone stale: the index
 * changed, the rules or the switch changed, another vault is open, a
 * workspace was sealed. Called once at startup.
 */
export function initIntentService(): void {
  if (wired || !systemIntentsAvailable() || typeof window === "undefined") return;
  wired = true;
  const listen = (event: string, handler: () => void) => {
    window.addEventListener(event, handler);
    wiredListeners.push([event, handler]);
  };
  /*
   * What changes the answer while the same vault stays open: a note was saved
   * and indexed (`m-note-indexed` — a title, or the rule a note carries
   * itself), notes came, went or moved (`m-vault-changed`), the index was
   * rebuilt, the folder rules were saved. The list is then worked out again,
   * a moment later; the one on disk stays until the new one replaces it.
   */
  for (const event of ["m-note-indexed", "m-vault-changed", "m-index-changed", "m-ai-policy-changed"]) listen(event, scheduleIntentDirectory);
  // Another vault is another directory, and so is this one once it became an encrypted workspace: the old
  // list must not stay while the new one is being worked out.
  for (const event of ["m-vault-switched", "m-vaults-changed", "m-workspace-security-changed"]) {
    listen(event, () => {
      void clearIntentDirectoryNow().then(() => refreshIntentDirectory());
    });
  }
  listen("m-encryption-locked", () => {
    void clearIntentDirectoryNow("sealed");
  });
  // An order recorded while the app runs — the system brought it to the front for "open this note" — is redeemed at once.
  onIntentOrders(() => void redeemIntentOrders());
  // The switch itself: off wipes the list at once, on writes it.
  void mobileAi()
    .then(({ getMobileAiSession }) => {
      if (!wired) return;
      const session = getMobileAiSession();
      let before = "";
      unsubscribeAi = session.subscribe(() => {
        const state = session.getState();
        if (!state.loaded) return;
        const now = `${state.settings.enabled}/${state.settings.systemFind}`;
        if (now === before) return;
        before = now;
        if (state.settings.enabled && state.settings.systemFind) scheduleIntentDirectory();
        else void clearIntentDirectoryNow("off");
      });
    })
    .catch(() => {});
  void catchUpIntents();
}
