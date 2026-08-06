/**
 * Fixture for the mobile screenshot baseline.
 *
 * The baseline used to photograph an app that could not show what was being
 * checked. It had no accounts, no attachments, no empty vault and — because a
 * plain browser has no SQLite — no search index at all. The consequence was
 * not a gap, it was a false green: the "graph" picture showed the empty state
 * "the map appears once the search index is built", in every theme, for
 * fifteen steps, and each one was compared against the previous empty state
 * and counted as covered (rework N0.1).
 *
 * This module supplies the two things that were missing.
 *
 * 1. A REAL database. `node:sqlite` runs in this process, one connection per
 *    vault, and two functions are exposed into the page; the app's
 *    `FixtureSqliteAdapter` is the client for them. Nothing here answers a
 *    query itself — the indexer, the query service and `GraphService` run
 *    their actual SQL against actual SQLite, so a surface that renders is a
 *    surface that really works.
 * 2. Content. Notes that link each other densely enough for a graph to have a
 *    shape, an attachments folder, two cloud accounts (one of them not signed
 *    in on this device, so the repair path has something to show), a second,
 *    deliberately empty vault, and a sync error.
 *
 * The content is written through the app's OWN public plugin proxies
 * (`window.Capacitor.Plugins.Filesystem` / `.Preferences`), never by poking at
 * IndexedDB internals: a fixture that knows a storage layout breaks the day
 * the layout moves, and then quietly captures nothing again.
 */

import { DatabaseSync } from "node:sqlite";

/** Installed on the page as `globalThis.__plainvaFixtureSql`. */
const BRIDGE_KEY = "__plainvaFixtureSql";

const OKF = (title, body, type = "Note", tags = []) =>
  `---\ntype: ${type}\nokf_version: "1.0"${
    tags.length ? `\ntags:\n${tags.map((tag) => `  - ${tag}`).join("\n")}` : ""
  }\n---\n\n# ${title}\n\n${body}\n`;

/**
 * Notes for the graph. Density is the point: the vault map draws folder
 * bubbles and the edges between their members, so a handful of unconnected
 * notes still looks like an empty state. These three folders cite each other
 * in both directions.
 */
/**
 * A database over the Projekte folder. The fixture had NO `.base` at all, which
 * made every database surface — table, board, pinboard, the setup sheet —
 * impossible to photograph, so each of them counted as unchecked. The pinboard
 * leads because it is the surface the container work rebuilt; the table view
 * beside it proves the same file drives both.
 * Only a folder source and no global `contains()`: that is the shape Obsidian
 * accepts, and the reserved OKF names are excluded by the query, not a filter.
 */
export const FIXTURE_BASE = `filters:
  and:
    - file.folder == "Projekte"
properties:
  note.status:
    displayName: Status
views:
  - type: table
    name: Pinnwand
    order:
      - note.status
    plainva:
      render: pinboard
  - type: table
    name: Tabelle
    order:
      - note.status
`;

export const FIXTURE_NOTES = [
  [
    "Projekte/Plainva Nacharbeit.md",
    OKF(
      "Plainva Nacharbeit",
      "Die Oberfläche folgt dem Mockup.\n\nGehört zu [[Bereiche/Produkt]] und [[Projekte/Mobile Neuentwurf]].\nNotizen: [[Notizen/Container-Grammatik]], [[Notizen/Abstände]].",
      "Note",
      // A root tag WITH children and one without: the tag list has to show a
      // nested row beside a flat one, which is where the two row heights were.
      ["design/oberfläche", "offen"],
    ),
  ],
  [
    "Projekte/Mobile Neuentwurf.md",
    OKF(
      "Mobile Neuentwurf",
      "Drei Flächen statt vierundzwanzig Screens.\n\nSiehe [[Projekte/Plainva Nacharbeit]] und [[Notizen/Navigation]].\nBereich: [[Bereiche/Produkt]].",
      "Note",
      ["design/navigation", "offen"],
    ),
  ],
  [
    "Projekte/Sync-Konvergenz.md",
    OKF(
      "Sync-Konvergenz",
      "Ein Katalog entscheidet, was übertragen wird.\n\nBereich: [[Bereiche/Technik]].\nHängt an [[Notizen/Konten]].",
    ),
  ],
  [
    "Bereiche/Produkt.md",
    OKF(
      "Produkt",
      "Laufende Vorhaben: [[Projekte/Plainva Nacharbeit]], [[Projekte/Mobile Neuentwurf]].\nGrundlagen in [[Notizen/Container-Grammatik]].",
    ),
  ],
  [
    "Bereiche/Technik.md",
    OKF(
      "Technik",
      "Laufende Vorhaben: [[Projekte/Sync-Konvergenz]].\nSiehe [[Notizen/Konten]] und [[Notizen/Navigation]].",
    ),
  ],
  [
    "Notizen/Container-Grammatik.md",
    OKF(
      "Container-Grammatik",
      "Eine umrandete Karte fasst Zeilen mit Trennlinien unter einer Überschrift zusammen.\n\nGebraucht von [[Projekte/Plainva Nacharbeit]] und [[Bereiche/Produkt]].",
    ),
  ],
  [
    "Notizen/Abstände.md",
    OKF(
      "Abstände",
      "Eine Seiten-Einzugskante statt zehn.\n\nGehört zu [[Notizen/Container-Grammatik]] und [[Projekte/Plainva Nacharbeit]].",
    ),
  ],
  [
    "Notizen/Navigation.md",
    OKF(
      "Navigation",
      "Die Leiste ist eine schwebende Kapsel und liegt außerhalb des Flusses.\n\nSiehe [[Projekte/Mobile Neuentwurf]] und [[Bereiche/Technik]].",
    ),
  ],
  [
    "Notizen/Konten.md",
    OKF(
      "Konten",
      "Eine Karte je Konto, nicht je Dienst.\n\nGehört zu [[Projekte/Sync-Konvergenz]] und [[Bereiche/Technik]].",
    ),
  ],
  [
    "Notizen/Leerzustände.md",
    OKF(
      "Leerzustände",
      "Jeder Leerzustand bietet etwas an.\n\nSiehe [[Notizen/Container-Grammatik]].",
    ),
  ],
];

/**
 * A 1×1 PNG and a tiny text file. The attachments surface only has to prove
 * that non-Markdown files appear with the right affordances — the picture's
 * CONTENT is irrelevant, its presence is not.
 */
const PNG_1PX_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const FIXTURE_ATTACHMENTS = [
  ["Anhaenge/Skizze.png", PNG_1PX_BASE64],
  ["Anhaenge/Notizzettel.txt", Buffer.from("Handschriftlich abgetippt.\n", "utf8").toString("base64")],
];

/** Vault id of the default local vault (mirrors LOCAL_VAULT_ID). */
const LOCAL_VAULT = "local";
/**
 * A second vault that is genuinely empty.
 *
 * It carries a provider and is paused, which is not a trick — it is the one
 * real state in which a vault HAS no content: freshly connected, nothing
 * pulled yet. A local vault can never be empty, because the app seeds its
 * welcome notes into any local vault it finds empty, so asking for one would
 * have photographed the seed screen and called it the empty state.
 */
export const EMPTY_VAULT = "fixture-empty";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/**
 * Preferences entries, written under the web store's `CapacitorStorage.`
 * prefix. Two accounts on purpose, and only ONE of them has a credential slot:
 * the other renders the "sign in on this device" path, which is the repair
 * route N4.1 has to put on the accounts surface and which no picture has ever
 * shown.
 */
export function fixtureStorage() {
  const mailAccounts = [
    {
      id: "mail-fixture-1",
      label: "anna@example.org",
      host: "imap.example.org",
      port: 993,
      user: "anna@example.org",
      smtpHost: "smtp.example.org",
      smtpPort: 587,
      kind: "imap",
    },
  ];
  const cloudAccounts = [
    {
      id: "acct-fixture-mail",
      family: "fastmail",
      label: "anna@example.org",
      services: { mail: { mailAccountId: "mail-fixture-1" } },
    },
    {
      id: "acct-fixture-cal",
      family: "google",
      label: "anna@gmail.com",
      services: { calendar: { pimAccountId: "pim-fixture-1" } },
    },
  ];
  return {
    // Registry: the local vault plus an empty second one, so a capture can
    // switch to a vault that has genuinely nothing in it.
    vault_registry: {
      vaults: [
        { id: LOCAL_VAULT, name: "" },
        { id: EMPTY_VAULT, name: "Leerer Vault", provider: "webdav", paused: true },
      ],
      activeId: LOCAL_VAULT,
    },
    [`mailAccounts_${b64(LOCAL_VAULT)}`]: mailAccounts,
    [`cloudAccounts_${LOCAL_VAULT}`]: cloudAccounts,
    // Exactly one credential slot — see the note above.
    [`secret_mail_${b64(LOCAL_VAULT)}_mail-fixture-1`]: { password: "fixture" },
  };
}

/** Calendar accounts live in the index database, so they are seeded in SQL. */
function seedPimAccounts(db) {
  db.prepare(
    "INSERT OR REPLACE INTO pim_accounts (id, provider, label, config, enabled) VALUES (?, ?, ?, ?, 1)",
  ).run("pim-fixture-1", "google", "anna@gmail.com", JSON.stringify({ clientId: "fixture-client" }));
  db.prepare(
    "INSERT OR REPLACE INTO pim_calendars (account_id, cal_id, name, color, selected, read_only) VALUES (?, ?, ?, ?, 1, 0)",
  ).run("pim-fixture-1", "primary", "Anna", "#4a8f8b");
}

/* ------------------------------------------------------------ sql bridge */

/**
 * Opens the bridge for one browser context. Databases are keyed by the name
 * the app asks for and OUTLIVE the individual pages: a capture opens one page
 * per surface, and rebuilding the index for each of them would cost the run
 * minutes and photograph a half-filled index on the way.
 */
export async function installSqlBridge(context) {
  const dbs = new Map();

  const open = (name) => {
    let db = dbs.get(name);
    if (!db) {
      db = new DatabaseSync(":memory:");
      dbs.set(name, db);
    }
    return db;
  };

  await context.exposeFunction(`${BRIDGE_KEY}__exec`, (name, sql, params) => {
    open(name).prepare(sql).run(...params);
  });
  await context.exposeFunction(`${BRIDGE_KEY}__all`, (name, sql, params) =>
    // Structured clone cannot carry BigInt, which SQLite hands back for large
    // integers; the app only ever reads these as numbers anyway.
    open(name)
      .prepare(sql)
      .all(...params)
      .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))),
  );

  // The adapter looks for one object, so the two exposed functions are bound
  // into it before the app's bundle runs.
  await context.addInitScript(
    ({ key }) => {
      const g = globalThis;
      g[key] = {
        exec: (db, sql, params) => g[`${key}__exec`](db, sql, params),
        all: (db, sql, params) => g[`${key}__all`](db, sql, params),
      };
    },
    { key: BRIDGE_KEY },
  );

  return {
    /** Row count of a table — the run's own proof that indexing happened. */
    count(dbName, table) {
      const db = dbs.get(dbName);
      if (!db) return 0;
      try {
        return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
      } catch {
        return 0;
      }
    },
    seedPim(dbName) {
      seedPimAccounts(open(dbName));
    },
    close() {
      for (const db of dbs.values()) db.close();
      dbs.clear();
    },
  };
}

/* ---------------------------------------------------------------- seeding */

/**
 * Writes the fixture into a booted page.
 *
 * Order matters: the app seeds its welcome vault only when the directory is
 * empty, so the extra notes are added AFTER the first boot rather than
 * replacing what a real first start produces.
 */
export async function seedFixtureContent(page, { notes, attachments, storage }) {
  await page.evaluate(
    async ({ notes, attachments, storage }) => {
      const { Filesystem, Preferences } = globalThis.Capacitor.Plugins;
      const DIRECTORY = "DATA"; // Directory.Data — where CapacitorVaultAdapter keeps the vault
      // Notes go in as TEXT: the adapter reads them with Encoding.UTF8, so a
      // base64 payload would come back as its own base64 string and every note
      // would render as gibberish.
      for (const [path, text] of notes) {
        await Filesystem.writeFile({
          path: `vault/${path}`,
          data: text,
          directory: DIRECTORY,
          encoding: "utf8",
          recursive: true,
        });
      }
      // Attachments have no encoding — that is how the plugin stores bytes.
      for (const [path, base64] of attachments) {
        await Filesystem.writeFile({ path: `vault/${path}`, data: base64, directory: DIRECTORY, recursive: true });
      }
      for (const [key, value] of Object.entries(storage)) {
        await Preferences.set({ key, value: JSON.stringify(value) });
      }
    },
    { notes, attachments, storage },
  );
}
