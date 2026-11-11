# Performance Notes (Measurement Guide)

Last reviewed: 2026-11-10

This document records measurement budgets, fixture methods and structural changes.
The [September large-vault report](Performance_Large_Vault_2026-09-14.md) adds native
Windows cold/warm measurements, repeated vault switches and the directory-scan
contention fix, with debug-build limitations stated alongside the results.

## Budgets (internal planning document, maintainer workspace, §4.3 — release gates)

| Metric | Budget |
|---|---|
| Cold start desktop (until interactive) | < 2 s |
| Vault index, 5.000 files | < 5 s incremental / < 60 s full index |
| Editor keystroke latency | < 16 ms |
| Full-text search (5.000-10.000 notes) | < 200 ms |
| Sync cycle (100 changed files) | < 30 s |
| RAM desktop (idle) | < 200 MB |
| Desktop bundle | < 20-30 MB |
| Encrypted-workspace open reconcile, 5.000 files, nothing changed offline | < 1 s (probe cache: no file reads) |
| Encrypted-workspace passphrase unlock (KDF) | UI stays responsive (KDF off the main thread) |

## Measuring: one command

```
node scripts/measure-performance.mjs                      # 1k + 5k
node scripts/measure-performance.mjs --sizes 1000,5000,20000 --runs 5
```

Generates the vaults, runs the core benchmark over each size twice (unbatched and `--batch`),
refuses to publish if the two runs did not build the same index, and rewrites the block between
the `perf:auto` markers below. It leaves everything else in this file alone, so the earlier
baselines stay comparable. It cannot fill the "Native measurements" table — that needs the
running app.

## Generating test vaults by hand

```powershell
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-1k 1000
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-5k 5000
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-20k 20000
```

Since 2026-11-10 this writes the fixture vault of the performance gates (see "Performance gates" below): deterministic, named by a digest, with realistic note sizes, properties, tasks, links of every kind, attachments and `.base` files. Vaults from the earlier version of the script (one note size, ~5 wiki links each) are not comparable with it.

## Performance gates (performance plan L0, 2026-11-10)

Three commands from the repository root. Two are gates in CI (`.github/workflows/perf.yml`,
jobs "Performance budget (core)" and "Bundle budget"), one is a report (decision E4 of the plan:
browser timings on a shared runner move too much for a verdict).

```
pnpm perf:core               # core measurement, 10 000 notes, against core-baseline.json
pnpm perf:core --update      # record this run as this environment's baseline
pnpm perf:bundle             # build both shells, start bytes against bundle-baseline.json
pnpm perf:bundle --update    # record the builds as the baseline
pnpm perf:browser            # build the desktop bundle, measure in Chromium, write a report
```

**The fixture vault** (`packages/core/scripts/perf/fixtureVault.ts`) is the one every
measurement uses, also `scripts/gen-test-vault.mjs` and `benchmark-large-vault.ts`. It is
deterministic and named by a digest over all paths and bytes; `perf-fixture-vault.test.ts`
pins the digest of the 1 000-note vault, so changing the generator is a decision that voids
every baseline. Shape: one note with 80 tables over about 19 600 lines, 6 % daily notes, the
rest in a PARA-like tree; 60 % short notes (0.3–1.5 KB), 30 % medium, 9 % long, 1 % very long
with tables; 65 % with properties, about 40 % with tasks (dates on half of them), wiki links
with aliases and headings, Markdown links, embeds, callouts, code, 2 % CJK or Thai text;
`count / 40` attachments (images and PDFs), `count / 2000` `.base` files (at least 3).
10 000 notes are 34.7 MB on disk. The core measurement leaves the long table note out
(`longTableNote: false`, 33.1 MB): the Markdown parser needs minutes for that one note (see
"Many tables in one note" below), and it would be the whole cold index instead of one note
in 10 000. The browser report keeps it, it is the editor's case.

**Core gate.** `core-gate.ts` runs `coreBenchmark.ts` on 10 000 notes (disk and `node:sqlite`,
WAL on) and gates six times and one size: cold index, a pass without changes (median of 3),
re-reading one saved note (median and 95th percentile of 40), search with 50 hits (median of
36), `listTasks` (median of 5), and the index size in bytes. A metric fails when it is more
than 25 % worse than the baseline.

Why the baseline is not a number in milliseconds: a GitHub runner is slower and noisier than a
developer's laptop, and a baseline measured on one is wrong on the other. Two measures make the
gate trustworthy on the runner:

1. *Ratios against a calibration loop of the same run.* `calibrate()` runs a fixed piece of the
   same kind of work — Markdown parsing in JavaScript, FTS5 inserts, searches and deletes on a
   SQLite file in the same temp folder — before, between and after the workload; the median of
   the three is the run's calibration. Every time is stored and compared as `time /
   calibration`. A machine twice as slow doubles both, and the ratio stays; a code change moves
   only the time. Sampling three times absorbs a neighbour process that slows the machine for a
   while.
2. *A baseline per environment.* A ratio still drifts between machines (disk, cache sizes, CPU
   generation, Windows against Linux), so `core-baseline.json` keeps one entry per environment —
   `PERF_ENV` (`github-ubuntu-latest` in the workflow), or the platform and CPU model when it is
   not set — and a run is only judged against its own. An environment without an entry gets the
   measurement and a warning, never a verdict: a baseline borrowed from another machine would
   pass or fail at random. To arm the gate on the runner: run the workflow once, take the
   `asBaseline` object from the `perf-core` artifact into `environments["github-ubuntu-latest"]`,
   commit. Record anew when the runner image changes.

The pass without changes is almost all file system (two SQL statements, ten thousand
`stat`s), which the loop does not see: on this machine it moved between 0.5 and 6.7 s for the same
code while other work read the disk. It is divided by a plain walk of the vault folder
(`fsWalkMs`: every folder listed, every entry stat'ed) measured right before each pass instead.

Small times move by more than 25 % for nothing, so a metric fails only when it is also worse
by its floor in absolute terms (2 s cold index, 50 ms warm pass, 2 ms / 3 ms save p50 / p95,
3 ms search, 30 ms `listTasks`). The index size is compared as it is (SQLite writes the same
bytes for the same rows). A changed fixture digest fails the gate with "record the baselines
again". Self-test: the code before L1, measured against the baseline recorded after L1 on the
same machine, fails on the cold index and the save (see the L1 section below).

**Bundle gate.** `scripts/perf/bundle-gate.mjs` builds both shells with source maps into a temp
folder (never their own `dist/`) and reads from each built `index.html` what loads before the
first picture: the entry module, every `modulepreload`, the style sheets. It gates start bytes and
the entry file against `bundle-baseline.json` (growth up to 2 %, which absorbs a dependency's
patch release; a smaller build passes and asks for `--update`, so the next growth is measured
from there), prints the plan's budgets (3.5 MB start, 400 KB phone entry) as notes, and checks
the `mustNotStart` rules: module families that must not be in the start files, read from the
source maps (`packages/core/src/ai/`, `packages/ui/src/ai/`, `packages/core/src/import/adapters/`).
Today all three are in the start files of both shells, so each rule carries `"expected": "fail"`
per shell — reported as a known failure until package L5. The day a family leaves the start
files, the rule fails the gate until its `expected` is flipped to `"pass"`, so a fixed rule is
armed, never silently left loose. The locale file the start waits for is loaded dynamically and
not counted (B2 of the plan names it; L5 splits it). Recorded 2026-11-10: desktop 7.37 MB in 98
start files (entry 88 KB), phone 8.40 MB in 60 (entry 1 079 KB) — more than the review's 7.3 MB,
because this count takes every `modulepreload` and style sheet. Source characters of the
forbidden families in the start files: `packages/ui/src/ai/` about 1.5 MB, `packages/core/src/ai/`
about 1.3 MB, `packages/core/src/import/adapters/` 165 KB, in both shells. Recorded again on 2026-11-11
after `strictExecutionOrder` came with main (stability plan R10): desktop 7.49 MB in 98 files (+0.12 MB),
phone 7.56 MB in 60 files (−0.84 MB from what main brought besides). With that option the module
`index.html` names is a stub of 46 bytes that imports the shell's entry chunk, so the entry file the
gate measures is the start chunk whose source map holds `apps/<shell>/src/main.tsx`: desktop 93 KB,
phone 1 096 KB.

**Browser report.** `apps/desktop/e2e-perf/browser-perf.spec.ts` (config
`playwright.perf.config.ts`, port 1462 or `PERF_PORT`) runs the production bundle in Chromium
with a stand-in for the Tauri side: the 1 000-note fixture in memory (`PERF_BROWSER_COUNT` for
another size) and every SQL statement on a real `node:sqlite` in the test process, so the
index, the search and the editor run their own code on real data. It writes
`apps/desktop/test-results/perf/browser-perf.json`: time from navigation to an editable note on
an empty and on a warm index, typing latency (key event to the frame after it, p50/p95/max of
about 60 keys) in the long table note, cut to its first 8 tables (about 2 000 lines,
`PERF_LONG_SECTIONS` for more), and the time from typing a term into the sidebar search
to its first hit. It fails only when the app cannot do one of these. No IPC, no Rust, no
WebView2/WKWebView: a lower bound, comparable between runs on one machine.

## Full-text rows by row number (performance plan L1, index format 9, 2026-11-10)

`fts_notes.path` is `UNINDEXED`: FTS5 keeps no index on it, so every statement that named a row
by its path read the whole search table and the text in it. Every save, every note of a first
index run, every move and every deletion paid that once or twice. Measured in the review at
10 000 rows: 7.17 ms for one such delete against 0.011 ms by the row number, 64 of the 96 seconds
of a cold index.

Since index format 9 the `files` row of a note names its full-text row (`files.fts_rowid`,
`packages/core/src/db/fullTextRows.ts`): `0` means the row is numbered `-files.rowid` (every row
this build writes; the number is known before the insert, so the insert needs no second statement
and no insert id from a pooled connection), a number above 0 is a row SQLite numbered (a format-8
index's, or an older build's after a downgrade; recorded instead of rewriting the row), and `NULL`
is a `files` row written by a build that does not know the column. Every write reaches the row
through that number: the insert after the file's row is written (`INSERT OR REPLACE`), the delete
by a trigger on `files` (`files_full_text_row_goes`, for this build and an older one alike), a move
keeps the number and only rewrites the path, the rebuild drops every row no file names under its
path.

**The invariant (second review, 2026-11-11):** this build writes only below 0 and keeps a row of its
own at 0 (path `''`, no file has it, readers never show it), so SQLite's own numbering — one above
the largest number, the only one an older build uses — lands above 0 while that row stands, and the
two builds' numbers never share a range. `fts_rowid` records only numbers above 0; a row found at 0,
or below 0 away from its file's `-rowid`, is moved there. The delete trigger takes only the row at
the file's number that is under the file's path, or under a path no file has (its own row while a
queued rename lags): a number an older build gave another note is left alone. "No row outlives its
file" holds together with that condition, and the numbering ends by handing every note left without
a row to the next full pass. The sentinel can go — an older build's rebuild deletes every row whose
path no file has — but that rebuild writes every note again, which raises the flag, and the next
start puts the sentinel back; until then the trigger's path condition and the moves keep the two
builds apart. Two sequences the second review found are tests now: an older build numbering a note
0 after its rebuild (largest number -1), and an older build putting a note's text at the number of
an attachment (files row 1) whose deletion would have taken it.

**Downgrades (first design corrected, 2026-11-10).** The first version numbered rows `-files.rowid`
and took any row at 0 or above as an older build's. That was wrong: SQLite numbers an older
build's insert one above the largest number, and on an index of this build that is still below 0,
so nothing was found, and the next save of the note wrote a second row (find & replace then wrote
the note twice). Now detection does not depend on numbers at all:

| What an older build (v0.8.3 … v0.8.7 and the internal builds) runs on `files` / `fts_notes` | Effect on a format-9 index |
|---|---|
| `INSERT INTO files (…)` (a note read again, an attachment) and `INSERT OR REPLACE INTO files (…)` (its parse-error path) | `fts_rowid` stays `NULL` → trigger `files_written_by_older_index` sets the flag; the next start numbers |
| `INSERT INTO fts_notes (…)` | only right after its `INSERT INTO files` of the same note (the one place it writes a row; its format-5 copy and its migrations never run on a newer index) → flagged with it |
| `DELETE FROM files WHERE id = ? OR path = ?`, `… WHERE path = ?`, `… WHERE path IN (…)`, `… WHERE id IN (…)` (v0.8.3), `DELETE FROM files` (v0.8.3 rebuild) | the delete trigger removes the row by its number |
| `DELETE FROM fts_notes WHERE path = ? / IN (…)`, `… NOT IN (SELECT path FROM files)`, `DELETE FROM fts_notes` | removes rows only: no number changes, no second row |
| `UPDATE files SET path = ? …` (a move, the queued rename, path identity), `UPDATE fts_notes SET path = ? WHERE path = ?` | numbers kept; a search row whose path lags its file's is hidden from readers until the move reaches it |
| `UPDATE files SET mtime_local / sync_state / ctime / is_deleted …` | no effect on numbering |

So every way an older build can leave a row whose number is not its file's, or a second row for a
path, passes through an insert into `files` without the column, and that raises the flag; the
check at a start is one `meta` read. The numbering (`numberFullTextRows`) reads number and path of
every row once — which walks every row's text, since `path` is stored after `content` in the row's
record (about 30 MB at 10 000 notes, 108–140 ms here) — tokenizes nothing but the rows it moves,
keeps per path the row the file names, else the highest
number (an older build deletes a path's rows before it writes, and its insert is numbered above
all others, so the highest is the newest text), records numbers of rows at 0 or above, moves the
few rows an older build numbered below 0 to `-files.rowid` (only those are tokenized again), drops
rows of paths no file has, and clears the flag — one batch. If it fails at any step the vault
still opens: the full-text table is dropped and made anew, every note is handed to the next full
pass, and the failure is recorded in `meta` under `index-diagnostic:fts-numbering` as a count and a date; both shells put it into the diagnostics export ("About & diagnostics") when the vault opens (`readIndexDiagnostics`, `logIndexDiagnostics`), with no path and no text.

**Readers** join by path and number: search and the AI's candidates (`files` by path, then the
number), the `-term` operator (by number), the readers of the whole table (tasks, find in vault,
tags, template keys, "notes containing", card search, mentions) keep only rows a file names
(`FULL_TEXT_ROW_IS_FILED`), point reads (card data, task progress, the source text of a hit, the
mentions of one note) go from the file to its row by number. `findInVault` lists a note once, and
`runVaultReplace` (both shells) plans each note once and computes the replacement from the note
as it is. A task toggle already resolves its line against the current text (`resolveTaskOrdinal`:
ordinal and text, or the task id, must match the fresh note) and never trusted the index row.

SQL used: rowid equality and `rowid IN (…)` (FTS5 answers both from its rowid index), `INSERT OR
REPLACE` with an explicit rowid, two triggers on `files` whose body writes to `fts_notes`, a
`CASE` on `fts_rowid`. Plain SQLite with FTS5; runs on the desktop's SQL plugin and `db_batch`
(sqlx, bundled SQLite), the phone's `@capacitor-community/sqlite`, the web/E2E fixture adapter and
the tests (`node:sqlite`). Tested on node:sqlite only: neither native side was built or run here.
The triggers are created after the index-format migration, because the format-5 copy renames the
table and SQLite refuses a rename while a trigger names a missing table.

Tests: `packages/core/test/fts-rows-by-file.test.ts` — on an index with realistic row numbers (read
three times, smallest `files.rowid` above 10): the rule through indexing, saving, moving, a queued
rename, deleting and rebuilding; a format-8 index numbered without a row written into the search
table and every reader answering as before; v0.8.7's statements word for word after a downgrade
(note saved, new note, parse-error REPLACE, move, delete) — flagged, numbered at the next start with
the newest text, then exactly what a fresh index of the vault answers; which writes raise the flag
and which do not; readers that show each note once while stray rows are still there; reads after a
save, a move and a failed reading on a converted index; a numbering stopped at each of its twelve
statements; the write order inside the scan's units (pinned for the batched scan of `feature/w1-app`:
a note's file delete, file insert and search insert sit in one unit in that order, deletes of gone
files sit in the last unit, nothing names a search row by path). `apps/desktop/src/vaultReplace.test.ts`:
a preview that names a note twice writes it once, correctly.

Measured with `pnpm perf:core` on the 10 000-note fixture (Windows 11, Ryzen AI 9 HX 370,
Node 24.17, `node:sqlite`, WAL), before = app `c192eb2ba`, after = this change, both in one
session against the same baseline:

| | Before (format 8) | After (format 9) | |
|---|---|---|---|
| Cold index, 10 000 notes | 224.6 s | 56.3 s / 56.4 s | ×4.0 faster |
| Re-reading one saved note, median | 42.2 ms | 6.1 ms / 5.5 ms | −36 ms per save |
| … 95th percentile | 48.7 ms | 7.7 ms / 8.8 ms | |
| Pass without changes | 757 ms | 708 ms / 692 ms | unchanged |
| Search, 50 hits, median | 68.8 ms | 74.2 ms / 77.4 ms | unchanged (noise) |
| `listTasks` | 639 ms | 649 ms / 638 ms | unchanged |
| Index database | 101.3 MB | 105.3 MB | +4 % |

The two "after" values are two runs; the gate's ratios stayed within −14 % and +9 % of each
other. Before L1 this fixture costs 22 ms per note in a cold index and 36 ms of every save in the
path delete alone; the review's 96 s on its smaller fixture (1.2 KB notes) has the same cause. The
index grows by 4 %: SQLite stores a negative integer key in 9 bytes, a small positive one in 2–3,
and FTS5 keeps the rowid as the key of its content and docsize tables and at the head of every doclist. The plan expected
"from 96 s to about 30 s"; on this fixture the cold index went from 225 s to 56 s, which is
above the budget of 40 s — what is left is reading, parsing and writing, packages L2 and L3.

With the corrected design (`files.fts_rowid`, triggers, readers joined by number and path), one
run of `pnpm perf:core` after recording the new baseline and one check, on a busier machine:
cold index 50.3 s / 49.5 s, save median 6.5 / 7.0 ms and p95 14.7 / 18.2 ms, search 69 / 64 ms,
`listTasks` 550 / 612 ms (the filter on `files` costs nothing measurable), pass without changes
876 / 907 ms against a plain walk of the folder of 813 / 834 ms — the pass is the walk; the
two SQL statements it runs did not change. Interleaved in one process on 3 000 notes, the save
was 5.95 ms (first design) against 5.73 ms (corrected). Numbering a format-8 index of 10 000 notes
takes 108–140 ms (the whole-table copy of the first design took 1.2 s), a start with nothing to
number 1.1–1.5 ms, the numbering after an older build saved 50 notes 64–83 ms
(`packages/core/scripts/perf/numbering-cost.ts`). 500 cards read by number: 9–15 ms, by path
32–38 ms. Nothing of this runs before the first picture in a way that matters, on either shell.

On main of 2026-11-11 (the scan in short transactions of package L4 merged in): cold index 72.8 s
at a calibration of 879 ms, 23 % above the ratio recorded before, inside the gate's 25 %; save
median 7.0 ms, p95 9.5 ms, search 73 ms, `listTasks` 615 ms, pass without changes 955 ms. The
core baseline was recorded again on that state. Whether the short transactions cost the cold
index that much or the machine was busier is not separated (one run each).

## Budgets of the performance plan (§ 4), measured 2026-11-10

Core numbers from `pnpm perf:core` (10 000-note fixture, this machine, after L1); bundle numbers
from `pnpm perf:bundle`; the browser row from `pnpm perf:browser` (1 000-note fixture, Chromium,
Tauri stand-in — a lower bound).

| Metric | Budget | Measured | Source |
|---|---|---|---|
| Cold index, 10 000 notes (core) | ≤ 40 s | 49.5–56.4 s (224.6 s before L1) | core gate |
| Pass without changes | ≤ 500 ms | 692–907 ms (a plain walk of the folder: 813–834 ms) | core gate |
| Re-reading after a save, p95 | ≤ 15 ms | 7.7–18.2 ms, median 5.5–7.0 ms (48.7 / 42.2 ms before L1) | core gate |
| Full-text search, 50 hits (median of 6 queries) | ≤ 50 ms | 64–77 ms | core gate |
| List every task | ≤ 100 ms (after L8) | 550–649 ms (32 046 tasks) | core gate |
| Start bytes per shell | ≤ 3.5 MB | desktop 7.49 MB (2.33 MB gzip, 98 files), phone 7.56 MB (2.30 MB gzip, 60 files) — on main of 2026-11-11 | bundle gate |
| Phone entry file | ≤ 400 KB | 1 096 KB (desktop entry 93 KB) | bundle gate |
| Typing latency p95, ~20 000 lines with tables | ≤ 16 ms | p95 966.2 ms, p50 57.3 ms, max 1275.6 ms over 59 keys (1963 lines, 8 tables) | browser report |
| Search in the sidebar, typing to first hit (browser) | — | `project` 479 ms, `review meeting` 88 ms, `Müller` 102 ms, `garden` 38 ms | browser report |
| Navigation to an editable note, warm index | ≤ 1.5 s | 2.35 s (tree 1.52 s); first start 6.87 s | browser report |

The plan's "today" column (96 s, 397 ms, 13.7 ms, 21 ms, 469 ms) was measured on the review's
smaller fixture (1.2 KB notes, three tasks each, one search term); this fixture is about twice as
large per note and searches six terms, two of them a prefix and a CJK word. Over budget after L1:
the cold index (L2, L3); the pass without changes, which is the walk of the folder (L3 lists
in Rust on the desktop; the core measurement walks from Node); search, which is not the
reading of rows (point reads go by number now) but FTS5 matching, ranking and snippets of
long notes — carried by `garden*` and the CJK term (L11 shrinks the table); `listTasks` (L8).
The p95 of a save moved between 7.7 and 18.2 ms on a busy machine; the median stays near 6 ms.
The browser rows were taken before the corrected design.

### Many tables in one note (new finding, 2026-11-10)

The fixture's long note (80 tables of 200 rows, 19 600 lines, 1.7 MB) took most of a
462-second cold index of the 1 000-note fixture. The time is in the Markdown parser's GFM tables
(`micromark-extension-gfm-table` 2.1.1 under `parseMarkdownAst` and `parseMarkdownTree`), and it
grows with the square of the number of tables, not with the text: 20 tables of 50 rows parse in
0.3 s, 40 in 1.2–4.4 s, 80 in 39 s (single runs on a loaded machine); one table of 4 000 rows in 0.2 s; the same text as CommonMark
in 20 ms. The indexer, the reading view and every other reader of the tree pay it. Not part of
L0/L1; the core gate leaves that note out until it is fixed (`longTableNote: false`). Even
without many tables it is not linear: 20 tables of 20 rows among 2 100 lines parse in 0.45 s, 40
tables in 2 600 lines in 1.1 s, and 10 tables of 1 800 rows took longer than 170 s. In the browser report the full 19 600-line note did not answer a single key for ten minutes;
whether the editor's table decorations (B7, package L6) or the re-index after the save (this
parser) held the page is not separated yet — a save re-reads the note on the main thread, so
this parser alone is minutes per save for such a note. Worth settling before 0.9.0, next to L6. Where the time goes (profiled 2026-11-10): in the micromark tokenizer's GFM table
extension, `EditMap.add` (`micromark-extension-gfm-table/lib/edit-map.js`, `addImplementation`)
looks for an existing edit at the same index by walking the whole list of edits, and the table
resolver adds one edit per cell boundary — quadratic in the cells of a document. 2.9 of 3.0 s of
`fromMarkdown` on one table of 6 400 rows are in that function; micromark without the extension
reads the same text in 35 ms, and the mdast step adds almost nothing. Smallest showing input: one
two-column table, 400 / 1 600 / 6 400 rows → 18 / 125 / 3 023 ms. The installed 2.1.1 is the
package's current release as far as the installed files show (no changelog ships with it); an
upstream issue was not looked up (no network in the measuring session).

## Measurement points

1. **Initial index**: open the vault for the first time; time until the loading bar disappears (console: `[VaultContext] ...` timestamps). Expectation for 5k: under 60 s (budget), target well below that.
2. **Watcher tick after save**: change a large note, save it; the console now shows `vault watcher detected changes [path]` followed by the incremental update — NO full reindex progress should run anymore.
3. **No-op sync tick**: WebDAV vault, 15 s tick with an unchanged remote; observe DevTools network/IPC activity. Expectation: 1 `sync_state` query instead of one per file.
4. **File switch with the right sidebar open** (context graph + backlinks open): time until both sections have settled. A second switch to the same/another file without an edit = graph cache hit.
5. **Base with 2.000 rows**: opening + scrolling + saving a note OUTSIDE the source (must no longer reload the base, provided there are no tag sources/relations).
6. **Search**: typing in the sidebar with 5k notes; results < 200 ms (FTS with LIMIT 50).

## Structural changes from the P2 sprint (2026-07-05)

- **Indexes**: `links(source_id)`, `properties(file_id)` (eliminates CASCADE full scans on every save), `files(title COLLATE NOCASE)` (title prefix matches and sorting by title without a table scan; it was made for the wiki-link lookup, which left SQL on 2026-10-09 — see "One rule for where a link leads" below).
- **Indexer bulk pass**: 3 upfront SELECTs per file replaced with 3 queries per RUN; links/tags/properties as multi-row INSERTs (chunk size 150); deletions as IN batches. Order of magnitude for a 10k vault: from ~150-400k down to ~40-80k IPC roundtrips; the Rust bulk command (a real transaction) is now delivered and wired for the cold full-scan — see "Cold-index bulk batch" below.
- **Incremental watcher**: event paths are indexed individually (`VaultIndexer.indexPath`); folder cases and floods (>50 paths) fall back to a full scan. Pure echoes (unchanged mtime) no longer trigger a re-render. Since issue #122 a folder that was merely reported as modified no longer counts as a folder case, the full scan walks natively and reloads only what it changed — what still escalates, and the measurements, are in `Vault_Watcher_and_Indexing.md`.
- **Sync tick**: `SyncStateRepository.getAllStates()` loads the state once per cycle (previously 1 SELECT per remote file every 15 s); `base_text` is deliberately left out (a conflict case loads it specifically).
- **Link resolver corpus index**: `buildLinkTargetIndex` + `resolveLinkTargetIndexed` make graph load, backlinks, and reverse columns O(links) instead of O(links × files). (Follow-up 2026-07-06: `GraphService.loadGraph` initially did NOT use the index — it still did a single-shot resolve per link row; since the follow-up package, loadGraph builds the index once per run, and likewise `convertWikilinksToMarkdownLinks` once per document.)
- **One rule for where a link leads** (2026-10-09, ADR 0027): a click on a wiki link reads the link corpus once (`VaultQueryService.linkTargets()`: path, title and mode of every indexed file) and resolves in JavaScript, where it used to run one indexed point query. SQLite cannot fold case beyond ASCII or compare normalization forms, so a rule in SQL could never agree with the graph's. Cost: one query whose result grows with the vault (roughly 100 bytes per file) plus a lookup build, per click — not per link; the questions of one turn share a read (`linkLookup`), so a note full of embeds reads once, and the read begins only after they have all asked, so no answer is older than its question. Nothing is cached beyond that — a stale "no such note" is how a click creates a second note —, so whoever resolves MANY links, or one link while typing, holds the lookup itself: the graph and the backlinks per load, the editor per index version (`useWikiResolver` on the desktop, ONE lookup per titles map for every pane, embed and database view; one `getDocumentTitles()` per mounted editor on the phone), a database's chips, sub-items and timeline per index version, the phone's base screen once per load of its rows (sub-items, sixty gallery covers), the heading completion after `[[Note#` for a few seconds per note name. The lookup keeps both readings of every path (`LinkIndexEntry`): a vault with an `index.md` in each of a few thousand folders asks about all of them for every link that names one, and folding a path per question was the cost of the whole graph. Link texts for a list of picks count the vault's names once (`wikiTargetChooser`). The backlinks keep their SQL pre-filter on the link table, anchored at the end of the target and spelled every way the rule reads as one name (`likeAnySpelling`: `_` for a letter beyond ASCII that has a second case, so a Cyrillic or Greek name asks for its own length, not for every row). The phone no longer walks the directory tree for a tap; it does so only when the index finds nothing. Not measured on a large vault yet.
- **A Markdown link asks the same lookup** (2026-10-12, ADR 0027 addendum): a click on `[text](target)` used to ask the disk — one `exists` on the desktop, up to six on the phone. It reads the link corpus now, like a wiki link, and asks the disk only where the index knows nothing: at most four paths, each an `exists` and a file-info call, so a folder is not taken for a file. The folders of the vault are derived from the lookup on the first question about a folder (`foldersOf`, kept with the lookup in a `WeakMap`): one pass over the files, one name fold per distinct folder — the graph pays it once per load and only if a note links a folder. "Remove text links" parses the note where it scanned the file; a note without `]]` and `](` is not parsed at all, which keeps a long run of openers linear (`linearLinkScans`). Index format 7 queues only the notes that hold a Markdown link with an anchor for re-reading.
- **Graph cache**: `services/graphCache.ts` caches the resolved graph per index version — file switches without an edit are cache hits (context section + vault map).
- **Base refresh scope**: saves outside the source folders of an open base (without tag sources/relations) skip its re-query (`baseRefreshScope.ts`).
- **Structure vs. file refresh**: `treeStructureVersion` — the recursive disk listing of the tree (empty folders) now only runs on folder-relevant changes, no longer on every save.
- **Bundle**: locale JSONs (~580 KB, 10 languages) load lazily (active language + en fallback at startup); Settings/VersionHistory/DeletedFiles/OKF modals/image viewer/shortcuts as their own lazy chunks. (Follow-up 2026-07-06: `BaseCreateWizard` also loads lazily.)
- **Editor mirror**: documents > 512 KB mirror the React `content` state every 2 s instead of every 150 ms (`doc.toString()` allocations). Deliberate deviation from the plan wording "metadata only": the full text is still mirrored, just less often.
- **TreeNodeView memoized** (follow-up 2026-07-06, P2.12): `React.memo` + identity-stable handlers (`lib/useStableHandler.ts`) — context menu/session state renders of the FileTree no longer run through every visible tree row.

## Harness baseline — core paths on node:sqlite (2026-07-11, hardening P1)

Measured with the rebuilt `packages/core/scripts/benchmark.ts` (the previous
better-sqlite3 version could not even install under pnpm 10 and had silently
become dead code). Median over 5 runs (3 for the heavy profiles), local SSD,
Node without any Tauri IPC — so these are LOWER bounds for the native app:
they cover the indexer, FTS and merge logic, **not** IPC, the SQL plugin,
WebView rendering, watcher behavior or network vaults (the in-app perf panel
under "About & diagnostics" covers those on real installs).

| Measurement | 1k small | 5k small | 5k linked | 5k large | 20k small |
|---|---|---|---|---|---|
| Full index (cold) | 3.4 s | 20.7 s | 40.0 s | 903 s | 151 s |
| Full index (warm, no changes) | 46 ms | 265 ms | 303 ms | 343 ms | 984 ms |
| Incremental (1 changed file) | 9 ms | 13 ms | 16 ms | 346 ms | 17 ms |
| FTS search (worst of 3 terms) | 1.9 ms | 8.8 ms | 2.2 ms | 644 ms | 36 ms |

Readings: warm starts, incremental indexing and search stay FAR inside their
budgets at every realistic profile — the warm-index work (fix D) and the FTS
design carry (20k warm start is under 1 s). The COLD full index is the hot
spot, and the heavy profiles settle the open question: **20k breaches the
60 s budget outright (151 s), which made the Rust bulk-insert command (a real
SQL transaction instead of the JS mutex) a hard requirement — now DELIVERED as
`db_batch` and wired for the cold full-scan (see "Cold-index bulk batch"
below); re-measure 20k natively to confirm it drops under budget.** The `large`
profile (5k deliberately huge notes) is an
extreme stress case, not a realistic vault: cold indexing balloons to ~15 min
(FTS insert cost scales with content bytes), a single changed huge file costs
~350 ms to re-index (async after save — acceptable), and the PHRASE search
"quick brown" hits 644 ms (term searches stay ≤5 ms). If real vaults with
many megabyte-sized notes show up, phrase-search cost and per-file FTS
chunking join the bulk-insert follow-up. JSON outputs live in the maintainer
workspace scratchpad; re-run via
`pnpm --filter @plainva/core run benchmark -- --files 20000 --runs 3`.

## Cold-index bulk batch (B3, 2026-07-15)

The cold full-scan (`VaultIndexer.indexVaultFull`) used to issue one `execute()`
per row — one IPC hop, one pooled-connection checkout, one auto-commit each —
which is what put the 20k cold index at 151 s. Its writes (files/fts/links/tags/
properties rows plus the new-file sync_state upsert) now go through a recording
sink and are flushed as ONE atomic transaction per bounded chunk via the native
`db_batch` command (`src-tauri/src/db_batch.rs`): a single connection runs an
ordered statement batch with BEGIN/COMMIT and ROLLBACK on any error, using the
`sqlx` that `tauri-plugin-sql` already links (no second SQLite). This gives both
atomicity (a crash mid-scan rolls the chunk back) and far fewer IPC hops.

Verified in the harness: `cargo test --lib db_batch` (commit/rollback atomicity,
FK cascade inside the batch, param types, 1000-row bulk) and a TS
statement-equivalence test (`vault-indexer-batch.test.ts`) proving the batch
carries EXACTLY the same writes, in the same order, as the per-statement path —
so only delivery changes, not content. Adapters without `runBatch` (tests,
non-Tauri) fall back to per-statement writes via `runStatementsAtomic`.

Native follow-up (needs the built app — not runnable in the harness):
- **Re-measure the 20k cold index** and fill the table below; confirm it drops
  under the 60 s budget. If a second connection to the same WAL file shows lock
  contention under a real cold index, tune `busy_timeout` / the flush chunk size
  (`FLUSH_AT` in `indexVaultFull`).
- **SyncQueue atomicity is still open.** The 6 `SyncQueue` transactions read
  mid-transaction and branch in JS (e.g. `markSynced` deletes then reads), so a
  pure write batch cannot express them — they stay on the JS mutex. Making them
  truly atomic needs a pinned cross-invoke transaction handle (begin/exec/query/
  commit on ONE held connection), a larger, separate native change.

## Encrypted workspace open reconcile (Security & Sharing package A, 2026-07-23)

`initializePersonalWorkspaceMigration` runs on every open of an
Encrypted-Workspace vault. It used to full-read + SHA-256 **every** file
sequentially on each open (O(vault size), warm or cold). Package A:

- **mtime probe cache (A1)**: a local-only `workspace_local_probe` table
  (`path, mtime, size, plaintext_sha256`) lets an unchanged file skip the read
  entirely — same treatment as `VaultIndexer.indexVaultFull`'s mtime map. Files
  with mtime 0 (some network mounts) still fall back to hashing. Per-run bulk
  lookups (`listObjects`, `listQueuedPaths`, `listLocalProbes`) replace the
  per-file `getObjectByPath`/`hasPendingForPath` round-trips.
- **background reconcile (A2)**: on a warm index the notes are already on screen
  (they come from the SQLite index), so the sweep + worker start run in the
  background; a cold open still blocks with a determinate splash bar
  (`workspaceSecurity.reconcileProgress`).
- **no double sweep (A3, effective)**: `unlock`/`activate`/`lock` still rebuild
  the adapter stack via `openVault()` (the stacks differ per state), but the
  reconcile that reload triggers is now free of re-reads (probe cache) and runs
  in the background (A2), so the "unlock pays the sweep twice" cost is gone.
- **KDF off the main thread (A4)**: `deriveKekOffThread` runs scrypt in a Web
  Worker (`kdf.worker.ts`); a passphrase unlock no longer freezes the WebView.
  Only the passphrase-fallback path derives a key on open — a native OS keychain
  derives nothing.

Telemetry marker: `perfMeasure("encrypted workspace reconcile (open)")` (visible
in Settings → About & Diagnostics → performance metrics). Fill the native table
below with real numbers on the maintainer sighting.

## Icon catalogue bundle cost (findings round P4.1, 2026-07-30)

The curated `lucide:` catalogue grew from 165 to **400** entries (decision E2 — not
all ~1,750). The path data is a string literal per icon, so it rides in the
bundle; the plan estimated 40-60 KB and this is the measured figure.

Both numbers are clean `vite build` runs of `apps/desktop`, summing every chunk
that carries the catalogue (found by grepping for a known icon id):

| Catalogue | Chunks raw | Chunks gzip |
|---|---|---|
| 165 entries (before) | 987,999 B | 307,728 B |
| 400 entries (after) | 1,060,432 B | 324,973 B |
| **Delta** | **+72,433 B (~71 KB)** | **+17,245 B (~17 KB)** |

So ~71 KB uncompressed for 235 additional icons, ~180 B gzip each — above the
planned range on the raw figure, comfortably inside it after compression. The
catalogue is imported by the picker and by the document-icon renderer, i.e. it
is in the main chunk, not lazy: every start pays it. Worth revisiting only if the
set grows again — the lever would be lazy-loading the path data per category
(the entries already carry one), not trimming the curation.

<!-- perf:auto-start -->
<!-- Generated by scripts/measure-performance.mjs — do not hand-edit; re-run the script. -->

### Harness measurement, 2026-08-14

Node v24.17.0 · linux 7.0.11-76070011-generic · 13th Gen Intel(R) Core(TM) i9-13905H · median of 3 runs

| Notes | Cold index | Cold index (batched) | Batch gain | Warm pass | Incremental | Search (worst of 3) |
|---|---|---|---|---|---|---|
| 1000 | 1.9 s | 1.9 s | 2 % | 14 ms | 21 ms | 1 ms |
| 5000 | 7.0 s | 7.2 s | -2 % | 70 ms | 23 ms | 6 ms |

Index shape checked identical between the batched and unbatched run of each size
(files, fts_notes, links, tags, properties) — without that, the two timings would not be
comparable.

**Batch gain is a floor, not the native number.** `--batch` gives the indexer the
chunk-flushing path the desktop takes through `db_batch`, but there is no Tauri IPC here, so
what this column shows is the SQLite-side share alone. Natively the saved round trips come on
top; that is the measurement DoD 5 is still waiting for, and it needs the running app.

On this run that share came out **within noise** (2 %, -2 %), which is half an answer in itself: batching buys almost nothing when there
is no IPC to save. Whatever `db_batch` is worth natively, it is worth it for the round trips —
so the native number cannot be inferred from these, only bounded below by zero.

**Not covered here at all:** Tauri IPC, the SQL plugin, WebView rendering, the file watcher,
network vaults, React. See "Native measurements" below.
<!-- perf:auto-end -->

## Native measurements (maintainer, to be added)

| Measurement point | 1k | 5k | 20k | Date/Build |
|---|---|---|---|---|
| Initial index | | | | |
| Watcher tick after save | | | | |
| No-op sync tick | | | | |
| File switch (sidebar open) | | | | |
| Search (typing -> result) | | | | |
| Encrypted-workspace open reconcile (warm, unchanged) | | | | |
| Encrypted-workspace passphrase unlock (KDF) | | | | |

Open follow-up candidates after measurement: SyncQueue pinned-transaction atomicity (see "Cold-index bulk batch" — the cold index's bulk batch is delivered; the read-interleaved queue ops still ride the JS mutex), base view virtualization (from ~1-2k rows), graph layout chunking/worker (>2-3k visible nodes), FTS contentless (index DB size).

## Mobile baseline (M3E package A10, 2026-07-12)

Measured on the headless Pixel_10_Pro emulator (swiftshader software GPU —
expect real devices to be substantially faster) against the generated 1k
vault (1000 notes, 32 folders, 5 .base files; `scripts/gen-test-vault.mjs`):

| Metric | Value | Notes |
|---|---|---|
| Cold app start (empty index DB) | Activity in 2.9 s | UI NOT blocked — the P5 warm-boot path shows the tree while indexing runs |
| Cold full index (background) | ~69 s | DB growth watched until stable; final index DB 7.8 MB |
| Warm app start (index present) | Activity in 2.4 s | index DB mtime unchanged → no re-index on boot |

Reading: the architecture behaves as designed (no boot block, warm boots skip
indexing). The absolute cold-index number is emulator-bound; a real-device
pass belongs to the maintainer sighting list. The desktop's Rust bulk-insert
follow-up would shrink the cold pass on mobile too once the shared indexer
gains a batched write path.

### Large-vault follow-up (M3E N5, 2026-07-13)

The parity plan flagged that the promised large-vault measurement (pull
duration / memory / editor-open at the ~600-note scale) had never been
recorded. Measured on the same headless emulator against the 1k vault (1000
notes — larger than the 600 the plan named, so a conservative upper bound):

| Metric | Value | Notes |
|---|---|---|
| Cold Activity start (`am start -W`, warm index) | 3.4–4.1 s (2 runs) | Activity-to-first-frame; index already present, no re-index |
| Process memory after boot + full index | PSS ≈ 157 MB, RSS ≈ 300 MB | `dumpsys meminfo`; the SQLite index + WebView dominate |
| Editor open (large note, live preview) | no perceptible delay | shared CodeMirror session mounts from the load-time snapshot; qualitative — screenshot cadence is too coarse for a hard number |

Not measurable on the emulator, deferred to the device gate (needs a
configured cloud vault): **first-sync pull duration** over a real WebDAV/Drive
connection — the local sandbox vault has no remote to pull from. The device
sighting in `Mobile_Release_Gate.md` covers it.

Reading: memory sits in the normal range for a WebView + SQLite app of this
size; nothing here changes the release posture. The cold-index time remains the
one hotspot, emulator-bound and shared with the desktop (Rust bulk-insert
follow-up).

## IMAP session reuse (findings round P7.2, 2026-07-30)

Every mail command used to open its own connection — TCP handshake, TLS
handshake, `LOGIN`, work, `LOGOUT` — and `mail_imap.rs` said so in its own
header ("opens a fresh connection … pooling is a later optimization"). Opening a
folder and reading three messages therefore paid **four full logins**, on top of
the per-command round trips. On a remote mailbox the handshakes, not the fetches,
dominated the wait; a burst of actions also produced enough consecutive logins
for a server to start throttling.

`mail_pool.rs` now keeps at most **one idle session per account**, and all 13
command bodies go through `with_session` / `with_writable`. The policy is
deliberately conservative, because a stale or half-consumed IMAP connection is
worse than a slow one:

| Rule | Why |
|---|---|
| `NOOP` before every reuse | servers close idle connections without saying so; the failure has to land on a cheap probe, not mid-`FETCH` |
| any command error retires the session | a failed command may leave unread server output in the socket, so the next command would read the wrong reply |
| idle expiry (2 min) | past that the connection is probably gone anyway, and probing costs a round trip |
| exclusive while in use | two overlapping commands never share one connection; the second opens its own, only one is kept afterwards |
| explicit release on account switch / leaving mail | a logged-in session must not outlive its reason to exist (`mail_release_sessions`) |
| key includes a password fingerprint | a rotated password must not reuse a session logged in with the old one; the password itself never lands in a key |

Effect on the common paths (logins, not seconds — the saved wall-clock is one
TCP + TLS + LOGIN per avoided handshake, which is the dominant term on a remote
server):

| Action sequence | Logins before | Logins now |
|---|---|---|
| Open folder, read 3 messages | 4 | 1 |
| Read, mark seen, move to another folder | 3 | 1 |
| Five actions in one mailbox (the plan's acceptance case) | 5 | 1 |

Verified by policy tests over a fake session (`mail_pool::tests`, 9 cases:
reuse, expiry, error → fresh session, unhealthy → replaced, per-account
isolation, overlap, release by account, rotated password). One of them caught a
real bug in the release path: `drain_matching` matched a key **prefix**, but the
account sits between the port and the password fingerprint, so releasing an
account would have silently released nothing. It matches the delimited `:user#`
fragment now — which also cannot confuse "ada" with "nada".

Not done here: IMAP `IDLE` push (still absent), and the TypeScript side of the
same problem on mobile — `socketTransport.ts` opens a connection per operation
(`withConn`). That is P7.3.

### The same policy on the phone (P7.3, 2026-07-30)

`socketTransport.withConn` opened and closed a connection per operation, and its
own comment said so ("Every operation opens a fresh connection … the same
contract the desktop's Rust side has always had"). That sentence was true when it
was written and stopped being true with P7.2, so the phone was the slow platform
— on mobile latency a login per action is the most expensive thing mail does.

`net/sessionPool.ts` is the TypeScript twin of `mail_pool.rs`: same five rules,
same key shape (host:port:user + password fingerprint), same per-call `open`
argument. The nine policy cases exist on both sides
(`apps/mobile/src/services/mail/sessionPool.test.ts` mirrors `mail_pool::tests`)
— kept side by side deliberately: if one platform's policy drifts, the other's
suite stops describing it.

Two things are phone-specific:

- **Background release.** `appStateChange(isActive: false)` releases every
  pooled session. The OS suspends the sockets; a resumed connection is dead
  without saying so, and reusing it would hang the next action instead of
  failing fast. This is the one rule that does not exist on the desktop.
- **Preload.** After the envelope list arrives, the newest message's body is
  warmed into the cache over the connection that just served the list — one
  message, only when it is not cached yet, silent on failure. Combined with the
  P7.1 cache-first read, opening the top of the inbox costs no roundtrip at all.

An existing test pinned the OLD contract ("closes the connection again after
every operation") and failed honestly. It now states the new one: the connection
is kept, probed with `NOOP` before reuse, and closed on release — which is what
had to stay true. **Red counter-proof run**: with `withConn` back to
open-per-operation, the reuse assertion fails.
