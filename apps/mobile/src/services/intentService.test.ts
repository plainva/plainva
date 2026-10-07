// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePolicyFile } from "@plainva/core";
import { intentNoteKey, parseIntentDirectory, type IntentDirectory, type IntentNavigation, type IntentOrder, type IntentRefTable } from "@plainva/ui";
import type { IntentDirectorySources, IntentRedeemDeps } from "./intentService";

/**
 * What the system's assistant gets to know of the open vault, and what becomes
 * of what it asked for (AI harness P4.7).
 *
 * WHAT travels is `systemIntents.ts` and has its own tests. This file decides
 * the other half, the one a mistake in would not show: which notes the privacy
 * rules let be named at all, that nothing is named where the app cannot tell,
 * that an older list never outlives a newer answer — and that what somebody
 * dictated is written through the app's own paths, once, and waits where it
 * cannot be written yet.
 */

const written: string[] = [];
let cleared = 0;
let native = true;
let writeOk = true;
let clearOk = true;
let queue: Record<string, unknown>[] = [];
const clearedIds: number[] = [];
let ordersListener: (() => void) | null = null;

vi.mock("../platform/intentBridge", () => ({
  systemIntentsAvailable: () => native,
  writeIntentDirectory: vi.fn(async (json: string) => {
    if (!writeOk) return false;
    written.push(json);
    return true;
  }),
  clearIntentDirectory: vi.fn(async () => {
    if (!clearOk) return false;
    cleared += 1;
    return true;
  }),
  readIntentOrdersRaw: vi.fn(async () => queue),
  clearIntentOrders: vi.fn(async (ids: readonly number[]) => {
    clearedIds.push(...ids);
    queue = queue.filter((entry) => !ids.includes(entry.id as number));
  }),
  onIntentOrders: vi.fn((listener: () => void) => {
    ordersListener = listener;
  }),
}));

const prefs = new Map<string, string>();
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value)),
    get: vi.fn(async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null })),
  },
}));

// The app's English, so that a dictated task is read with real capture words.
vi.mock("@plainva/ui/i18n", async () => {
  const en = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((at, part) => (at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined), en);
  return {
    default: {
      language: "en",
      t: (key: string, values?: Record<string, string>) => {
        const found = lookup(key);
        const text = typeof found === "string" ? found : key;
        return values ? text.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => values[name] ?? "") : text;
      },
    },
  };
});

let ai = { enabled: true, systemFind: true };
const aiListeners = new Set<() => void>();
vi.mock("./ai/mobileAi", () => ({
  getMobileAiSession: () => ({
    getState: () => ({ loaded: true, settings: ai }),
    subscribe: (listener: () => void) => {
      aiListeners.add(listener);
      return () => void aiListeners.delete(listener);
    },
  }),
}));

const NOTES = [
  { path: "Projects/Plan.md", title: "Plan" },
  { path: "Health/Results.md", title: "Results" }, // the note says: never to the cloud
  { path: "Private/Diary.md", title: "Diary" }, // its folder says so
  { path: "private/Letters.md", title: "Letters" }, // the same folder, spelled as another system spells it
  { path: "Private/Recipe.md", title: "Recipe" }, // the note itself allows what its folder denies
  { path: "Research/Paper.md", title: "Paper" }, // never where the internet is used
  { path: "Welcome.md", title: "Welcome" },
];
const OWN: [string, { ai: unknown }][] = [
  ["Health/Results.md", { ai: { cloud: "deny" } }],
  ["Private/Recipe.md", { ai: { cloud: "allow" } }],
];
const RULES = "folders:\n  Private/: { cloud: deny }\n  Research/: { web: deny }\n";
const NAMED = ["Plan", "Recipe", "Welcome"];
const SECRET = "5f1c0a94d27be3861190c4aa7d3e20b6";

let activeVault = "v1";
let memoryVault = "v1";
let workspace: { phase: string } | null | Error = null;
let policyText: string | null | Error = RULES;
let notesOf: () => Promise<{ path: string; title: string }[]> = async () => NOTES;
let vaultState: { workspaceState: unknown; workspaceRuntime: unknown } = { workspaceState: null, workspaceRuntime: null };
const saved: { path: string; text: string }[] = [];

vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: vi.fn(async () => ({ id: activeVault, name: "Studio" })) }));
vi.mock("./mobileWorkspaceSecurity", () => ({
  getMobileWorkspaceStatus: vi.fn(async () => {
    if (workspace instanceof Error) throw workspace;
    return workspace;
  }),
}));
vi.mock("./vaultService", () => ({
  getMobileVault: vi.fn(async () => ({
    vaultId: memoryVault,
    ...vaultState,
    queryService: { getRecentlyChangedNotes: vi.fn(() => notesOf()), getOwnAiRules: vi.fn(async () => new Map(OWN)) },
    files: {
      exists: vi.fn(async () => policyText !== null),
      readTextFile: vi.fn(async () => {
        if (policyText instanceof Error) throw policyText;
        return policyText ?? "";
      }),
    },
  })),
  vaultOps: {
    read: vi.fn(async () => ""),
    save: vi.fn(async (_vault: unknown, path: string, text: string) => void saved.push({ path, text })),
  },
}));

let settings = { taskDatabase: "", defaultNoteType: "Note" };
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => settings }));

const journal: { at: number; planned: Record<string, unknown> }[] = [];
let journalFails = false;
vi.mock("./journalService", () => ({
  planSharedJournalEntry: (now: Date) => ({ date: `day-of-${now.getTime()}`, time: "10:00", heading: "Journal", notePath: "Journal/x.md" }),
  appendPlannedJournalEntry: vi.fn(async (_vault: unknown, planned: Record<string, unknown>) => {
    if (journalFails) throw new Error("SHARE_WRITE_FAILED");
    journal.push({ at: Number(String(planned.date).replace("day-of-", "")), planned });
    return "Journal/x.md";
  }),
}));

let providerList: string | null = null;
const sentToProvider: unknown[][] = [];
vi.mock("./pim/taskToProvider", () => ({
  providerListLabel: vi.fn(async () => providerList),
  sendTaskToProviderList: vi.fn(async (...args: unknown[]) => void sentToProvider.push(args.slice(1))),
}));
const syncSoon = vi.fn();
vi.mock("./syncService", () => ({ syncSoon }));

const toasts: string[] = [];
const createdTasks: Record<string, unknown>[] = [];
let createResult: { ok: true; notePath: string } | { ok: false; reason: string } = { ok: true, notePath: "Tasks/Buy milk.md" };
const fileOps: unknown[] = [];
const searches: unknown[][] = [];
vi.mock("@plainva/ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // The database writer has its own tests; here it is the place a task arrives at.
  createTaskInDatabase: vi.fn(async (input: Record<string, unknown>) => {
    createdTasks.push(input);
    return createResult;
  }),
  notifyFileOps: (ops: unknown) => void fileOps.push(ops),
  rememberSearchSession: (...args: unknown[]) => void searches.push(args),
  toast: { info: (message: string) => void toasts.push(message) },
}));

const service = () => import("./intentService");
const last = (): IntentDirectory => parseIntentDirectory(written[written.length - 1]!)!;
const titles = (directory: IntentDirectory) => directory.notes.map((note) => note.t);

function sources(over: Partial<IntentDirectorySources> = {}): IntentDirectorySources {
  return {
    vaultName: "Studio",
    enabled: true,
    sealed: false,
    secret: SECRET,
    notes: async () => NOTES,
    ownRules: async () => new Map(OWN),
    folderRules: async () => parsePolicyFile(RULES),
    ...over,
  };
}

const NOW = new Date(2026, 9, 7, 10, 0);

/*
 * What `initIntentService` sets going is nobody's to await: a debounce on the
 * app's clock, and behind it a chain of awaits that crosses several lazily
 * loaded modules — which arrive in real time, whatever the faked clock says.
 * So a test moves the app's clock AND gives the loader a breath, until what it
 * waits for has happened.
 */
const realSetTimeout = globalThis.setTimeout;
const breathe = (ms: number) => new Promise<void>((resolve) => void realSetTimeout(resolve, ms));

async function until(happened: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 400; turn++) {
    if (happened()) return;
    await vi.advanceTimersByTimeAsync(50);
    await breathe(5);
  }
  throw new Error(`never happened: ${what}`);
}

/** For "and nothing more happened": well past every debounce, with time for whatever was still on its way. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2000);
  await breathe(60);
  await vi.advanceTimersByTimeAsync(2000);
  await breathe(20);
}

beforeEach(async () => {
  // The module remembers what it wrote and what it hooked; each test starts as a freshly started app.
  (await service()).resetIntentServiceForTests();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  written.length = 0;
  cleared = 0;
  native = true;
  writeOk = true;
  clearOk = true;
  queue = [];
  clearedIds.length = 0;
  ordersListener = null;
  prefs.clear();
  ai = { enabled: true, systemFind: true };
  aiListeners.clear();
  activeVault = "v1";
  memoryVault = "v1";
  workspace = null;
  policyText = RULES;
  notesOf = async () => NOTES;
  vaultState = { workspaceState: null, workspaceRuntime: null };
  saved.length = 0;
  settings = { taskDatabase: "", defaultNoteType: "Note" };
  journal.length = 0;
  journalFails = false;
  providerList = null;
  sentToProvider.length = 0;
  toasts.length = 0;
  createdTasks.length = 0;
  createResult = { ok: true, notePath: "Tasks/Buy milk.md" };
  fileOps.length = 0;
  searches.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("which notes the system's assistant may be told of", () => {
  it("names the notes the rules allow — and none a rule keeps from the cloud or from the internet", async () => {
    const { gatherIntentDirectory } = await service();
    const { directory, table, why } = await gatherIntentDirectory(sources(), NOW);

    expect(titles(directory)).toEqual(NAMED);
    expect(why).toBeNull();
    // A note's own rule, its folder's rule in either spelling, and the rule about the internet.
    const sent = JSON.stringify(directory);
    for (const kept of ["Results", "Health", "Diary", "Letters", "Paper", "Research"]) expect(sent, kept).not.toContain(kept);
    // Which note a key means stays with the app; the keys of notes that are kept back exist nowhere.
    expect(Object.values(table.refs).sort()).toEqual(["Private/Recipe.md", "Projects/Plan.md", "Welcome.md"]);
    expect(sent).not.toContain(".md");
    expect(sent).not.toContain(intentNoteKey(SECRET, "Health/Results.md"));
  });

  it("treats the assistant as a cloud that may use the internet, whatever it runs on", async () => {
    const { SYSTEM_ASSISTANT, gatherIntentDirectory } = await service();
    expect(SYSTEM_ASSISTANT.kind).toBe("cloud");
    // With a rule about the internet alone the note is still kept back…
    const web = await gatherIntentDirectory(sources({ folderRules: async () => parsePolicyFile("folders:\n  Projects/: { web: deny }\n"), ownRules: async () => new Map() }), NOW);
    expect(titles(web.directory)).not.toContain("Plan");
    // …and so it is with a rule about the cloud alone.
    const cloud = await gatherIntentDirectory(sources({ folderRules: async () => parsePolicyFile("folders:\n  Projects/: { cloud: deny }\n"), ownRules: async () => new Map() }), NOW);
    expect(titles(cloud.directory)).not.toContain("Plan");
  });

  it("is empty while the switch is off, and asks nothing of the vault", async () => {
    const { gatherIntentDirectory } = await service();
    const notes = vi.fn(async () => NOTES);
    const folderRules = vi.fn(async () => parsePolicyFile(RULES));
    const { directory, table, why } = await gatherIntentDirectory(sources({ enabled: false, notes, folderRules }), NOW);
    expect(directory.notes).toEqual([]);
    expect(table.refs).toEqual({});
    expect(why).toBe("off");
    expect(notes).not.toHaveBeenCalled();
    expect(folderRules).not.toHaveBeenCalled();
  });

  it("names nothing of an encrypted workspace, locked or open", async () => {
    const { gatherIntentDirectory } = await service();
    const notes = vi.fn(async () => NOTES);
    const found = await gatherIntentDirectory(sources({ sealed: true, notes }), NOW);
    expect(found.directory.notes).toEqual([]);
    expect(found.why).toBe("sealed");
    expect(notes).not.toHaveBeenCalled();
  });

  it("names nobody where the rules cannot be read — 'cannot tell' is never 'no rule'", async () => {
    const { gatherIntentDirectory } = await service();
    const notes = vi.fn(async () => NOTES);
    const unread = await gatherIntentDirectory(sources({ folderRules: async () => Promise.reject(new Error("io")), notes }), NOW);
    expect(unread.directory.notes).toEqual([]);
    expect(unread.why).toBe("rules");
    expect(notes).not.toHaveBeenCalled();
  });

  it("names nobody while a rule is spelled so that Plainva does not understand it", async () => {
    // Inside the app such a line is skipped and reported where the context is shown. A list for the
    // system can report nothing: the folder that line meant to keep back would simply be named.
    const { gatherIntentDirectory } = await service();
    for (const broken of ["folders:\n  Private/: { cloud: nope }\n", "folders: [Private]\n", "folders:\n  Private/: {cloud: deny\n"]) {
      const parsed = parsePolicyFile(broken);
      expect(parsed.problems.length, broken).toBeGreaterThan(0);
      const found = await gatherIntentDirectory(sources({ folderRules: async () => parsed }), NOW);
      expect(found.directory.notes, broken).toEqual([]);
      expect(found.why).toBe("rules");
    }
  });

  it("names nobody where the index does not answer, or the notes' own rules cannot be asked", async () => {
    const { gatherIntentDirectory } = await service();
    const noIndex = await gatherIntentDirectory(sources({ notes: async () => Promise.reject(new Error("no index")) }), NOW);
    expect(noIndex.directory.notes).toEqual([]);
    expect(noIndex.why).toBe("empty");
    // Without the notes' own rules, a note that says "never" would be named.
    const noOwn = await gatherIntentDirectory(sources({ ownRules: async () => Promise.reject(new Error("no index")) }), NOW);
    expect(noOwn.directory.notes).toEqual([]);
    expect(noOwn.why).toBe("empty");
  });

  it("names nobody without a secret for the keys, and says 'empty' where every note is kept back", async () => {
    const { gatherIntentDirectory } = await service();
    for (const secret of ["", "not-a-secret"]) {
      const found = await gatherIntentDirectory(sources({ secret }), NOW);
      expect(found.directory.notes).toEqual([]);
      expect(found.why).toBe("empty");
    }
    const all = await gatherIntentDirectory(sources({ folderRules: async () => parsePolicyFile("folders:\n  /: { cloud: deny }\n"), ownRules: async () => new Map() }), NOW);
    expect(all.directory.notes).toEqual([]);
    expect(all.why).toBe("empty");
  });
});

describe("when the list is written, and when it is wiped", () => {
  it("writes the titles for the system and keeps the way back to itself", async () => {
    const { getIntentDirectoryStatus, readIntentRefs, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();

    expect(written).toHaveLength(1);
    expect(last().vault).toBe("Studio");
    expect(titles(last())).toEqual(NAMED);
    expect(getIntentDirectoryStatus()).toEqual({ count: 3, why: null });
    // The table lies in the app's own storage, and so does the secret the keys are made with.
    const table = (await readIntentRefs()) as IntentRefTable;
    expect(Object.values(table.refs).sort()).toEqual(["Private/Recipe.md", "Projects/Plan.md", "Welcome.md"]);
    const secret = prefs.get("intent-secret-v1")!;
    expect(secret).toMatch(/^[0-9a-f]{32}$/);
    expect(written[0]).not.toContain(secret);
    expect(written[0]).not.toContain(".md");
    expect(last().notes[0]!.k).toBe(intentNoteKey(secret, "Projects/Plan.md"));
  });

  it("gives a note the same key at every write — a shortcut somebody saved keeps meaning it", async () => {
    const { refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    const first = last().notes.find((note) => note.t === "Plan")!.k;
    notesOf = async () => [{ path: "New.md", title: "New" }, ...NOTES];
    await refreshIntentDirectory();
    expect(titles(last())).toContain("New");
    expect(last().notes.find((note) => note.t === "Plan")!.k).toBe(first);
  });

  it("writes no file at all while the switch is off, and wipes what an earlier run left", async () => {
    ai = { enabled: true, systemFind: false };
    const { getIntentDirectoryStatus, readIntentRefs, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(cleared).toBe(1);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "off" });
    expect((await readIntentRefs())!.refs).toEqual({});
    // Wiped once is wiped: the next pass has nothing to do.
    await refreshIntentDirectory();
    expect(cleared).toBe(1);
  });

  it("is off wherever the whole assistant is off", async () => {
    ai = { enabled: false, systemFind: true };
    const { getIntentDirectoryStatus, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(getIntentDirectoryStatus().why).toBe("off");
  });

  it("names nothing of an encrypted workspace — asked of the device's record and of the vault in memory", async () => {
    const { getIntentDirectoryStatus, refreshIntentDirectory } = await service();
    workspace = { phase: "active" };
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "sealed" });

    workspace = null;
    vaultState = { workspaceState: {}, workspaceRuntime: null };
    await refreshIntentDirectory();
    expect(written).toEqual([]);

    // A question about a seal that cannot be answered is answered with the seal.
    vaultState = { workspaceState: null, workspaceRuntime: null };
    workspace = new Error("storage");
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(getIntentDirectoryStatus().why).toBe("sealed");
  });

  it("names nothing while the vault in memory is not the one that is open", async () => {
    memoryVault = "another";
    const { getIntentDirectoryStatus, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "empty" });
  });

  it("names nothing while the folder rules cannot be read or have a line it does not understand", async () => {
    const { getIntentDirectoryStatus, refreshIntentDirectory } = await service();
    policyText = new Error("io");
    await refreshIntentDirectory();
    expect(written).toEqual([]);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "rules" });

    policyText = "folders:\n  Private/: { cloud: nope }\n";
    await refreshIntentDirectory();
    expect(written).toEqual([]);

    // No rules file is no folder rule — the notes' own rules still hold.
    policyText = null;
    await refreshIntentDirectory();
    expect(titles(last())).toEqual(["Plan", "Diary", "Letters", "Recipe", "Paper", "Welcome"]);
  });

  it("does not leave an older list standing where a newer one could not be written", async () => {
    const { getIntentDirectoryStatus, readIntentRefs, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    expect(getIntentDirectoryStatus().count).toBe(3);

    // The older list may name what the newer one no longer does.
    writeOk = false;
    await refreshIntentDirectory();
    expect(cleared).toBe(1);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "empty" });
    expect((await readIntentRefs())!.refs).toEqual({});
  });

  it("does not say 'nothing' while a list that could not be wiped is still there", async () => {
    const { getIntentDirectoryStatus, refreshIntentDirectory } = await service();
    await refreshIntentDirectory();
    ai = { enabled: true, systemFind: false };
    clearOk = false;
    await refreshIntentDirectory();
    expect(getIntentDirectoryStatus()).toEqual({ count: 3, why: null });
    // …and the next pass tries again.
    clearOk = true;
    await refreshIntentDirectory();
    expect(cleared).toBe(1);
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "off" });
  });

  it("does nothing at all where the system has no such assistant", async () => {
    native = false;
    const { catchUpIntents, clearIntentDirectoryNow, initIntentService, refreshIntentDirectory, scheduleIntentDirectory } = await service();
    queue = [{ id: 1, kind: "journal", at: NOW.getTime() - 1000, text: "Called the dentist" }];
    initIntentService();
    await refreshIntentDirectory();
    await clearIntentDirectoryNow();
    scheduleIntentDirectory();
    await catchUpIntents();
    await settle();
    expect(written).toEqual([]);
    expect(cleared).toBe(0);
    expect(journal).toEqual([]);
    expect(prefs.size).toBe(0);
  });

  it("writes once for a burst of changes, and once more for what arrived meanwhile", async () => {
    const { refreshIntentDirectory, scheduleIntentDirectory } = await service();
    for (let index = 0; index < 5; index++) scheduleIntentDirectory();
    await until(() => written.length > 0, "the write after the burst");
    await settle();
    expect(written).toHaveLength(1);
    await Promise.all([refreshIntentDirectory(), refreshIntentDirectory(), refreshIntentDirectory()]);
    expect(written).toHaveLength(3);
  });
});

describe("the moments the list can go stale at", () => {
  it("writes at start, and again a moment after a note was saved, moved or its rules changed", async () => {
    const { initIntentService } = await service();
    initIntentService();
    await until(() => written.length === 1, "the write at start");
    for (const event of ["m-note-indexed", "m-vault-changed", "m-index-changed", "m-ai-policy-changed"]) {
      const before = written.length;
      window.dispatchEvent(new CustomEvent(event));
      await until(() => written.length === before + 1, `the write after ${event}`);
      await settle();
      // One write for one event — and the list on disk stayed until the new one replaced it: nothing was wiped.
      expect(written.length, event).toBe(before + 1);
      expect(cleared, event).toBe(0);
    }
  });

  it("wipes first where another vault is open, a vault went away or became an encrypted workspace", async () => {
    const { initIntentService } = await service();
    initIntentService();
    await until(() => written.length === 1, "the write at start");
    for (const event of ["m-vault-switched", "m-vaults-changed", "m-workspace-security-changed"]) {
      const wipes = cleared;
      const writes = written.length;
      window.dispatchEvent(new CustomEvent(event));
      // The wipe does not wait for anything: it is there before the new list is.
      await until(() => cleared === wipes + 1, `the wipe after ${event}`);
      await until(() => written.length === writes + 1, `the write after ${event}`);
      await settle();
      expect([cleared, written.length], event).toEqual([wipes + 1, writes + 1]);
    }
  });

  it("wipes at once when a workspace is sealed, and when the switch goes off", async () => {
    const { getIntentDirectoryStatus, initIntentService } = await service();
    initIntentService();
    await until(() => written.length === 1 && aiListeners.size > 0, "the write at start");
    window.dispatchEvent(new CustomEvent("m-encryption-locked"));
    await until(() => cleared === 1, "the wipe at the lock");
    await settle();
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "sealed" });
    // Sealing is no reason to write: nothing came back.
    expect(written).toHaveLength(1);

    ai = { enabled: true, systemFind: false };
    for (const listener of [...aiListeners]) listener();
    await until(() => getIntentDirectoryStatus().why === "off", "the wipe at the switch");
    expect(getIntentDirectoryStatus()).toEqual({ count: 0, why: "off" });

    // …and on writes it again.
    ai = { enabled: true, systemFind: true };
    for (const listener of [...aiListeners]) listener();
    await until(() => written.length === 2, "the write after switching on");
    expect(getIntentDirectoryStatus()).toEqual({ count: 3, why: null });
  });

  it("redeems an order that arrives while the app is running", async () => {
    const { initIntentService } = await service();
    initIntentService();
    await until(() => written.length === 1 && ordersListener !== null, "the write at start");
    queue = [{ id: 4, kind: "journal", at: NOW.getTime() - 500, text: "Called the dentist" }];
    ordersListener!();
    await until(() => journal.length === 1 && queue.length === 0, "the entry");
    expect(journal.map((entry) => entry.planned.text)).toEqual(["Called the dentist"]);
  });
});

/* ---- the orders ------------------------------------------------------------------------------------- */

const order = (over: Partial<IntentOrder> & { id: number }): IntentOrder => ({ kind: "journal", at: NOW.getTime() - 1000, text: "Called the dentist", ...over });

function deps(over: Partial<IntentRedeemDeps> & { orders: IntentOrder[]; table?: IntentRefTable | null }) {
  const log: string[] = [];
  const went: IntentNavigation[] = [];
  const reports: unknown[] = [];
  const given: IntentRedeemDeps = {
    now: () => NOW.getTime(),
    readOrders: async () => over.orders,
    clearOrders: async (ids) => {
      if (ids.length) log.push(`clear ${ids.join(",")}`);
    },
    refs: async () => over.table ?? null,
    journal: async (entry) => void log.push(`journal ${entry.id}`),
    task: async (entry) => void log.push(`task ${entry.id}`),
    navigate: (target) => void went.push(target),
    report: (done, waiting) => void reports.push({ ...done, waiting }),
    ...over,
  };
  return { given, log, went, reports };
}

describe("what becomes of what somebody asked for", () => {
  it("writes what was said, oldest first, and clears each order the moment it is written", async () => {
    const { redeemIntentOrdersWith } = await service();
    const now = NOW.getTime();
    const { given, log, reports } = deps({
      orders: [order({ id: 3, kind: "task", at: now - 1000, text: "Buy milk" }), order({ id: 1, at: now - 3000 }), order({ id: 2, at: now - 2000, text: "Second" })],
    });
    expect(await redeemIntentOrdersWith(given)).toEqual({ journal: 2, task: 1, waiting: 0 });
    // One by one: a process killed in between repeats at most one — and the journal finds its own entry again.
    expect(log).toEqual(["journal 1", "clear 1", "journal 2", "clear 2", "task 3", "clear 3"]);
    expect(reports).toEqual([{ journal: 2, task: 1, waiting: 0 }]);
  });

  it("leaves in the queue what cannot be written now, and goes on with the rest", async () => {
    const { redeemIntentOrdersWith } = await service();
    const { given, log, reports } = deps({
      orders: [order({ id: 1 }), order({ id: 2, kind: "task", text: "Buy milk" }), order({ id: 3, text: "Third" })],
      task: async () => Promise.reject(new Error("locked")),
    });
    expect(await redeemIntentOrdersWith(given)).toEqual({ journal: 2, task: 0, waiting: 1 });
    expect(log).toEqual(["journal 1", "clear 1", "journal 3", "clear 3"]);
    expect(reports).toEqual([{ journal: 2, task: 0, waiting: 1 }]);
  });

  it("drops first what will never be acted on", async () => {
    const { redeemIntentOrdersWith } = await service();
    const now = NOW.getTime();
    const { given, log, went, reports } = deps({
      orders: [order({ id: 1, kind: "open", at: now - 10 * 60_000, text: "Plan" }), order({ id: 2, text: "" }), order({ id: 3 })],
    });
    await redeemIntentOrdersWith(given);
    expect(log).toEqual(["clear 1,2", "journal 3", "clear 3"]);
    // A place asked for ten minutes ago moves no screen now.
    expect(went).toEqual([]);
    expect(reports).toEqual([{ journal: 1, task: 0, waiting: 0 }]);
  });

  it("opens the note the app's own table names for a key, and searches where it knows none", async () => {
    const { redeemIntentOrdersWith } = await service();
    const key = intentNoteKey(SECRET, "Projects/Plan.md");
    const table = { writtenAt: 1, refs: { [key]: "Projects/Plan.md" } };

    const open = deps({ orders: [order({ id: 1, kind: "open", text: "Plan", key })], table });
    await redeemIntentOrdersWith(open.given);
    expect(open.went).toEqual([{ kind: "open", path: "Projects/Plan.md" }]);
    expect(open.log).toEqual(["clear 1"]);
    // Somewhere to go is no capture: nothing is reported for it.
    expect(open.reports).toEqual([]);

    // The note moved, or may no longer be named: the title that was chosen is searched for — never a note opened by guess.
    const moved = deps({ orders: [order({ id: 2, kind: "open", text: "Plan", key })], table: { writtenAt: 2, refs: {} } });
    await redeemIntentOrdersWith(moved.given);
    expect(moved.went).toEqual([{ kind: "search", query: "Plan" }]);

    const unread = deps({ orders: [order({ id: 3, kind: "open", text: "Plan", key })], refs: async () => Promise.reject(new Error("storage")) });
    await redeemIntentOrdersWith(unread.given);
    expect(unread.went).toEqual([{ kind: "search", query: "Plan" }]);
    expect(unread.log).toEqual(["clear 3"]);

    const search = deps({ orders: [order({ id: 4, kind: "search", text: "shooting days" })], table });
    await redeemIntentOrdersWith(search.given);
    expect(search.went).toEqual([{ kind: "search", query: "shooting days" }]);
  });

  it("does nothing where nothing waits", async () => {
    const { redeemIntentOrdersWith } = await service();
    const { given, log, reports } = deps({ orders: [] });
    expect(await redeemIntentOrdersWith(given)).toEqual({ journal: 0, task: 0, waiting: 0 });
    expect(log).toEqual([]);
    expect(reports).toEqual([]);
  });
});

describe("the app's own paths", () => {
  const said = new Date(2026, 9, 6, 23, 40).getTime(); // yesterday evening; the app is opened this morning

  it("puts a journal entry into the day and the minute it was said at", async () => {
    queue = [{ id: 1, kind: "journal", at: said, text: "Called the dentist" }];
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();
    expect(journal).toEqual([{ at: said, planned: { date: `day-of-${said}`, time: "10:00", heading: "Journal", text: "Called the dentist" } }]);
    expect(queue).toEqual([]);
    expect(toasts).toEqual(["From Siri and Shortcuts — journal entries: 1, tasks: 0."]);
  });

  it("notes a task as a line with an open box where the vault has no task database", async () => {
    queue = [{ id: 1, kind: "task", at: said, text: "Buy milk tomorrow" }];
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();
    expect(createdTasks).toEqual([]);
    // Word for word: without a database nothing reads a date out of the line.
    expect(journal[0]!.planned).toMatchObject({ text: "Buy milk tomorrow", task: true });
    expect(toasts).toEqual(["From Siri and Shortcuts — journal entries: 0, tasks: 1."]);
  });

  it("creates a task in the task database, read like a line typed into the capture field — on the day it was said", async () => {
    settings = { taskDatabase: "Tasks.base", defaultNoteType: "Note" };
    providerList = "Groceries";
    queue = [{ id: 1, kind: "task", at: said, text: "Buy milk tomorrow #home" }];
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();

    expect(createdTasks).toHaveLength(1);
    // "Tomorrow", said on the 6th, is the 7th — whenever the app is opened.
    expect(createdTasks[0]).toMatchObject({ dbPath: "Tasks.base", title: "Buy milk", noteType: "Note", dueDate: "2026-10-07", tags: ["home"] });
    expect(journal).toEqual([]);
    expect(fileOps).toEqual([[{ type: "create", path: "Tasks/Buy milk.md" }]]);
    // The note first, the provider's list after — where the database names one.
    expect(sentToProvider).toEqual([["Tasks.base", "Tasks/Buy milk.md", "Buy milk", "2026-10-07"]]);
    expect(syncSoon).toHaveBeenCalledTimes(1);
    expect(queue).toEqual([]);
  });

  it("asks no provider where the database names no list, and keeps the words as the title where nothing else is left", async () => {
    settings = { taskDatabase: "Tasks.base", defaultNoteType: "Note" };
    queue = [{ id: 1, kind: "task", at: said, text: "tomorrow" }];
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();
    expect(createdTasks[0]).toMatchObject({ title: "tomorrow" });
    expect(sentToProvider).toEqual([]);
  });

  it("lets a task wait where the database does not take it", async () => {
    settings = { taskDatabase: "Tasks.base", defaultNoteType: "Note" };
    createResult = { ok: false, reason: "noFolder" };
    queue = [{ id: 1, kind: "task", at: said, text: "Buy milk" }];
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();
    expect(queue).toHaveLength(1);
    expect(toasts).toEqual(["Not written yet, still waiting: 1."]);
  });

  it("writes nothing into a sealed workspace or another vault — the words wait", async () => {
    queue = [{ id: 1, kind: "journal", at: said, text: "Called the dentist" }];
    const { redeemIntentOrders } = await service();
    vaultState = { workspaceState: {}, workspaceRuntime: null };
    await redeemIntentOrders();
    expect(journal).toEqual([]);
    expect(queue).toHaveLength(1);

    vaultState = { workspaceState: null, workspaceRuntime: null };
    memoryVault = "another";
    await redeemIntentOrders();
    expect(journal).toEqual([]);
    expect(queue).toHaveLength(1);

    // Unlocked, and the open vault: now it is written — once.
    memoryVault = "v1";
    vaultState = { workspaceState: {}, workspaceRuntime: {} };
    await redeemIntentOrders();
    expect(journal).toHaveLength(1);
    expect(queue).toEqual([]);
  });

  it("lets an entry wait that the journal could not take", async () => {
    queue = [{ id: 1, kind: "journal", at: said, text: "Called the dentist" }];
    journalFails = true;
    const { redeemIntentOrders } = await service();
    await redeemIntentOrders();
    expect(queue).toHaveLength(1);
    journalFails = false;
    await redeemIntentOrders();
    expect(queue).toEqual([]);
    expect(journal).toHaveLength(1);
  });

  it("parks the place somebody asked for, tells the shell, and hands it over once", async () => {
    const { consumeIntentNavigation, refreshIntentDirectory, redeemIntentOrders, seedIntentSearch } = await service();
    await refreshIntentDirectory();
    const plan = last().notes.find((note) => note.t === "Plan")!;
    queue = [{ id: 1, kind: "open", at: NOW.getTime() - 500, text: "Plan", key: plan.k }];
    const heard = vi.fn();
    window.addEventListener("m-intent-nav", heard);
    await redeemIntentOrders();
    window.removeEventListener("m-intent-nav", heard);

    expect(heard).toHaveBeenCalledTimes(1);
    expect(consumeIntentNavigation()).toEqual({ kind: "open", path: "Projects/Plan.md" });
    expect(consumeIntentNavigation()).toBeNull();
    expect(queue).toEqual([]);
    expect(toasts).toEqual([]);

    seedIntentSearch("v1", "shooting days");
    expect(searches).toEqual([["v1", "shooting days", 0]]);
  });

  it("does not open a note the list no longer names", async () => {
    const { consumeIntentNavigation, refreshIntentDirectory, redeemIntentOrders } = await service();
    await refreshIntentDirectory();
    const plan = last().notes.find((note) => note.t === "Plan")!;
    // Since the shortcut was saved, the note was marked: never to the cloud.
    policyText = "folders:\n  Projects/: { cloud: deny }\n";
    await refreshIntentDirectory();
    queue = [{ id: 1, kind: "open", at: NOW.getTime() - 500, text: "Plan", key: plan.k }];
    await redeemIntentOrders();
    expect(consumeIntentNavigation()).toEqual({ kind: "search", query: "Plan" });
  });
});
