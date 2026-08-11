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

/** A task-database entry: OKF plus the three columns the base declares. */
const TASK = (title, { status, frist, repeat } = {}) =>
  `---\ntype: Note\nokf_version: "1.0"${status ? `\nstatus: ${status}` : ""}${
    frist ? `\nfrist: ${frist}` : ""
  }${
    repeat ? `\nplainva:\n  repeat:\n    freq: ${repeat}\n    interval: 1\n    from: due` : ""
  }\n---\n\n# ${title}\n`;

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
  - type: calendar
    name: Termine
    dateField: faellig
    order:
      - note.status
  - type: timeline
    name: Zeitleiste
    dateField: faellig
    endField: bis
    order:
      - note.status
`;

/**
 * A task DATABASE, so the tasks surface can be photographed as itself (N9.4).
 *
 * Until now the only task in the fixture came from the app's own welcome note:
 * one line, no due date, no tags, and no database at all. The surface the
 * maintainer photographed — a database section with status, dates and
 * recurrences — was therefore not reachable by any capture, and the round that
 * reshaped it would have had to reason about it instead of looking.
 *
 * The completion model is the STATUS column (first option open, last done) —
 * the same convention the desktop uses; `frist` gives the meta line a date.
 */
export const FIXTURE_TASK_BASE = `filters:
  and:
    - file.folder == "Aufgaben"
properties:
  note.status:
    displayName: Status
    plainva:
      input: select
      options:
        - Offen
        - In Arbeit
        - Erledigt
  note.frist:
    displayName: Frist
    plainva:
      input: datetime
views:
  - type: table
    name: Tabelle
    order:
      - note.status
      - note.frist
`;

/**
 * A bookmark, so the navigator's chip row is a state a capture can SHOW.
 * Without it the one band this rework round reshapes could only be reasoned
 * about, and a surface that cannot be photographed counts as unverified.
 */
export const FIXTURE_BOOKMARKS = JSON.stringify({
  items: [{ type: "file", path: "Projekte/Plainva Nacharbeit.md" }],
});

/**
 * Entries of the task database, plus a note whose CHECKBOXES the second section
 * groups. Between them they cover what a task row can carry: a status, a due
 * date, a recurrence, a done state, tags — and a title long enough to prove
 * that the row uses the width of the screen rather than the width of its text.
 */
export const FIXTURE_TASKS = [
  [
    "Aufgaben/Container-Grammatik in der Aufgabenliste nachziehen.md",
    TASK("Container-Grammatik in der Aufgabenliste nachziehen", {
      status: "In Arbeit",
      frist: "2026-08-12",
      repeat: "weekly",
    }),
  ],
  ["Aufgaben/Kalender-Anmeldung erneuern.md", TASK("Kalender-Anmeldung erneuern", { status: "Offen", frist: "2026-08-09" })],
  ["Aufgaben/Suchfeld im Graph.md", TASK("Suchfeld im Graph", { status: "Offen" })],
  // Due on the run's FIXED day (2026-08-02). Without it the Today surface's
  // "due" section could only ever be photographed empty, and round 3 rebuilt
  // that section — a surface nobody photographs is a surface that rots.
  [
    "Aufgaben/Wischgeste am Gerät gegenprüfen.md",
    TASK("Wischgeste am Gerät gegenprüfen", { status: "Offen", frist: "2026-08-02" }),
  ],
  // Due on the same fixed day, but at a TIME (S6). The column is a `datetime`,
  // so the note may carry a clock — and a fixture whose tasks are all
  // day-granular could never show that a chosen time is now kept and read.
  [
    "Aufgaben/Entwurf an Anke schicken.md",
    TASK("Entwurf an Anke schicken", { status: "Offen", frist: "2026-08-02T12:00" }),
  ],
  [
    "Aufgaben/Bandtrenner im Katalog beschreiben.md",
    TASK("Bandtrenner im Katalog beschreiben", { status: "Erledigt", frist: "2026-08-07" }),
  ],
  [
    "Notizen/Fahrplan.md",
    OKF(
      "Fahrplan",
      "- [ ] Anschluss in Hannover prüfen #reise 📅 2026-08-08\n- [ ] Sitzplatzreservierung\n- [x] Fahrkarte gekauft #reise\n- [ ] Ein Titel, der über eine Zeile hinausgeht, damit die Zeile ihre Breite beweisen kann #offen",
      "Note",
      ["reise"],
    ),
  ],
];

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
    // A due date, so the database's calendar view — and the calendar's overlay
    // (S18b) — have something to place. Without one both surfaces would only
    // ever be photographed empty.
    //
    // It also carries an END (S21b), because a date alone can only ever be a
    // dot: a bar needs two edges, and a surface that draws spans photographed
    // with point dates only would show the empty case and be counted as seen.
    "Projekte/Release 0.7.md",
    `---\ntype: Note\nokf_version: "1.0"\nfaellig: 2026-08-02\nbis: 2026-08-06\nstatus: offen\n---\n\n# Release 0.7\n\nMeilenstein für die nächste Fassung.\n`,
  ],
  [
    // A SECOND dated entry, overlapping the first. One bar proves a bar can be
    // drawn; two overlapping ones prove the rows do not collide — which is the
    // whole reason the timeline gained a row per entry (S21b).
    "Projekte/Store-Freigabe.md",
    `---\ntype: Note\nokf_version: "1.0"\nfaellig: 2026-08-04\nbis: 2026-08-11\nstatus: offen\n---\n\n# Store-Freigabe\n\nEinreichung und Prüfzeit.\n`,
  ],
  [
    // A single-day entry beside the two spans: the shortest bar is the one
    // whose edges are hardest to take hold of, so it belongs in the picture.
    "Projekte/Fehlertag.md",
    `---\ntype: Note\nokf_version: "1.0"\nfaellig: 2026-08-05\nstatus: offen\n---\n\n# Fehlertag\n\nEin Tag für liegengebliebene Befunde.\n`,
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
    // One rule, so the editor can be photographed as itself (S16b). Without it
    // the rules section is an empty state and the capture would show a surface
    // that exists but has nothing to say.
    // The calendar's database selection (S18b). Pre-set so the "show" row is
    // photographed with a view ACTIVE — an unticked row proves the chips render
    // but says nothing about what they do.
    [`mobile-vault-${LOCAL_VAULT}`]: { calendarOverlays: ["Projekte.base#Termine"] },
    [`mailRules_${b64(LOCAL_VAULT)}`]: [
      {
        id: "rule-fixture-1",
        name: "Newsletter einsortieren",
        enabled: true,
        match: "all",
        conditions: [
          { field: "from", op: "contains", value: "newsletter@" },
          { field: "subject", op: "notContains", value: "Rechnung" },
        ],
        actions: [{ kind: "moveTo", mailbox: "Lesen/Newsletter" }],
      },
    ],
    [`cloudAccounts_${LOCAL_VAULT}`]: cloudAccounts,
    // Exactly one credential slot — see the note above.
    [`secret_mail_${b64(LOCAL_VAULT)}_mail-fixture-1`]: { password: "fixture" },
    // NOT the calendar account, deliberately (tried in S5 and reverted): a
    // seeded PIM slot makes the runtime attempt a real token refresh against
    // the provider, so the card turns from "not signed in" into "sign-in
    // expired" carrying a live HTTP error — the capture would then depend on
    // the network. The calendar grid therefore stays unreachable for pictures,
    // and its five views count as UNVERIFIED rather than faked.
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

  // Two appointments on the run's FIXED day, one of them with a title long
  // enough to need a second line. Until round 3 the calendar had an account and
  // no events, so the Today surface's appointment section was only ever
  // photographed EMPTY — and that section was then rebuilt. One timed, one
  // all-day, so both shapes of the row are in the picture.
  const ev = db.prepare(
    "INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, start_date, end_date, all_day, location) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // Milliseconds, and LOCAL midnight — the day window a surface asks for is
  // built with `new Date(y, m, d).getTime()`, so anything else lands outside
  // the day it claims and the section stays empty for a reason nobody sees.
  const midnight = new Date(2026, 7, 2).getTime();
  const h = (n) => midnight + n * 3600_000;
  ev.run("pim-fixture-1", "primary", "fixture-ev-1", "Wochenrückblick", h(9), h(10), null, null, 0, "Küche");
  ev.run(
    "pim-fixture-1",
    "primary",
    "fixture-ev-2",
    "Container-Grammatik mit dem Maintainer durchgehen",
    midnight,
    midnight + 86_400_000,
    "2026-08-02",
    "2026-08-03",
    1,
    null,
  );

  // A FOUR-day trip (S5): a multi-day event is one bar across the days it
  // covers, and a fixture with only single-day events could never show that.
  ev.run(
    "pim-fixture-1", "primary", "fixture-ev-trip", "Konferenz Hamburg",
    new Date(2026, 7, 5).getTime(), new Date(2026, 7, 9).getTime(),
    "2026-08-05", "2026-08-09", 1, "Hamburg",
  );

  // A THIRD appointment, because the preview (S4) says far more about an event
  // than a row does: whether it repeats, who is coming and what they answered.
  // With only the two bare events above, the series chip, the attendee list and
  // the RSVP row could never appear in a picture — and a surface nobody
  // photographs is a surface that quietly rots.
  const rich = db.prepare(
    "INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, all_day, location, description, attendees, series_master, recurrence, rsvps) " +
      "VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
  );
  const attendees = JSON.stringify(["anna@gmail.com", "ben@example.org", "chris@example.org"]);
  const rsvps = JSON.stringify([
    { email: "anna@gmail.com", name: "Anna", status: "accepted", organizer: true, self: true },
    { email: "ben@example.org", name: "Ben", status: "accepted" },
    { email: "chris@example.org", name: "Chris", status: "needsAction" },
  ]);
  // The OCCURRENCE carries no rule — that is exactly why the preview has to
  // fetch the master (`listEvents` filters `recurrence IS NULL`).
  rich.run(
    "pim-fixture-1", "primary", "fixture-ev-3", "Wochenplanung",
    h(14), h(15), "Besprechungsraum", "Was steht diese Woche an?",
    attendees, "fixture-series-1", null, rsvps,
  );
  // The master itself: never a grid row, only the carrier of the rule.
  rich.run(
    "pim-fixture-1", "primary", "fixture-series-1", "Wochenplanung",
    h(14), h(15), "Besprechungsraum", "Was steht diese Woche an?",
    attendees, null, "FREQ=WEEKLY;BYDAY=SU", rsvps,
  );
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
