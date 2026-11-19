import { describe, expect, it } from "vitest";
import { buildLinkNameIndex, filesALinkCouldMean, mcpToolKind, parseMemory, toolByName, toolsFor, type EgressRecipient } from "@plainva/core";
import {
  CHAT_TOOL_NAMES,
  captureVocabularyOf,
  createVaultPolicy,
  createVaultToolExecutor,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  type ProposalRound,
  type ToolScope,
  type VaultToolDeps,
  type WriteRun,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { eventHandle } from "../../../../packages/ui/src/ai/eventDetails";
import { plannerRowsFromTasks } from "../../../../packages/ui/src/lib/taskPlannerRows";
import { databaseTaskRows, notePropertiesOf, situationFrom, situationReach } from "../../../../packages/ui/src/ai/aiSituation";
import { buildContextPackage } from "../../../../packages/core/src/ai/context/package";
import { protectedTokens } from "../../../../packages/core/src/ai/context/gists";
import { GistStore, resetGistStores } from "../../../../packages/core/src/ai/context/gistStore";
import { areaGistKey, GistReader, GistWriter, VAULT_GIST_KEY } from "../../../../packages/core/src/ai/context/gistWriter";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { VaultIndexer } from "../../../../packages/core/src/vault/VaultIndexer";
import { VaultQueryService } from "../../../../packages/core/src/vault/VaultQueryService";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * The reader-view guard on the real search path (decision A of 2026-11-13, reviews of R19, wave 2): a real vault
 * indexed for real, the query service the shells use, and the vault policy both shells build. A note the reader may
 * not see is linked from several readable notes in every way a vault writes a link — in the text, in a heading, in a
 * table cell, as Markdown, as a reference, as an embed, in a property with and without quotes, in a list, at the end
 * of a long value, in a title —, from an appointment, from the memory and from an older version. Two vaults differ
 * only in the name of that note — one that sorts before every visible value, one after —; every read tool such a
 * reader reaches answers the same question in both alike, and no word of either name comes out. Every tool that
 * writes answers a change that names the hidden note alike too, and so does the context package with its short
 * summaries.
 */
const LONG = "a".repeat(395);
/** A name with its last letter written as a YAML escape: YAML reads the name, the text does not spell it. */
const escaped = (name: string) => `${name.slice(0, -1)}\\x${name.charCodeAt(name.length - 1).toString(16)}`;
/** A title that holds a link in each way YAML reads one: quoted, a tab, a comment, over two lines, an escape. */
const TITLES = (name: string): Record<string, string> => ({
  quoted: `"[[${name}]]"`,
  tabbed: `[[${name},\tMeier]]`,
  commented: `[[${name},  # c\n  Meier]]`,
  spread: `"[[${name},\n  Meier]]"`,
  escaped: `"[[${escaped(name)}]]"`,
});
const AGENDA = `## Agenda\n\n${"Each round starts with the open points from last time, then the numbers of the quarter. ".repeat(20)}\n`;
const readable = (name: string): Record<string, string> => ({
  "Projects/Pay.md": `---\nrelated: "[[Private/${name}]]"\nowner: "[[${name}|the owner]]"\nunquoted: [[Private/${name}]]\nlist:\n  - [[${name}]]\nlong: "${LONG} [[Private/${name}]]"\ncomma: [[${name}, Meier]]\nlabelled: [[${name}, Meier|Pay, ${name}]]\ncolon: [[Brief: ${name}]]\nspread: [[${name},\n  Meier]]\ninside:\n  rel: [[${name}, Meier]]\nitems:\n  - [[${name}, Meier]]\n  - plain\n---\n# Pay\n\nThe rates of this year.\n\n## Talk with [[${name}]]\n\nSee [[Private/${name}|${name}]] for the numbers.\n\n| who | note |\n| --- | --- |\n| a | [[${name}\\|x]] |\n\nAlso [t](../Private/${encodeURIComponent(name)}.md), ![[${name}]] and [r][1].\n\n[1]: ../Private/${encodeURIComponent(name)}.md\n`,
  "Projects/Second.md": `---\nup: [[${name}]]\n---\n# Second\n\nThe rates again, with [[${name}]] and [[Projects/Pay]].\n`,
  "Projects/Plan.md": "---\nowner: \"[[Projects/Mia]]\"\nrel: \"[[Projects/Pay]]\"\n---\n# Plan\n\nSee [[Projects/Pay]] for the rates.\n",
  "Projects/Mia.md": "# Mia\n",
  "Projects/Talk.md": `---\ntitle: "Talk with [[${name}]]"\n---\n# Talk\n\nSee [[Projects/Pay]] and [[Projects/Mia]].\n`,
  "Projects/Weekly.md": `# Weekly\n\n${AGENDA}`,
  // A reference link whose definition stands on another line than its use, in a heading and in a line that links on.
  "Projects/Ref.md": `# Ref\n\n## Talk [${name} pay][2]\n\nSee [[Projects/Mia]] and [${name} raise][2].\n\n[2]: ../Private/${encodeURIComponent(name)}.md\n`,
  // The forms whose value no reading of YAML keeps a link (review of R19, wave 2): `tags` and `aliases`, which the
  // index reads as text, a link as a key, a link in a block of text, a comment and a tab between its names.
  "Projects/Forms.md": `---\ntags: [[${name}, Meier]]\naliases: [[${name}]]\n[[${name}]]: v\nkeyed:\n  [[Private/${name}]]: w\nblock: |\n  [[${name},\n  Meier]]\ncommented: [[${name},  # c\n  Meier]]\ntabbed: [[${name},\tMeier]]\n---\n# Forms\n\nThe forms of the year.\n`,
  "Projects/Forms.base": "filters:\n  and:\n    - file.folder == \"Projects\"\nviews:\n  - type: table\n    name: T\n    order: [tags, aliases, keyed, block, commented, tabbed]\n",
  // Rows chosen and counted by what such a value holds: by a condition, by a tag source, by a rollup's count.
  "Projects/Tagged.base": "filters:\n  and:\n    - file.folder == \"Projects\"\n    - 'contains(tags, \"Kowalski\")'\nviews:\n  - type: table\n    name: T\n    order: [tags]\n",
  "Projects/TagSource.base": `filters:\n  and:\n    - 'file.hasTag("[${HIDDEN[0]}, Meier]")'\nviews:\n  - type: table\n    name: T\n    order: [aliases]\n`,
  "Projects/Hub.md": "---\nkids: [\"[[Projects/Forms]]\"]\n---\n# Hub\n",
  // The task database: a task of it is named by its note's title, in each way YAML reads a link (review of R19).
  "Projects/Tasks.base": 'filters:\n  and:\n    - file.folder == "Projects/Tasks"\ncolumns:\n  due:\n    input: date\nviews:\n  - type: table\n    name: T\n    order: [due]\n',
  ...Object.fromEntries(Object.entries(TITLES(name)).map(([form, title]) => [`Projects/Tasks/Do ${form}.md`, `---\ntitle: ${title}\ndue: 2026-11-13\n---\n# Do ${form}\n`])),
  // A database whose views are named with links, in each way YAML writes one (review of R19, wave 2).
  "Projects/Views.base": `filters:\n  and:\n    - file.folder == "Projects/Tasks"\nviews:\n  - type: table\n    name: "Talk [[${name}]]"\n  - type: table\n    name: Talk [[Private/${name}]] here\n  - type: table\n    name: "Talk [[${escaped(name)}]]"\n  - type: table\n    name: "Talk [[${name},\tMeier]]"\n  - type: table\n    name: T\n`,
  // Notes named by such a title: each links to the hub and holds a task, so every list that names a note names them.
  ...Object.fromEntries(Object.entries(TITLES(name)).map(([form, title]) => [`Projects/Titled ${form}.md`, `---\ntitle: ${title}\n---\n# ${form}\n\nThe titled ${form}, see [[Projects/Hub]].\n\n- [ ] call about ${form} 📅 2026-11-13\n`])),
  // A tag YAML builds from an escape, and a source that chooses rows by that tag (review of R19, wave 2).
  "Projects/Escaped.md": `---\ntags: ["[[${escaped(name)}]]", "kept"]\nnote: "[[${escaped(name)}]]"\n---\n# Escaped\n`,
  "Projects/EscapedSource.base": `filters:\n  and:\n    - 'file.hasTag("[[${HIDDEN[0]}]]")'\nviews:\n  - type: table\n    name: T\n    order: [tags]\n`,
  "Projects/Count.base":
    "filters:\n  and:\n    - file.folder == \"Projects\"\ncolumns:\n  kids:\n    input: link\n  k:\n    rollup:\n      through: kids\n      of: tags\n      fn: countWhere\n      where:\n        op: contains\n        value: Kowalski\n  a:\n    rollup:\n      through: kids\n      of: aliases\n      fn: list\nviews:\n  - type: table\n    name: T\n    order: [kids, k, a]\n",
  "Projects/Comma.base": "filters:\n  and:\n    - file.folder == \"Projects\"\nviews:\n  - type: table\n    name: T\n    order: [comma, labelled, colon, spread, inside, items]\n",
  "Projects/Board.base": "filters:\n  and:\n    - file.folder == \"Projects\"\nviews:\n  - type: table\n    name: T\n    order: [owner, related, unquoted, up]\n    sort:\n      - property: owner\n        direction: ASC\n",
  "Projects/Filtered.base": "filters:\n  and:\n    - 'contains(owner, \"Z\")'\nviews:\n  - type: table\n    name: T\n    order: [owner]\n",
  "Projects/Unquoted.base": "filters:\n  and:\n    - file.folder == \"Projects\"\nviews:\n  - type: table\n    name: T\n    order: [unquoted, up]\n    sort:\n      - property: up\n        direction: ASC\n      - property: unquoted\n        direction: DESC\n",
  "Projects/Roll.base":
    "filters:\n  and:\n    - file.folder == \"Projects\"\ncolumns:\n  rel:\n    input: link\n  k:\n    rollup:\n      through: rel\n      of: owner\n      fn: countWhere\n      where:\n        op: contains\n        value: Aaron\n  names:\n    rollup:\n      through: rel\n      of: owner\n      fn: list\nviews:\n  - type: table\n    name: T\n    order: [rel, k, names]\n",
  // The note kept back: it links to readable notes, and shares a section with one of them.
  [`Private/${name}.md`]: `# ${name}\n\n${name} earns more. See [[Projects/Pay]].\n\n${AGENDA}`,
  // Two more kept back, named by a link with a comma in it and by the title of their properties, with a colon.
  [`Private/${name}, Meier.md`]: `# ${name}, Meier\n`,
  "Private/Brief.md": `---\ntitle: "Brief: ${name}"\n---\n# Brief\n`,
});

/** The same in both vaults: what the mail account holds names no note. */
const MAIL = { id: "a1", label: "Work", address: "me@example.org", inbox: "INBOX", numericIds: true };
const ENVELOPE = { id: "7", subject: "Pay review", from: "boss@example.org", dateTs: 1_700_000_000_000, seen: true, flagged: false };

async function vaultOf(name: string) {
  resetGistStores();
  const vault = new MemoryVaultAdapter(1_000);
  await vault.writeTextFile(".agent/policy.yml", "folders:\n  Private/:\n    cloud: deny\n");
  for (const [path, text] of Object.entries(readable(name))) await vault.writeTextFile(path, text);
  const db = await realSqlite();
  await new VaultIndexer(vault, db).indexVaultFull();
  const query = new VaultQueryService(db as never);
  const read = (path: string) => vault.readTextFile(path).catch(() => null);
  const exists = async (path: string) => (await read(path)) !== null;
  const policy = createVaultPolicy({
    readFile: read,
    resolveLink: (target, from) => query.resolveNotePath(target, from),
    fileNames: () => query.linkTargets(),
    encrypted: () => false,
  });
  const memoryText = `- Ask [[Private/${name}]] about the pay\n- The offer goes out on Friday\n`;
  const event = { title: `Talk with [[Private/${name}]]`, start: new Date(2026, 10, 13, 10), end: new Date(2026, 10, 13, 11), allDay: false, calendar: "Work", details: { key: "work/cal/1", location: `Room of [[${name}]]` } };
  const proposed: ProposalRound[] = [];
  const deps: VaultToolDeps = {
    async search(q, limit, offset, within, withContent) {
      const hits = await query.searchFullText(q, limit, offset, withContent === true, null, within);
      return hits.map((hit) => ({ path: hit.path, title: hit.title || hit.path, snippet: hit.snippet ?? null, content: hit.sourceContent ?? null }));
    },
    readNote: read,
    resolveLink: (target, from) => query.resolveNotePath(target, from),
    linkCandidates: async (target, from) => filesALinkCouldMean(buildLinkNameIndex(await query.linkTargets()), target, from),
    policyOf: (path, text) => policy.policyOf(path, text),
    // The tasks as both shells list them (`desktopAi`, `mobileAi`): the rows of the task database, read as the run
    // asks, and the tasks of the notes, each named by the title of its note.
    taskRows: async (options) => [
      ...(await databaseTaskRows(await read("Projects/Tasks.base"), (config) => query.queryDatabaseFiles(config, options))),
      ...plannerRowsFromTasks((await query.listTasks()).filter((task) => !task.excluded)),
    ],
    todayKey: () => "2026-11-13",
    // A command that opens a note: its path is asked of the resolver (`run_command`, `open_in_app`).
    commands: () => [{ id: "open-note", label: "Open note", run: async () => true }],
    backlinks: (path, options) => query.getBacklinks(path, options),
    neighbors: (path, limit, options) => query.getLinkNeighbors(path, limit, options),
    recentlyOpened: async () => [{ path: "Projects/Pay.md", openedAt: 1 }],
    recentlyChanged: (limit, offset, within) => query.getRecentlyChangedNotes(limit, offset, within),
    queryDatabase: (config, options) => query.queryDatabaseFiles(config, options),
    notesAsSeen: (paths, reach, rule) => query.notesAsSeen(paths, reach, rule),
    moodKey: async () => "mood",
    events: async () => [event],
    mail: {
      accounts: async () => [MAIL],
      folders: async () => ["INBOX"],
      newest: async () => ({ messages: [ENVELOPE], offline: false }),
      search: async () => [ENVELOPE],
      message: async () => ({ ...ENVELOPE, to: "me@example.org", text: "Please look at the pay review.", html: null, attachments: [] }),
    },
    memory: async () => ({ active: [], long: parseMemory(memoryText, "long").entries, texts: { active: null, long: memoryText } }),
    writes: {
      sealed: () => false,
      current: read,
      propose: async (round: ProposalRound) => void proposed.push(round),
      folderExists: async () => true,
      taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
      draftPlace: async (kind, day) => (kind === "task" ? "Projects/Tasks.md" : `Daily/${day}.md`),
      renamePlan: (path, title) => noteRenamePlan({ getBacklinks: (target) => query.getBacklinks(target) }, exists, path, title),
      rename: async () => null,
      movePlan: (path, folder) => noteMovePlan(exists, path, folder),
      move: async () => null,
      requestDelete: async () => false,
      setRule: async () => false,
      entryPlace: async () => ({ folder: "Projects" }),
      pim: { mail: async () => true, calendar: async () => true },
    },
    history: {
      changedIn: (folder, since, limit, offset, within) => query.getNotesChangedIn(folder, since, limit, offset, within),
      created: () => query.getNoteCreated("Projects/Pay.md"),
      versions: async () => [{ id: "v1", at: new Date(2026, 10, 10).getTime() }],
      readVersion: async () => readable(name)["Projects/Pay.md"]!.replace("The rates of this year.", `Old rates, see [[Private/${name}]].`),
    },
  };
  // Short summaries, written by a model on this computer from the whole of every note (keeping every link).
  await new GistWriter(
    { db, readText: read, cloudAllowed: async (path, text) => (await policy.policyOf(path, text)).policy.cloud !== "deny", now: () => 10_000_000 },
    { id: "local/m", complete: async (_instruction, text) => `${text.split("\n")[0]}: about the plan. ${protectedTokens(text).join(" ")}`.slice(0, 300) },
  ).run(new AbortController().signal);
  // The short summaries of the folder and of the vault, as the writer leaves them: the verdict on them is kept.
  const store = new GistStore(db);
  await store.put({ key: areaGistKey("Projects"), level: "folder", source: areaGistKey("Projects"), text: "Rounds and rates of the studio.", ok: true, createdAt: 20_000_000 }, "local/m");
  await store.put({ key: VAULT_GIST_KEY, level: "vault", source: VAULT_GIST_KEY, text: "Notes of a small studio.", ok: true, createdAt: 20_000_000 }, "local/m");
  const gists = new GistReader(db, "local/m");
  return { deps, proposed, policy, query, gists, read, event, done: () => db.close() };
}

/** The two hidden names: one before every visible value of `owner`, one after it. */
const HIDDEN = ["Aaron Kowalski", "Zora Nowak"] as const;
const SECRETS = /Aaron|Kowalski|Zora|Nowak|Private\//;

function writer(): WriteRun {
  let drafts = 0;
  return {
    author: { id: "app", displayName: "App" },
    userTexts: () => [],
    inherited: async () => [],
    draft: async () => ({ ok: true, id: `d-${++drafts}` }),
    ask: async () => "yes",
    writes: { rounds: [], drafts: [], plans: [] },
    today: () => "2026-11-13",
    clock: () => "10:30",
  };
}

const cloud: EgressRecipient = { kind: "cloud", provider: "mcp:app", model: "app" };
const app: ToolScope = { inside: (path) => path.startsWith("Projects/"), folders: ["Projects"], confirm: async () => true, linksInReach: true };
const readers: [string, boolean, ToolScope | undefined][] = [
  ["an app over MCP", true, app],
  ["a cloud model", false, undefined],
];

/** The questions a reader may ask, each with the hidden note's name as a guess. */
const questions = (handle: string): [string, Record<string, unknown>][] => [
  ["search_vault", { query: "Kowalski", limit: 10 }],
  ["search_vault", { query: "Kowalskí", limit: 10 }],
  ["search_vault", { query: "Aaron", limit: 10 }],
  ["search_vault", { query: '"Aaron Kowalski"', limit: 10 }],
  ["search_vault", { query: "owner", limit: 10 }],
  ["search_vault", { query: "unquoted", limit: 10 }],
  ["search_vault", { query: "aaaa*", limit: 10 }],
  ["search_vault", { query: "rates -Kowalski", limit: 10 }],
  ["search_vault", { query: "rates -Aaron", limit: 10 }],
  ["search_vault", { query: "rates", limit: 10 }],
  ["search_vault", { query: "talk", limit: 10 }],
  ["read_note", { path: "Projects/Pay.md", maxChars: 8000 }],
  ["read_note", { path: "Projects/Pay.md", section: "Talk with [[Aaron Kowalski]]" }],
  ["read_note", { path: "Projects/Plan.md", maxChars: 8000 }],
  ["read_note", { path: "Projects/Second.md" }],
  ["read_note", { path: "Projects/Talk.md" }],
  ["get_outline", { path: "Projects/Pay.md" }],
  ["get_outline", { path: "Projects/Second.md" }],
  ["query_base", { base: "Projects/Board.base", limit: 20 }],
  ["query_base", { base: "Projects/Board.base", limit: 1 }],
  ["query_base", { base: "Projects/Filtered.base", limit: 20 }],
  ["query_base", { base: "Projects/Unquoted.base", limit: 20 }],
  ["query_base", { base: "Projects/Roll.base", limit: 20 }],
  ["query_base", { base: "Projects/Comma.base", limit: 20 }],
  ["read_note", { path: "Projects/Ref.md" }],
  ["get_outline", { path: "Projects/Ref.md" }],
  ["read_note", { path: "Projects/Forms.md" }],
  ["get_outline", { path: "Projects/Forms.md" }],
  ["search_vault", { query: "forms", limit: 10 }],
  ["search_vault", { query: "Meier", limit: 10 }],
  ["query_base", { base: "Projects/Forms.base", limit: 30 }],
  ["query_base", { base: "Projects/Tagged.base", limit: 20 }],
  ["query_base", { base: "Projects/TagSource.base", limit: 20 }],
  ["query_base", { base: "Projects/Count.base", limit: 30 }],
  ["query_base", { base: "Projects/EscapedSource.base", limit: 20 }],
  ["read_note", { path: "Projects/Escaped.md" }],
  ["search_vault", { query: "titled", limit: 20 }],
  ["search_vault", { query: "escaped", limit: 20 }],
  ["get_backlinks", { path: "Projects/Hub.md", limit: 20 }],
  ["graph_neighborhood", { path: "Projects/Hub.md", limit: 20, depth: 1 }],
  ["get_recent", { kind: "edited", limit: 40 }],
  ["get_changes", { since: "2000-01-01", limit: 40 }],
  ["get_tasks", { range: "all" }],
  ["get_tasks", { range: "today" }],
  ["query_base", { base: "Projects/Tasks.base", limit: 20 }],
  ["query_base", { base: "Projects/Views.base", limit: 5 }],
  ["query_base", { base: "Projects/Views.base", view: "T", limit: 5 }],
  ["query_base", { base: "Projects/Views.base", view: "Kowalski", limit: 5 }],
  ["get_backlinks", { path: "Projects/Pay.md", limit: 20 }],
  ["get_backlinks", { path: "Projects/Mia.md", limit: 20 }],
  ["graph_neighborhood", { path: "Projects/Pay.md", limit: 20, depth: 2 }],
  ["graph_neighborhood", { path: "Projects/Mia.md", limit: 20, depth: 1 }],
  ["get_recent", { kind: "edited", limit: 10 }],
  ["get_recent", { kind: "opened", limit: 10 }],
  ["get_changes", { since: "2000-01-01", limit: 10 }],
  ["get_note_history", { path: "Projects/Pay.md", since: "2026-11-01", until: "2026-11-13" }],
  ["get_calendar", { from: "2026-11-13", to: "2026-11-13" }],
  ["get_event", { id: handle }],
  ["search_mail", { query: "pay" }],
  ["search_mail", {}],
  ["search_mail", { folder: "Archive" }],
  ["read_mail", { message: "a1/INBOX/7", question: "What is it about?" }],
  ["run_command", { id: "nothing" }],
  ["run_command", { id: "open-note", args: { path: "Projects/Pay" } }],
  ["open_in_app", { path: "Projects/Pay.md" }],
  ["search_memory", { query: "pay" }],
  ["search_memory", { query: "Kowalski" }],
];

/** An answer without what the question itself said: a guess the reader made, said back to it, tells it nothing. */
function unasked(out: unknown, args: Record<string, unknown>): string {
  let text = JSON.stringify(out);
  const strings: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string" && value) strings.push(value, ...(value.match(/!?\[\[[^\]]*\]\]/g) ?? []));
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(args);
  // Longest first: a whole argument before a link inside it.
  for (const value of strings.sort((x, y) => y.length - x.length)) text = text.split(JSON.stringify(value).slice(1, -1)).join("");
  return text;
}

/** Changes that name the hidden note — by a guess the reader makes, so the same words in both vaults. */
const GUESS = HIDDEN[0];
const WRITES: [string, Record<string, unknown>][] = [
  ["propose_edit", { path: "Projects/Pay.md", append: `Ask [[Private/${GUESS}]].` }],
  ["propose_edit", { path: "Projects/Pay.md", append: `Ask [[${GUESS}]] and [[Projects/Mia]].` }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: GUESS, replace: "x" }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: `[[${GUESS}]]`, replace: "x" }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: "for the numbers.", replace: `for the numbers, see [[${GUESS}]].` }] }],
  ["propose_edit", { path: "Projects/Pay.md", edits: [{ find: "The rates of this year.", replace: "The rates of 2026." }] }],
  ["propose_edit", { path: "Projects/Second.md", edits: [{ find: "The rates again", replace: "The rates once more" }] }],
  ["set_property", { path: "Projects/Pay.md", key: "owner", value: "Mia" }],
  ["set_property", { path: "Projects/Pay.md", key: "unquoted", value: "Mia" }],
  ["set_property", { path: "Projects/Plan.md", key: "owner", value: `[[${GUESS}]]` }],
  ["set_property", { path: "Projects/Plan.md", key: "plainva.ai.web", value: "deny" }],
  ["create_note", { title: "Talk", body: `With [[${GUESS}]] and [[Private/${GUESS}]].` }],
  ["create_entry", { base: "Projects/Board.base", title: "Entry", properties: { owner: `[[${GUESS}]]` }, content: `See [[Private/${GUESS}]].` }],
  ["create_task", { text: `Ask [[${GUESS}]] about the pay` }],
  ["add_journal_entry", { text: `Met [[Private/${GUESS}]]` }],
  ["remember", { text: `[[${GUESS}]] is the owner` }],
  ["forget", { entry: `Ask [[Private/${GUESS}]] about the pay` }],
  ["forget", { entry: "Ask ⟦withheld note⟧ about the pay" }],
  ["draft_mail", { to: ["boss@example.org"], subject: "Pay", body: `See [[${GUESS}]].` }],
  ["draft_event", { title: `Talk [[${GUESS}]]`, day: "2026-11-14", start: "10:00" }],
  ["rename_note", { path: "Projects/Pay.md", title: "Pay 2026" }],
  ["move_note", { path: "Projects/Pay.md", folder: "Archive" }],
  ["move_note", { path: "Projects/Pay.md", folder: "Projects/Archive" }],
  ["delete_note", { path: "Projects/Pay.md" }],
];

/** What a poisoned text starts with: a tool that shows it took the text past the building block. */
const POISON = "☠";

/**
 * Every text a dependency of the tools hands over, by the dependency and the field it stands in (`search.title`,
 * `history.changedIn.title`; `*` stands for any field below), and how it may reach an answer (review of R19, wave 2):
 * "name" is what the index holds of a note's title or properties — a tool takes that from the building block
 * (`notesAsSeen`, `queryDatabaseFiles` with `withhold`) for such a reader, or shows nothing of it, so the guard poisons
 * it —; "text" is what the text barrier shows as the reader may see it, the view of the building block itself, or
 * names no note.
 */
const FIELDS: Record<string, "name" | "text"> = {
  "search.path": "text",
  "search.title": "name",
  "search.snippet": "text",
  "search.content": "text",
  readNote: "text",
  resolveLink: "text",
  linkCandidates: "text",
  // The gate's own answer about a note: never shown, it decides what is.
  "policyOf.*": "text",
  "taskRows.id": "text",
  "taskRows.source": "text",
  "taskRows.path": "text",
  "taskRows.noteTitle": "name",
  // A task's own text through the text barrier; a row of the task database read through the view (`withhold`).
  "taskRows.title": "text",
  "taskRows.state": "text",
  "taskRows.due": "text",
  "taskRows.status": "text",
  "taskRows.dbStatus": "text",
  "taskRows.tags": "text",
  "taskRows.line.text": "text",
  "taskRows.line.taskId": "text",
  "taskRows.details": "text",
  "taskRows.parentId": "text",
  "taskRows.priority": "text",
  todayKey: "text",
  "commands.id": "text",
  "commands.label": "text",
  "backlinks.source_path": "text",
  "backlinks.source_title": "name",
  "backlinks.target_path": "text",
  "backlinks.link_type": "text",
  // A heading of the note asked about, which the reader reads itself.
  "backlinks.anchor": "text",
  // The key a link stands under in the linking note's properties: the index's, never shown.
  "backlinks.property_key": "name",
  "neighbors.path": "text",
  "neighbors.title": "name",
  "recentlyOpened.path": "text",
  "recentlyChanged.path": "text",
  "recentlyChanged.title": "name",
  // The rows of a database come out of the building block itself (`queryDatabaseFiles` with `withhold`).
  "queryDatabase.*": "text",
  moodKey: "text",
  // The calendar's and the mail's texts name no note's title; they pass the text barrier.
  "events.*": "text",
  "mail.*": "text",
  "memory.*": "text",
  "writes.*": "text",
  "history.changedIn.path": "text",
  "history.changedIn.title": "name",
  "history.versions.id": "text",
  "history.readVersion": "text",
};

/**
 * Every dependency the tools can be given (`VaultToolDeps`): the guard's vault gives each one, so a new one fails the
 * typecheck until it stands here, and this guard until the vault gives it.
 */
const EVERY_DEPENDENCY: Record<keyof VaultToolDeps, true> = {
  search: true,
  readNote: true,
  resolveLink: true,
  linkCandidates: true,
  policyOf: true,
  taskRows: true,
  todayKey: true,
  commands: true,
  backlinks: true,
  neighbors: true,
  recentlyOpened: true,
  recentlyChanged: true,
  history: true,
  events: true,
  queryDatabase: true,
  notesAsSeen: true,
  moodKey: true,
  mail: true,
  writes: true,
  memory: true,
};

/** Dependencies no question of the guard reaches, and why nothing of theirs can name a note there. */
const UNASKED: Record<string, string> = {};

/** The place of a field (`FIELDS`): its own line, or the nearest `*` above it. */
function fieldOf(label: string): "name" | "text" | undefined {
  if (label in FIELDS) return FIELDS[label];
  const parts = label.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const wild = FIELDS[`${parts.slice(0, i).join(".")}.*`];
    if (wild) return wild;
  }
  return undefined;
}

const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/** Every dependency that is a function, by its place (`history.changedIn`). */
function dependencyNames(deps: object, at = ""): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(deps)) {
    if (typeof value === "function") names.push(`${at}${key}`);
    else if (plainObject(value)) names.push(...dependencyNames(value, `${at}${key}.`));
  }
  return names;
}

/** What a dependency hands over, every text of it noted by its field (`seen`), and poisoned where it names a note. */
function poisonOut(value: unknown, label: string, seen: Set<string>): unknown {
  if (typeof value === "string") {
    seen.add(label);
    return fieldOf(label) === "name" && value ? `${POISON}${value}` : value;
  }
  if (Array.isArray(value)) return value.map((item) => poisonOut(item, label, seen));
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, poisonOut(item, `${label}.${key}`, seen)]));
  if (value !== null && typeof value === "object") seen.add(`${label}<${(value as object).constructor?.name ?? "object"}>`);
  return value;
}

/** The dependencies with every answer of theirs passed through `poisonOut`, each call noted (`called`). */
function poisoned(deps: object, seen: Set<string>, called: Set<string>, at = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(deps)) {
    const label = `${at}${key}`;
    if (typeof value === "function") {
      out[key] = (...args: unknown[]) => {
        called.add(label);
        const answer = (value as (...a: unknown[]) => unknown)(...args);
        return answer instanceof Promise ? answer.then((resolved) => poisonOut(resolved, label, seen)) : poisonOut(answer, label, seen);
      };
    } else if (plainObject(value)) out[key] = poisoned(value, seen, called, `${label}.`);
    else out[key] = value;
  }
  return out;
}

describe("the reader-view guard on the real search path", () => {
  it("asks every read tool and every write tool such a reader reaches: a new one needs its question here", async () => {
    const v = await vaultOf(HIDDEN[0]);
    const further = furtherToolNames(v.deps);
    const reached = new Set([...CHAT_TOOL_NAMES, ...toolsFor("mcp").filter((tool) => mcpToolKind(tool) === "read").map((tool) => tool.name), ...further.filter((name) => toolByName(name)?.risk === "read")]);
    const asked = new Set(questions("").map(([name]) => name));
    expect([...reached].filter((name) => !asked.has(name))).toEqual([]);
    const writing = new Set(further.filter((name) => toolByName(name)?.risk !== "read"));
    const written = new Set(WRITES.map(([name]) => name));
    expect([...writing].filter((name) => !written.has(name))).toEqual([]);
    await v.done();
  });

  for (const [who, web, scope] of readers) {
    it(`${who}: two vaults that differ only in the hidden note's name answer every question alike, and name it nowhere`, async () => {
      const [a, z] = [await vaultOf(HIDDEN[0]), await vaultOf(HIDDEN[1])];
      for (const [name, args] of questions(eventHandle(a.event)!)) {
        const ask = (d: VaultToolDeps) => createVaultToolExecutor(d, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(d) }).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        const [fromA, fromZ] = [await ask(a.deps), await ask(z.deps)];
        const label = `${name} ${JSON.stringify(args)}`;
        expect(unasked(fromA, args), label).not.toMatch(SECRETS);
        expect(unasked(fromZ, args), label).not.toMatch(SECRETS);
        expect(fromA, label).toEqual(fromZ);
      }
      await a.done();
      await z.done();
    });

    /**
     * Every tool on the list names a note by the title its view gives (`notesAsSeen`), never by what the index holds
     * (review of R19, wave 2): every text any dependency hands the tools is sorted by where it stands (`FIELDS`), and
     * each that names a note by what the index holds of it is poisoned here, while the building block answers for
     * every note. A tool that took such a text past the building block names a note by the poison; a field or a
     * dependency nobody sorted yet turns this red until it has its line.
     */
    it(`${who}: no tool names a note by a text the index holds past the reader's view of it`, async () => {
      const v = await vaultOf(HIDDEN[0]);
      const seen = new Set<string>();
      const called = new Set<string>();
      const real = v.deps;
      const deps = poisoned(real, seen, called) as unknown as VaultToolDeps;
      // The building block answers for every note: by the name of its file where its view withholds nothing.
      deps.notesAsSeen = async (paths, reach, rule) => {
        called.add("notesAsSeen");
        const found = new Map(await real.notesAsSeen!(paths, reach, rule));
        for (const path of paths) if (!found.has(path)) found.set(path, { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), tags: [] });
        return found;
      };
      for (const [name, args] of questions(eventHandle(v.event)!)) {
        const out = await createVaultToolExecutor(deps, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(deps) }).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        expect(JSON.stringify(out), `${name} ${JSON.stringify(args)}`).not.toContain(POISON);
      }
      for (const [name, args] of WRITES) {
        const out = await createVaultToolExecutor(deps, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(deps) }, writer()).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        expect(JSON.stringify(out), `${name} ${JSON.stringify(args)}`).not.toContain(POISON);
      }
      // Every dependency is given, every field a dependency handed over has its place, and every dependency was asked
      // or says why it is not.
      const functions = dependencyNames(real);
      expect({
        notGiven: Object.keys(EVERY_DEPENDENCY).filter((key) => !(key in real)),
        unsorted: [...seen].filter((label) => fieldOf(label) === undefined).sort(),
        unasked: functions.filter((label) => !called.has(label) && !(label in UNASKED)).sort(),
        listedButAsked: Object.keys(UNASKED).filter((label) => called.has(label) || !functions.includes(label)).sort(),
      }).toEqual({ notGiven: [], unsorted: [], unasked: [], listedButAsked: [] });
      await v.done();
    });

    it(`${who}: a change that names the hidden note is answered alike in both vaults`, async () => {
      const [a, z] = [await vaultOf(HIDDEN[0]), await vaultOf(HIDDEN[1])];
      for (const [name, args] of WRITES) {
        const ask = (d: VaultToolDeps) => createVaultToolExecutor(d, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(d) }, writer()).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
        const [fromA, fromZ] = [await ask(a.deps), await ask(z.deps)];
        const label = `${name} ${JSON.stringify(args)}`;
        expect(unasked(fromA, args), label).not.toMatch(SECRETS);
        expect(fromA, label).toEqual(fromZ);
      }
      // What was laid down for the user is the user's to see, raw: the same changes in both.
      expect(a.proposed.length).toBe(z.proposed.length);
      await a.done();
      await z.done();
    });
  }

  it("get_backlinks cuts the linking line and the headings above it from the view of the whole note (review of R19, wave 2)", async () => {
    for (const [who, web, scope] of readers) {
      const v = await vaultOf(HIDDEN[0]);
      const args = { path: "Projects/Mia.md", limit: 20 };
      const out = await createVaultToolExecutor(v.deps, { recipient: cloud, webTools: web }, scope).execute(toolByName("get_backlinks")!, args, { type: "tool_call", id: "c", name: "get_backlinks", args });
      expect(JSON.stringify(out), who).not.toMatch(SECRETS);
      // A reference link whose definition stands on another line: withheld in its line and in the heading over it.
      const ref = (out.data as { notes: { path: string; places: unknown[] }[] }).notes.find((note) => note.path === "Projects/Ref.md");
      expect(ref?.places, who).toEqual([{ line: 5, under: "Ref › Talk ⟦withheld note⟧", text: "See [[Projects/Mia]] and ⟦withheld note⟧." }]);
      expect(out.content, who).toContain("  - line 5 (Ref › Talk ⟦withheld note⟧): See [[Projects/Mia]] and ⟦withheld note⟧.");
      await v.done();
    }
  });

  it("an entry of the memory that holds a withheld link is taken out or reworded by its placeholder: the draft names it as it stands in the file, the answer does not (review of R19, wave 2)", async () => {
    for (const [who, web, scope] of readers) {
      const v = await vaultOf(HIDDEN[0]);
      const drafted: { title: string; body: unknown }[] = [];
      const run: WriteRun = { ...writer(), draft: async (draft) => (drafted.push(draft), { ok: true, id: `d-${drafted.length}` }) };
      const ask = (name: string, args: Record<string, unknown>) =>
        createVaultToolExecutor(v.deps, { recipient: cloud, webTools: web }, scope, undefined, { more: furtherToolNames(v.deps) }, run).execute(toolByName(name)!, args, { type: "tool_call", id: "c", name, args });
      const forgot = await ask("forget", { entry: "Ask ⟦withheld note⟧ about the pay" });
      const reworded = await ask("remember", { text: "Ask about the pay on Monday", replaces: "Ask ⟦withheld note⟧ about the pay" });
      expect(forgot.isError, who).toBeFalsy();
      expect(reworded.isError, who).toBeFalsy();
      expect(JSON.stringify([forgot, reworded, drafted.map((d) => d.title)]), who).not.toMatch(SECRETS);
      // The entry as it stands in the file, for the user who says yes to the draft.
      const raw = `Ask [[Private/${HIDDEN[0]}]] about the pay`;
      expect(drafted.map((d) => d.body), who).toMatchObject([{ kind: "forget", entry: raw }, { kind: "memory", text: "Ask about the pay on Monday", replaces: raw }]);
      // A placeholder is never written: not as the new words of an entry.
      expect((await ask("remember", { text: "Ask ⟦withheld note⟧ on Monday" })).isError, who).toBe(true);
      expect(drafted, who).toHaveLength(2);
      await v.done();
    }
  });

  it("a cloud model: the context package with its short summaries is the same in both vaults, and names the hidden note nowhere — kept over messages too", async () => {
    const [a, z] = [await vaultOf(HIDDEN[0]), await vaultOf(HIDDEN[1])];
    const situation = {
      now: "2026-11-13 10:00",
      weekday: "Friday",
      calendarDay: "2026-11-13",
      journalDay: "2026-11-13",
      active: { path: "Projects/Pay.md", title: "Pay", kind: "note" as const, properties: {} as Record<string, unknown> },
      tabs: [{ path: "Projects/Talk.md", title: "Talk" }],
      tasks: [],
      events: [],
      dailyNote: null,
    };
    const pack = async (v: Awaited<ReturnType<typeof vaultOf>>, open = "Projects/Pay.md") => {
      // The open note's properties as both shells read them (`situationFrom`): as they are written.
      const properties = notePropertiesOf((await v.read(open))!);
      // The host as the shells hand it to the package (`aiSession`): the vault policy with its stamp of the rules and
      // its one read of the names, so a verdict on an area's summary is kept over messages.
      const host = {
        policyOf: (path: string, content?: string) => v.policy.policyOf(path, content),
        resolveLink: (target: string, from: string) => v.query.resolveNotePath(target, from),
        linkCandidates: async (target: string, from: string) => filesALinkCouldMean(buildLinkNameIndex(await v.query.linkTargets()), target, from),
        rulesStamp: () => v.policy.rulesStamp!(),
        ...(v.policy.linkSnapshot ? { linkSnapshot: () => v.policy.linkSnapshot!() } : {}),
        readNote: async (path: string) => {
          const t = await v.read(path);
          return t === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text: t };
        },
        gists: v.gists,
      };
      const found = ["Projects/Weekly.md", "Projects/Second.md", "Projects/Plan.md", "Projects/Pay.md"].map((path, i) => ({ path, title: path.replace(/^.*\//, "").replace(/\.md$/, ""), signals: { lexical: i === 0 ? 0.4 : 0.1 } }));
      const active = { ...situation.active, path: open, title: open.replace(/^.*\//, "").replace(/\.md$/, ""), properties };
      // The due tasks as both shells hand them to the package: the task database read through the reader's view.
      const rows = await v.deps.taskRows(situationReach((path) => v.policy.policyOf(path), { recipient: cloud, webTools: false }));
      const { tasks } = situationFrom({ now: new Date(2026, 10, 13, 10), active: null, taskRows: rows });
      expect(tasks.length).toBeGreaterThan(5);
      const out = await buildContextPackage({ question: "How do the rounds go?", recipient: cloud, situation: { ...situation, active, tasks }, candidates: [found], pins: [], budget: { evidence: 0, cards: 2, map: 6 } }, host);
      return out.part.text;
    };
    // The summaries are there: written for the notes, among them one that shares its section with the hidden note.
    expect(await a.gists.note("Projects/Weekly.md")).toBeTruthy();
    for (const open of ["Projects/Pay.md", "Projects/Forms.md"]) {
      const [fromA, fromZ] = [await pack(a, open), await pack(z, open)];
      expect(fromA, open).not.toMatch(SECRETS);
      expect(fromA, open).toEqual(fromZ);
      // The next message decides from the verdicts it kept, and says the same.
      const [againA, againZ] = [await pack(a, open), await pack(z, open)];
      expect(againA, open).toEqual(fromA);
      expect(againZ, open).toEqual(fromZ);
    }
    expect(a.gists.verdicts.size).toBeGreaterThan(0);
    await a.done();
    await z.done();
  });
});
