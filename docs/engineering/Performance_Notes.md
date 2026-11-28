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
browser timings on a shared runner move too much for a verdict). Since 2026-11-26 both gates are
required checks for `main` (maintainer's decision): a gate that turns red without a code change
holds up every landing, so how the core gate stays steady on the runner is measured below
("The core gate on the runner, 2026-11-26").

```
pnpm perf:core               # core measurement, 10 000 notes, against core-baseline.json
pnpm perf:core --update      # record this run as this environment's baseline (a machine of one's own)
pnpm perf:core --from-runs github-ubuntu-latest a.json b.json …
                             # the runner's baseline: the median of many runs' perf-core artifacts
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
(`longTableNote: false`, 33.1 MB): until 2026-11-11 the Markdown parser needed minutes for
that one note (see "Many tables in one note" below), and the recorded baselines were measured
without it. The browser report keeps it, it is the editor's case.

**Core gate.** `core-gate.ts` runs `coreBenchmark.ts` on 10 000 notes (disk and `node:sqlite`,
WAL on) and gates six times and one size: cold index (once), and in seven rounds a pass without
changes (median of 3), re-reading one saved note (median and 95th percentile of 60), search with
50 hits (each of six queries' fastest of 8 rounds after a warm-up round, then the median of the
six) and `listTasks` (the fastest of 9 after a warm-up call); and the index size in bytes. The
two short SQL-bound metrics take the fastest repetition because the slower ones carry the
neighbours of a shared runner. A metric fails when it is worse than the baseline by more than its
tolerance — 25 %, the save's median 15 %, the save's 95th percentile 50 % (`TOLERANCE_OF`, from
the measurement below) — and by more than its floor in milliseconds.

Why the baseline is not a number in milliseconds: a GitHub runner is slower and noisier than a
developer's laptop, and a baseline measured on one is wrong on the other. Three measures make the
gate trustworthy on the runner:

1. *Ratios against a calibration loop, round by round.* `calibrate()` runs a fixed piece of the
   same kind of work — Markdown parsing in JavaScript, FTS5 inserts, searches and deletes on a
   SQLite file in the same temp folder — before the cold index, at the start of each round and
   at the end. A metric of a round is read against the calibration of its own round, and the
   run's ratio is the median of its seven rounds (`runRatio`); the cold index against the median
   of all calibrations. A machine twice as slow doubles both, and the ratio stays; a code change
   moves only the time; a neighbour that slows the runner for a round or two is outvoted.
2. *A baseline per environment.* A ratio still drifts between machines (disk, cache sizes,
   Windows against Linux), so `core-baseline.json` keeps one entry per environment — `PERF_ENV`
   (`github-ubuntu-latest` in the workflow), or the platform and CPU model when it is not set —
   and a run is only judged against its own. An environment without an entry gets the
   measurement and a `::warning::`, never a verdict: a baseline borrowed from another machine
   would pass or fail at random. The runner label hands out several CPU models; until
   2026-11-26 each model had an entry of its own, recorded from a single run, and a model
   without one got no verdict (see below for why that ended). Record anew when the runner image
   changes. The entry of the Windows laptop was recorded in the older way (one calibration per
   run, 40 saves) and is to be recorded anew before it is relied on.
3. *A baseline of many runs.* `--from-runs` makes each ratio the median of the ratios of many
   runs of the same code (`medianBaseline`, at least ten), and records how many there were and
   the lowest and highest of each ratio as a share of the median (`runs`, `spread`). A baseline
   from one run carries that run's luck into every verdict after it.

The pass without changes is almost all file system (two SQL statements, ten thousand
`stat`s), which the loop does not see: on this machine it moved between 0.5 and 6.7 s for the same
code while other work read the disk. It is divided by a plain walk of the vault folder
(`fsWalkMs`: every folder listed, every entry stat'ed) measured right before each pass instead.

Small times move by more than their tolerance for nothing, so a metric fails only when it is also
worse by its floor in absolute terms (2 s cold index, 50 ms warm pass, 0.5 ms / 3 ms save p50 /
p95, 3 ms search, 30 ms `listTasks`), reckoned from the same ratios the verdict compares. The
index size is compared as it is (SQLite writes the same bytes for the same rows). A changed
fixture digest fails the gate with "record the baselines again". Self-test: the code before L1,
measured against the baseline recorded after L1 on the same machine, fails on the cold index and
the save (see the L1 section below).

**The core gate on the runner, 2026-11-26.** On B2's branch the gate failed once on
`saveP95Ms` (×1.71) and passed on the rerun (×1.03), for a branch that does not touch
`VaultIndexer.indexPath`. Measured on unchanged `main` (`995a92905`), twelve runs of the
workflow by `workflow_dispatch`, the gate as it was:

| | judged | red | spread of the ratio against the baseline of its CPU |
|---|---|---|---|
| runs | 7 of 12 (5 on CPU models without a baseline: EPYC 7763, Xeon 6975P) | 2 of 7 | |
| `saveP95Ms` | | ×1.99 once | ×0.68–1.99 (5.2–13.2 ms) |
| `warmIndexMs` | | ×1.26 once | ×1.06–1.26 |
| `saveP50Ms`, cold, search | | | ×0.84–0.99, ×0.80–1.00, ×0.73–0.91 |

Sixty earlier runs (24.–26.11., mixed branches) agree: the save's 95th percentile — the third
slowest of 40 saves — spread from 3.0 to 10.0 ms on one CPU model, and the most common model on
the runner (EPYC 7763, 21 of 60 runs) never had a baseline. Two causes: one sample of a noisy
metric per run, and a baseline that is one run's luck.

The gate as it is now (rounds, median baseline, per-metric tolerance), ten runs of unchanged
code (`b8a8f00e2`) on four CPU models (EPYC 7763, 9V45, 9V74, Xeon 6975P), each ratio as a share
of the median of the ten:

| metric | spread, unchanged | tolerance |
|---|---|---|
| `coldIndexMs` | 0.90–1.14 | 1.25 |
| `warmIndexMs` | 0.92–1.17 | 1.25 |
| `saveP50Ms` | 0.92–1.07 | 1.15 |
| `saveP95Ms` | 0.92–1.38 | 1.50 |
| `searchMs` | 0.87–1.08 | 1.25 |
| `listTasksMs` | 0.87–1.06 | 1.25 |

Read against the calibration of their own round, the four CPU models lie within these spreads
of one median, so the runner label is one environment again and no run goes without a verdict.
A save made 30 % slower on purpose (a spin of 0.3 × its own time in `indexPath`, ten runs of
`479fe39bf`, never landed) came out at ×1.17–1.46 on the save's median: every one of them over
1.15, every unchanged run at most 1.07. The 95th percentile does not tell the two apart (×1.06–1.45
slowed against ×0.92–1.38 unchanged); it stays a gate for a save that grows a long tail, at 50 %.
Out of the sample the baseline was made of, twenty fresh runs of the gate itself (`dcbe602d9`,
and the same slowdown on it, `4c1fed993`): unchanged code green in ten of ten (save median
×0.88–1.08, 95th percentile ×0.84–1.23, every other metric within ×0.84–1.11), the slowed save
red in ten of ten (save median ×1.18–1.42). The gate's job in CI is a single run, no retry: a
real slowdown is red every time, not in half of the runs.

**Bundle gate.** `scripts/perf/bundle-gate.mjs` builds both shells with source maps into a temp
folder (never their own `dist/`) and reads from each built `index.html` what loads before the
first picture: the entry module, every `modulepreload`, the style sheets. It gates start bytes and
the entry file against `bundle-baseline.json` (growth up to 2 %, which absorbs a dependency's
patch release; a smaller build passes and asks for `--update`, so the next growth is measured
from there), prints the plan's budgets (3.5 MB start, 400 KB phone entry) as notes, and checks
the `mustNotStart` rules: module families that must not be in the start files, read from the
source maps (`packages/core/src/ai/`, `packages/ui/src/ai/`, `packages/core/src/import/adapters/`).
Since package L5 (2026-11-25) none of the three is in the start files of either shell, and each
rule carries `"expected": "pass"` per shell: the gate fails the day one of them is back. A rule
still to be met would say `"fail"` and be reported as a known failure until it is flipped, so a
fixed rule is armed, never silently left loose (see "Start bundle (L5)" below). The locale file the start waits for is loaded dynamically and
not counted (B2 of the plan names it). Recorded 2026-11-10: desktop 7.37 MB in 98
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
keeps per path the row the file names and never guesses: a path whose file names none of its
rows keeps none, and the note goes to the next full pass, which writes its current text ("the
highest number is the newest text" is false — this build's rows are negative and get more
negative, an older build's are positive, and the delete trigger leaves a row on purpose when its
path now belongs to another file, so a row under a path can be another note's text at any
number). The one exception is the first start of format 9: a format-8 index names no row, and it
kept one row per path, so a path with exactly one row adopts it (where that row is another note's,
a queued rename set the note's `mtime_local` to 0 and the next pass replaces the row by number); a
path with two rows adopts none. A file an older build wrote names nothing, so after a flagged
start exactly the notes it wrote are read again. The numbering records numbers of rows at 0 or
above, moves the few rows of the first start an older build numbered at or below 0 to
`-files.rowid` (only those are tokenized again), drops rows of paths no file has, and clears the
flag — one batch. If it fails at any step the vault
still opens: the full-text table is dropped and made anew, every note is handed to the next full
pass, and the failure is recorded in `meta` under `index-diagnostic:fts-numbering` as a count and a date; both shells put it into the diagnostics export ("About & diagnostics") when the vault opens (`readIndexDiagnostics`, `logIndexDiagnostics`), with no path and no text.

Closed at the cause since stability plan R1: on the desktop `transaction()` used to be a turn, not
a transaction, so a kill between a note's `INSERT INTO files` and its search row left a note with a
current `mtime_local` and no row, unsearchable until it was edited (also in v0.8.7, which can still
leave such a note behind on a shared index). The desktop's transactions are real now
(`src-tauri/src/db_tx.rs`); a kill leaves neither row, and the next pass reads the note as new
(`apps/desktop/src/adapters/TauriDatabaseAdapter.test.ts`). A sweep at every start was not taken:
it would cost 60 ms (by number) to 80 ms (by number and path) at 10 000 notes on a reopened index
here (`scripts/perf/numbering-cost.ts`, `sweepByNumberMs`, `sweepByNumberAndPathMs`).

Orphan rows — a row the delete trigger kept because its path belongs to another file now — are
harmless to readers, which all join on number and path, and only `rebuildIndex` (or a flagged
start, which drops every row a file does not name) removes them; "no row outlives its file" holds
for rows under their own path, by the trigger's path condition.

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
(note saved, new note, parse-error REPLACE, move, delete) — flagged, at the next start the notes
it wrote handed to the next pass, then exactly what a fresh index of the vault answers; the third
review's sequence (a positive-numbered row, two queued renames, an orphan left by the trigger, then
v0.8.7's parse-error `INSERT OR REPLACE`) and a lone orphan with and without a flag — each note
searchable with its own text after the next pass, no stray rows, no path twice; which writes raise the flag
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

## The task table (performance plan L8, 2026-11-25)

`listTasks` read the text of every note from `fts_notes` and scanned it with `scanTasks` on every
call; the tasks view calls it after every save, and so do reminders, widgets and the Tasks
queries. Since L8 the index keeps each note's tasks as it read them (`note_tasks`,
`packages/core/src/db/noteTasks.ts`): one row per note this build indexed, also for a note without
a task (empty `tasks`), written in the same statements as the `files` row and the full-text row,
from the very text that goes into `fts_notes`.

**The key.** A row counts only where its row number, its `sha256` and its `reading` match: the
`files` row's number and hash, and `TASK_READING`, the way this build reads tasks. Tasks are a
function of the note's text alone — `scanTasks` and the `plainva.tasks` key of the properties
block (`excluded`) — so a row that matches is right whatever wrote the `files` row. Neither number
alone would do: SQLite hands out a `files` row number again (the largest one, once its row is
gone), and the full-text row is numbered after it (`-files.rowid`). `TASK_READING` is raised with
every change to what a row would hold for the same text (a field or rule of `scanTasks`, the
reading of `plainva.tasks`, the text the indexer hands over); rows of another reading then no
longer count, and the next full pass reads them anew. `note-tasks-reading.test.ts` holds the output
for a fixed corpus by its hash under the number it belongs to and fails when the output changes
while the number stays. What depends on more than the text stays in the query: the title (from the
full-text row), hidden paths, daily notes and their journal stamps.

**Reading.** A note without a row that counts is scanned from its text, as before; `listTasks`
answers the same, byte for byte and in the same order, in every state the table can be in — none,
half filled in, whole, rows of another reading, notes an older build wrote in between
(`packages/core/test/helpers/taskListing.ts`, run in the core and over both shells' database
adapters: `apps/desktop/src/adapters/noteTasksTable.test.ts`,
`apps/mobile/src/noteTasksTable.test.ts`). It first asks whether any note lacks a row that counts
(the question stops at the first one). If none does, the SQL joins `files` to the table first and
looks up a note's full-text row only for a note with tasks (`CROSS JOIN`), and no note's text is
read. If some do, it reads the full-text table in its own order as before the table and scans only
the notes without a row that counts. Tests hold that a row that counts is taken at its word against
another full-text row, and that a whole table brings no note's text.

**Filling in.** No index format: the table is additive. An index from before it, notes an older
build wrote and rows of another reading are filled in by the full pass once it has written
everything it writes (`fillNoteTasks`), from the index's own text — no file is read, nothing is
parsed but the task lines — in slices of 200 notes, each its own batch (on the phone one
transaction holds one slice). Between slices it asks the pass's signal: a vault being closed is
not filled in any further, and the next open goes on where it ended. A slice is written only for
the text it read (the hash in the statement), so a note saved meanwhile keeps the row its save
wrote.

**Older builds** (tested with the schema and indexer of 0.9.0, frozen from the tag in
`packages/core/test/fixtures/v090/`): 0.9.0 opens such a database, indexes, deletes, moves and
rebuilds without a failure and leaves the table alone; a deleted `files` row takes its row along
through the trigger `files_tasks_go`, which lives in the database and so fires for 0.9.0 as well.
A `REPLACE` of an older build fires no delete trigger and leaves a row behind, and an older build
that makes `files` anew drops the trigger with it: in both cases the hash keeps the rows left
behind from ever counting for another text, and this build's next open creates the trigger again
(`IF NOT EXISTS`).

**Measured** on one machine (Linux, i9-13905H, Node 24; 10 000 notes, 32 046 tasks).
`scripts/perf/task-list-cost.ts` lists in turns, on one index, in each state of the table and as
the list was before it (that statement, word for word), the fastest of seven: whole 67 ms, half
filled in 285 ms, without the table 487 ms, as before 479 ms — without the table the list costs
what it did, the question first and the join on top within 2 %. That state lasts from an update
until the end of the first full pass, and after a rise of `TASK_READING`. Filling in once from the
index's own text: 680 ms for all 10 000 notes, 364 ms for half (`pnpm perf:core`, which also shows
`listTasks` 484 -> 60-65 ms; cold index and the pass without changes unchanged within their spread).
Of the 60 ms most is decoding the rows' JSON.

**The save.** `pnpm perf:core` showed the p95 of 40 saves at 4.1 ms before and 6.7-7.9 ms after
(one run each). `scripts/perf/save-cost.ts` compares this branch with and without the task row,
not with `main`: one note saved 400 times each way, in blocks taking turns on the same index,
gave p50 2.78 / 2.67 ms and p95 9.24 / 9.67 ms; the review's three runs of it put the row at
+0.06 to +0.11 ms per save in the mean, the trigger included. Reading that note's task lines alone
costs 0.02 ms and the statement 0.01 ms. What moved the p95 between the two core runs is not
measured; the row costs about a tenth of a millisecond.

## Reading ahead in the full scan (performance plan L2, 2026-11-25)

The full scan read one file, indexed it, read the next; on the desktop each note was three calls
over the bridge into Rust (two path calls and the read), each attachment its whole bytes only to be
hashed in JavaScript, and on the phone one call through the plugin bridge per file. Since L2 the
files a transaction of the scan writes are read ahead of the loop that indexes them
(`packages/core/src/vault/readAhead.ts`, `VaultIndexer.readScanGroup`):

- **Which files, when.** Up to eight reads at a time — single files, or where the adapter reads
  many files in one call (`readFilesForIndex`, the desktop) two calls of eight files each — and never
  more readings ahead of the loop than that, in or not (8, on the desktop 16). One
  bound holds what a transaction has, in characters of text: its readings taken and those still
  ahead together at most the 16 M characters a transaction holds (`SCAN_TRANSACTION_TEXT`). A
  reading counts by its text once it is in, taken or not; until then by the listing's size in
  bytes, which is never below the characters of a UTF-8 text of that size; an attachment, only
  hashed, holds nothing once it is in. A reading taken keeps its weight until the transaction
  writes, so reads begun after the transaction's time is reached still fit the bound. A file
  heavier than the bound is read on its own. **The true bound:** nothing new begins once the
  bound is reached, but what is in flight is read to its end — at most 8 files at a time (16 on the
  desktop, two calls of eight). Where those files' listing names a size below what they hold, a
  transaction can hold up to those 8 or 16 files at their real size on top of the bound; there is
  no limit per file for the index's reading (a note is read whole), so the largest possible is the
  sum of the 8 or 16 largest files that a listing names too small. Only within a transaction: every read
  begins after the transaction's change mark, so a save or move that lands during a read is seen
  by `changesSince` and the file is read once more, as before. Once the transaction's time or text
  is reached nothing new is begun, and what was begun is written in it. `scanTransactionMs: 0` (a
  file per transaction, tests) reads nothing ahead.
- **The same index.** Readings are handed out in the order of the pass, so rows are written in the
  order they always were; `vault-indexer-read-ahead.test.ts` compares every table, row for row and
  by rowid, with a scan that reads one file at a time (`scanReadsAhead: 1`), with reads answering
  out of order, for single reads and for groups, and where the group call fails or answers what it
  cannot mean. `stamp_vouched` is the one value that depends on when a file was read (a reading
  that begins within a timestamp's tick of the listing is confirmed later), so the comparison runs
  on a steady test clock; a scan that reads sooner after its listing confirms more files once
  more afterwards, never fewer.
- **A file that cannot be read** leaves only itself out and is named, in the order of the pass; the
  group call answers `fallback` for it and the ordinary read decides, as for a file that is gone, no
  UTF-8 text, or under another stored spelling.
- **Closing.** A waiting take ends as soon as the pass's signal is aborted, however long the read
  it waits for still runs (a drive that hangs); nothing new is begun after it. On the desktop the
  Rust side looks each path up in the registry of read roots as its read begins, so a group in
  flight reads nothing more once the vault's root is gone.
- **Desktop:** `read_files_for_index` (`apps/desktop/src-tauri/src/index_read.rs`) reads a group on
  up to eight threads and hashes in Rust; a note comes back with its text and the hash of its
  bytes, an attachment with its hash alone (streamed). Every adapter that wraps another hands the
  call on only where the inner one has it; the conflict-aware adapter notes the texts it hands out
  as `readTextFile` does. The phone reads ahead with its ordinary single reads.

**Measured** with `pnpm perf:core` on one machine (Linux, i9-13905H, Node 24, an NVMe disk; 10 000
notes), the same run before and after: cold index 26.1 s -> 25.1 s (the ratio to the calibration
37.7 -> 32.6), every other number unchanged within its spread. The core measurement reads through
Node from a fast local disk, where a read costs little; what L2 removes is the waiting per file
over a bridge — three calls per note into Rust on the desktop, one through the plugin on the phone
— and a slow medium, which the core does not see. On Windows the first version of this change
measured 71.3 -> 43.4 s at the core (`feature/w2-open`, 2026-11-11).

**At the bridge of the built app** (native smoke, `apps/desktop/wdio/indexRead.e2e.ts`, GitHub
runners, 2026-11-25, run 45678975296): the page reads the same 3 003 generated notes the three
ways and every way hands back each file's hash. One by one in turn as the adapter read them (two
path calls, the read, the hash in JavaScript) / one by one, eight at a time / in groups of eight
through `read_files_for_index`, two calls at a time. This is the reading pattern at the bridge,
not a run of the indexer: what the index's own first run in the app gains is not measured. The
numbers are one run per platform. The first run below took the ways once each in a fixed order, so
the first way also paid for the cold start; the second (run 45704713980, at `e209a141a`) took
each way twice in turns, A B C C B A, both times given:

| | one by one | eight at a time | in groups |
|---|---|---|---|
| Linux (WebKitGTK), first run | 11.52 s | 2.45 s | 0.57 s |
| Linux, second run (A … A) | 11.72 / 4.55 s | 2.48 / 2.44 s | 0.56 / 0.54 s |
| Windows (WebView2), first run | 4.60 s | 3.10 s | 1.24 s |
| Windows, second run | 4.79 / 4.77 s | 3.22 / 3.30 s | 1.26 / 1.28 s |
| macOS (WKWebView), first run | 4.54 s | 1.80 s | 0.32 s |
| macOS, second run | 16.39 / 15.35 s | 6.01 / 5.93 s | 0.88 / 1.27 s |

The macOS runner of the second run was about three times slower throughout; the ratios held. On
Linux the first pass one by one paid for the cold start (11.7 s, 4.6 s the second time).

Hashing 75 attachments in Rust took 14–77 ms. That is the reading of a first index of 3 003 notes,
the part L2 changes; parsing and writing the index are not in it.

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
| List every task | ≤ 100 ms (after L8) | 550–649 ms (32 046 tasks); 60 ms after L8 (2026-11-25, another machine: 484 ms before) | core gate |
| Start bytes per shell | ≤ 3.5 MB | desktop 7.49 MB (2.33 MB gzip, 98 files), phone 7.56 MB (2.30 MB gzip, 60 files) — on main of 2026-11-11; after L5 (2026-11-25): desktop 3.98 MB (1.21 MB gzip, 7 files), phone 4.45 MB (1.33 MB gzip, 5 files); shortly after the start 2.13 / 1.38 MB | bundle gate |
| Phone entry file | ≤ 400 KB | 1 096 KB (desktop entry 93 KB); after L5: 4 KB (desktop 6 KB) — the start chunk holds the rest | bundle gate |
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

### Many tables in one note (finding 2026-11-10, fixed 2026-11-11, L13)

The fixture's long note (80 tables of 200 rows, 19 600 lines, 1.7 MB) took most of a
462-second cold index of the 1 000-note fixture. The time was in the Markdown parser's GFM
tables (`micromark-extension-gfm-table` 2.1.1, under `parseMarkdownAst` and
`parseMarkdownTree` in `packages/core/src/markdown-parser.ts`, and under the desktop reading
view's `remark-gfm`): the table resolver collects one edit per cell boundary of the whole note
in an `EditMap`, and `EditMap.add` (`lib/edit-map.js`, `addImplementation`) found an earlier
edit at the same index by walking every edit made before it — quadratic in the table cells of
a note, whatever their split into tables. Profiled on 40 tables of 50 rows: 852 of 1 210 ms in
`addImplementation` and `add`. Prose in front of a table costs what it costs CommonMark
(linear); the table cells are what squared.

Fixed upstream in 2.1.2 (2026-09-11, commit `4f43ead3` "Fix edit map algorithm for better
performance", issues #16/#17): a `Map` from index to edit beside the list, same merge per index,
same order. Plainva takes 2.1.2 through the lockfile; nothing else moved (the package's
dependencies are the same). `pnpm --filter @plainva/core perf:tables` (`scripts/perf/many-tables.ts`)
measures it through the app's entry points, median of up to five parses, this machine:

| Note | 2.1.1 index / tree | 2.1.2 index / tree | CommonMark |
|---|---|---|---|
| 10 tables × 50 rows | 92 / 80 ms | 53 / 47 ms | 8 ms |
| 20 tables × 50 rows | 304 / 484 ms | 105 / 93 ms | 20 ms |
| 40 tables × 50 rows | 2 061 / 2 026 ms | 300 / 277 ms | 70 ms |
| 80 tables × 50 rows | 19 155 / 10 044 ms | 652 / 590 ms | 151 ms |
| 1 table × 1 600 rows | 1 153 / 1 100 ms | 202 / 181 ms | 38 ms |
| 8 000 prose lines + 1 table × 50 rows | 489 / 500 ms | 499 / 492 ms | 232 ms |
| Long table note (80 × 200 rows) | minutes | 2 337 / 2 223 ms | 443 ms |

What stays above CommonMark is the table work itself (cells become their own inline
contents: about four times the events), linear in the cells. The 1 000-note fixture through
both entry points: 778 s with 2.1.1; with 2.1.2 the whole test file that reads it (below) takes 15 s. The core gate (10 000 notes, long
note left out as before) did not move: cold index 70.3 s before, 68.2 s after, every metric
within its budget. A single 6 400-row table measured 2.2 s once in the benchmark and 0.3 s in a
profile run of its own; the difference was the heap the earlier cases left behind, so the
benchmark collects before each parse when Node runs with `--expose-gc`.

The result did not change: `packages/core/test/gfm-table-parse.test.ts` pins the digests of the
trees 2.1.1 made — every node, value and position through both entry points — for 37 hard
tables (alignment, escaped pipes, code with pipes, links/tasks/tags/block ids in cells, tables
after paragraphs, in lists, quotes and callouts, without outer pipes, at the end without a
newline, CRLF, a byte order mark, malformed delimiter rows, 1 000 rows, …) and for every note of
the 1 000-note fixture, the long table note included; 2.1.2 makes the same trees. The same test
gives the 80 × 50 note a budget of 3 s on the reference core through `within()`
(`test/helpers/timeBudget.ts`, scaled to a slower core): about 0.6 s linear, 19–39 s quadratic. A
unit test rather than a gate metric because it runs on every commit in the required checks, and
the scaled budget holds on a slow runner without a baseline per machine.

The parse budget's table rule changed with it. Since 2026-11-01 (`inlineParseBudget.ts`) a table
whose rows times length went over 5 × 10⁸ was read as written, because the table parser's time
was taken to grow that way — so from about 2 500 short rows on a table was no table in the index,
the note source or the reading view, and none of its links reached the index. That time was the
quadratic `EditMap` above. What a large table still costs is memory: every cell is a parse of its
own, and the events of the whole table are held until the tree is built. Measured 2026-11-11 on
this machine (one table, a fresh process each, `--expose-gc`; peak = the process's resident memory
during the parse, retained = heap after a forced collection with the tree kept):

| Table | index parse: ms / peak / retained | reading view (mdast + hast): retained |
|---|---|---|
| 10 000 rows of four short cells and a link, 253 KB | 1 091 ms / 425 MB / 24 MB | 65 MB |
| 20 000 such rows, 517 KB | 1 977 ms / 875 MB / 48 MB | 129 MB |
| 50 000 such rows, 1.3 MB | 7 305 ms / 1 802 MB / 126 MB | 320 MB |
| 10 000 rows of four cells of words, 749 KB | 1 302 ms / 534 MB / 25 MB | 66 MB |
| 2 000 rows with links and emphasis in every cell, 282 KB | 1 005 ms / 395 MB / 22 MB | 45 MB |
| 1 000 rows of 400 unclosed `[` and `*`, 594 KB | 1 915 ms / 636 MB / 76 MB | 181 MB |

The peak follows the characters, the cells and the inline syntax, and each row, each block marker
in front of a line and each autolink literal (`a@b.cc`, `www.`, `://`) adds events of its own. The
budget is set by a criterion that can be re-run (`scripts/perf/table-budget.ts`): a table of every
shape at the budget, **alone in an otherwise empty note**, is read by the index parse, by the
note-source parse and by the reading view's parser with its HTML tree (`mdast-util-to-hast`, which
fills every row to the header's columns), each in a process of its own under
`node --max-old-space-size=128`. That is all
it holds: the budget is per table, and the memory of a parse is per note (below, "One note, many
tables"). `pnpm --filter @plainva/core perf:tables -- --calibrate` finds the
largest such table of each fixed shape and chooses the weights of `tableReadCost` as an upper
bound, not as a fit: over the plain shapes, for every set of row, cell and syntax weights the
budget is nine tenths of the lightest limit, and of those sets the one that leaves a word and a
link the most rows wins; then every shape still short of the budget / 0.9 lifts the weight of one
of its other parts (references, links, formulas, literals, words, block markers — below), so that
every limit weighs at least the budget / 0.9. The limit search
takes about a minute a shape; `-- --calibrate --limits <log>` takes the limits an earlier log holds
and searches only the new shapes. `-- --check` (about four minutes) holds the constants against the
54 fixed shapes at the budget and at the budget / 0.9 and against 36 generated shapes at the budget:
seeded (seed and template printed on a failure), 1 to 24 columns, cells of 0 to 80 characters,
outer pipes and blanks on and off, pipes escaped with one, two and three backslashes, four syntax
densities, code spans, empty cells among filled ones, at the top, in one to three quotes, a callout
and a list item. A cell is counted the way the parser counts it: a `|` behind an even number of
backslashes is a boundary (`\\|` is one, `\|` and `\\\|` are not, also in a code span), and a row
without outer pipes has one cell more than boundaries.

Which lines a table has is the parser's answer, and the scan of the budget follows it
(2026-11-13): a line without a pipe under a table is a row (`bar` is a row of one cell), and so are
lines that begin with `*a*`, `_x_`, `<b>`, `=` or `-a`; `|` alone is a row of one cell; a header
needs no pipe when its delimiter row has one (`a` over `|-`), and a delimiter row needs none when
it has a colon (`h` over `:-`; `--` underlines a heading); white space is a blank or a tab only (a
no-break space behind `-|-` makes it no delimiter row); a table stands in a quote or callout, a
list item, a footnote, and behind a paragraph line in the same block. A note whose first line is
`---` with nothing to close it starts a properties block that never ends, and from there on the
parser opens no quote, list item or footnote: `- a` and `> b` are rows under a table
(`opensNoContainers`). That mode belongs to the parsers with the properties block; the reading view
reads no such block and opens quotes and lists there, and CommonMark (an import of another program's
notes) reads no table at all. So the scan weighs for the parser that takes its ranges
(`NOTE_READING` for the index and the note source, `READER_READING` for the reading view,
`COMMONMARK_READING` for `parseCommonMarkTree`): weighed for the note's parsers only, 800 quoted lines
behind an unclosed `---` held the reading view for 18 s, and 800 table rows a CommonMark import for
10 s. Every row weighs at least the header's columns in cells, because the reading view makes that
many of it (a header of 100 columns over rows of `|`, a note of 31 KB, made 1.5 million cells). The
links `www.`, `mailto:` and `xmpp:` are weighed in any case (`WWW.a.b` is a link). A text short
enough for the paragraph budget is still scanned when it may hold a table. Over the budget, the
lines behind the table that would continue its paragraph or underline it (`---`, `===`, indented
code, an empty item) are read as written with it: before, a `---` under such a table made all of it
one heading of 130 KB.

What a table costs the parser is not only its characters, cells and syntax (2026-11-13, fourth
review). At the start of each word of a cell — a run of characters other than blanks and pipes, in
any script — the parser holds the cell's text in a piece of its own until the cell is read (and at
an ASCII word it tries an e-mail address there): 999 rows of `| a a a … |` (150 words), 1 498 rows
of a hundred numbers, 1 443 rows of `中文 中文 …` fill 128 MB, where their characters weighed a
quarter of the budget; the scan of `origin/main` read them as written, this one read them as a
table and ran out of memory. A footnote reference with its definition (`[^1]`) and a Markdown link
or image (`[l](u)`, 151 rows of 80 fill 128 MB) are nodes of their own with many events. So a row
weighs its words, its references and its links as well (`tableRowParts`). These costs are not in
micromark's events: after the parse `| a a … |` keeps 18 events a row, fewer than a word and a link
(30); the pieces live while the cell is read. No count the tests can make sees them, so the
calibration measures the heap: besides the fixed shapes, `--calibrate --search <n>` measures the
limits of n generated tables (words, numbers, every kind of literal, references with their
definition, tags, formulas, highlights, entities, CJK, emoji, long words, CRLF, a byte order mark,
in quotes, lists and callouts) and chooses the weights over all of them, and the performance
workflow runs `--hunt` on every push: 200 generated tables of a seed drawn anew, each at the budget
under 128 MB in every reading, at most 20 minutes; a table that does not pass names its seed and
shape, and goes into the fixed shapes. `--check` also compares with the scan of `origin/main`
(read through `git show`): every shape this scan reads as a table at more rows than main does must
pass at the budget.

The tests hold the weight against what can be counted. `inline-parse-budget.test.ts` (the gauge,
1 500 generated tables of the same kinds; the seed is fixed in the suite and drawn anew in CI)
holds each table's weight against the events micromark keeps for it (with the note's extensions)
and against the nodes of the note's tree, the reading view's tree and its HTML tree: none may make
more per weight than the densest calibrated shape, less a tenth. `readerTableBudget.test.tsx` in
the desktop app holds the same against the page the reading view renders with its own plugins
(`READER_REMARK_PLUGINS` of `markdownReaderModel.ts`, which `MarkdownReader.tsx` runs: tag pills,
highlights, and KaTeX for formulas): what tag pills and highlights make of `#a` and `==a==` is
covered by the word weight, so their own weights (`TABLE_TAG_WEIGHT`, `TABLE_MARK_WEIGHT`) are 0.
Formulas the node count does not hold: KaTeX's memory while it lays out a formula is far more than
the elements it leaves (a table of `$a$` at the budget passed the node count and ran the reading
view out of memory). Since 2026-11-17 the table budget does not weigh formulas at all, and since
2026-11-18 nothing bounds them (below, "Formulas"). What React and the DOM hold beyond the
page is not measured. Until then the scan ended a table at the first such line
and weighed no table in a quote, a list item or a footnote at all — older than the table budget:
the rows-times-length rule of 2026-11-01 had the same hole. Where the scan is sure of the blocks (a
table behind quote markers or list items only, starting a paragraph or interrupting one in the same
block) it ends a table where the table parser does (`endsTable`, `exactRow`: tabs behind `>`
counted as CommonMark counts them, a line less indented than its item ends the table). Everywhere
else — a line that may continue a paragraph lazily, HTML, fenced code, the parser's quirks (behind
indented code a lone `-` is a table's header) — it weighs a table generously, over every line that
could be one of its rows, and measures the same lines as paragraph text as well, so neither
measure can hide lines from the other. `inline-parse-budget.test.ts` holds this against the parser
over 3 000 generated notes (block markers and lines drawn at random); a scratch run of 160 000
found no table the scan missed and no paragraph a table split.

Calibrated 2026-11-15 over 141 shapes (99 fixed, 42 from searches) and three parses (index, note
source, reading view with its HTML tree, and with `remark-math` and KaTeX for a note with math): one
per character, 832 per row, 204 per cell, 122 per character of inline syntax, 63 per footnote
reference, 316 per link or image destination (a wiki link counts as one, and as an autolink
literal: the reading view shows it as a Markdown link), 160 per autolink literal, 171 per word, 72 per level of a block a table
stands in (each `>`, each list marker, each two blanks of indent). The base — rows, cells,
syntax — is chosen over the shapes without markers, literals, references and formulas (formula
shapes are left out since 2026-11-17: the table budget weighs a table's structure), with at most
two links and ten words a row, so that a word and a link keeps the most rows. Then every shape still
short of the budget / 0.9 is lifted by the part that lifts it most for what it costs a word and a
link (its count of the part per row against a word and a link's): a footnote reference, a formula
or a block marker costs a word and a link nothing, a row of eighty Markdown links is lifted by its
links, a row of numbers by its words, a table twenty quotes deep by its markers. Weights only rise,
so the passes end. (Lifted in a fixed order, as until 2026-11-15, a shape counted only by the
first part it had: once a wiki link counted as a link, a link weighed 3 370 396 for a shape with a
link in eight rows.) The calibration proposed 8 160 000; the budget is **6 970 000**, so that the
lightest measured shape sits about 30 % above it (decided with the coordination 2026-11-13, kept by
the maintainer 2026-11-15; the reasons for the margin stand above). A word and a link is read as a
table up to about 2 530 rows — fewer than the 3 040 of 2026-11-13, because the index now weighs a
row with a wiki link, part by part, at least as the reading view writes it (`readerWikiLink`: the
label spelled out, the target encoded), so that both decide the same.

| Shape | Limit under 128 MB | Limit weighs | At the budget |
|---|---|---|---|
| a word and a link | 7 859 rows | 3.10 × the budget | 2 532 rows |
| four short cells and a link | 4 573 | 2.19 × | 2 091 |
| four cells of words | 4 178 | 3.06 × | 1 366 |
| links and emphasis in every cell | 1 527 | 2.29 × | 666 |
| one long cell of prose | 2 435 | 4.11 × | 591 |
| sixteen one-character cells, no blanks | 1 413 | 1.39 × | 1 014 |
| 150 `~a` per row | 462 | 1.31 × | 351 |
| 400 unclosed `[` and `*` per row | 296 | 2.19 × | 135 |
| one short cell between two pipes | 17 940 | 3.11 × | 5 759 |
| a word and a link in a quote or a list item | 7 718 | 2.94 × | 2 627 |
| sixteen one-character cells in a quote | 1 315 | 1.31 × | 1 003 |
| one short cell in two quotes | 12 999 | 2.53 × | 5 131 |
| one short cell twelve quotes deep | 5 078 | 1.53 × | 3 321 |
| one short cell twenty quotes deep | 3 458 | 1.33 × | 2 590 |
| one short cell twenty list items deep | 7 782 | 3.01 × | 2 590 |
| one short cell in twelve quotes and lists | 7 005 | 2.11 × | 3 321 |
| a hundred `a@b.cc` per row | 515 | 2.58 × | 200 |
| a hundred `WWW.a.b` per row | 485 | 2.44 × | 199 |
| a hundred `a@b.cc,` without blanks | 509 | 1.31 × | 389 |
| `- a` and `> b` behind an unclosed `---` | 8 700 | 1.73 × | 5 032 |
| rows of `\|` under a header of 100 columns | 5 292 | 16.12 × | 326 |
| 150 words `a` per row | 999 | 3.86 × | 258 |
| a hundred numbers per row | 1 498 | 3.97 × | 377 |
| a row of English | 1 633 | 3.96 × | 412 |
| a row of German | 3 422 | 4.17 × | 820 |
| a hundred `中文` per row | 1 443 | 3.82 × | 377 |
| a row of Russian | 2 394 | 3.97 × | 603 |
| a hundred `[^1]` with the definition below | 184 | 1.30 × | 141 |
| 80 `[l](u)` per row | 151 | 1.30 × | 115 |
| a hundred `$a$` per row (reading view with KaTeX) | 88 | 1.40 × | 63 |
| 40 `$\frac{a}{b}$` per row (reading view with KaTeX) | 74 | 3.08 × | 24 |
| one integral per row (reading view with KaTeX) | 730 | 3.74 × | 195 |
| forty fractions in one formula (reading view with KaTeX) | 97 | 3.88 × | 25 |
| a matrix of sixty cells (reading view with KaTeX) | 105 | 1.48 × | 71 |
| thirty `\overbrace` in one formula (reading view with KaTeX) | 53 | 2.41 × | 22 |

The lightest limits — sixteen one-character cells in a quote in a list item, forty one-character cells,
footnote references, Markdown links, `$a$`, a matrix in KaTeX — sit 30 % above the budget (the limit
search is exact to 4 %).

The fifth and sixth reviews (2026-11-16) found shapes the weight undercounted; they are weighed
since and are held by `--margin` (each table at 1.3 or 1.4 × the budget, without the budget, under
128 MB), not by a limit search:

- formulas between two `$` on each side (`$$…$$`, which remark-math reads in a cell as `$…$`; the
  scan turned at every `$` and counted none of its content). Since 2026-11-17 the table's weight
  counts a `$` as a character of inline syntax and nothing more (below, "Formulas");
- 120 `[^1]`, 80 `[l](u)` or `![i](p)`, 80 `[l][r]` or `[r][]`, 120 `[r]` with their definition,
  all without blanks between them: one word, but as many pieces of the cell's text. Each `[`
  glued to the word before it now counts as a word as well (not the second `[` of a wiki link,
  nor the `[` of an image that opens its word);
- a matrix of sixty cells, which kept 30 % and no more at the calibration's weight of a formula's
  character (526); the weight of a formula's character is gone since 2026-11-17 (below).

| Shape | At 1.3 × the budget | At 1.4 × | At the budget |
|---|---|---|---|
| 40 `\frac{a}{b}` in one `$$…$$`, behind `\$`, behind `` `$` `` | 33 rows, pass | 35, pass | 25 |
| a matrix of sixty cells in `$…$`, in `$$…$$`, behind `\$` | 92, pass | 99–100, pass | 71 |
| thirty nested `\sqrt` in `$$…$$` | 68, pass | 73, pass | 52 |
| thirty `\overbrace` in `$$…$$` | 29, pass | 31, pass | 22 |
| a hundred `$a$` | 81, pass | 88, pass | 63 |
| 120 `[^1]` without blanks | 153, pass | | 118 |
| 80 `[l](u)` without blanks | 150, pass | | 116 |
| 80 `![i](p)` without blanks | 129, pass | | 99 |
| 80 `[l][r]` or `[r][]` without blanks | 133, pass | 143, pass | 102 |
| 120 `[r]` without blanks | 176, pass | 190, pass | 136 |
| a hundred `[^1]`, 80 `[l](u)`, 80 `![i](p)` with blanks | 183, 150, 129, pass | | 141, 116, 99 |

An `@2026-03-04` weighs what the reading view writes for it (`formatRelativeDate` in packages/ui:
a word for a day up to two away, else the date, in the app's language) beyond its eleven
characters: at most 5 characters and two words more ("depois de amanhã", "2026. 03. 04.").

A row heavier than the whole budget as written is not written out as the reading view would write
it: its table is over the budget either way. Nor is a row whose writing is longer than the budget at
the least — its labels and its targets percent-encoded, counted without writing them (a wiki link of
five million CJK characters, light as written, ran the scan out of memory). The scan built that writing for every row with a wiki
link, and a row of 1.5 MB whose link holds `[[x` over and over ran it out of memory under 128 MB
(main: 36 ms, 25 MB; now 72 ms, 27 MB). The writing itself (`readerWikiLink`) is built from its
pieces in one join and walks a label's spellings one by one; a stretch read as written is made
safe by one replace, not a string grown by a character.

**Formulas: the reading view lays out every one, as `main` does (2026-11-18).** The reading view
exists on the desktop only. The 128 MB of this section are the measure for what both shells run —
the index and the note parses — and for the decision "table or text", which must fall alike on
every device; for the formulas the desktop's reading view lays out they are no real limit: `main`
lays out a thousand formulas there, or three thousand. Weighed before the parse (by hand, then with
a parser of their own), formulas came out wrong or expensive in every review: a price (`$5 per
month`) weighed everything behind it, a `$` in a code span paired with one outside it, a reference
definition below a table made a link of what the row alone read as a formula, and parsing each row
cost a table of 1 MB 4.5 s at every pause in typing. Bounded after the parse — by their source at
the dearest shape's weight a character (the tenth review), then by the nodes KaTeX made of them
with a precheck of 17 nodes a character (the eleventh) — each calibration "as `main` under
128 MB" compared against a measuring set-up, not against the app, and each found new departures
from `main`: long display formulas, `aligned` and `cases` left as source where `main` lays them out,
environments undercounted, formulas in tables cut by what the tables weighed, `\rule`, `\href` and
long `\text` past every estimate (twelfth review, 2026-11-18). So the table budget weighs a table's
structure alone — a `$` is a character of inline syntax and nothing more — and the reading view
lays out every formula remark-math reads, with `rehype-katex` itself, as `main` does
(`readerTableBudget.test.tsx` holds it for inline and display formulas, `aligned`, `cases`,
matrices, formulas in lists, quotes and callouts, beside a table and in table cells, and that
`MarkdownReader.tsx` hands KaTeX's plugin to its page with nothing in between). **The reading view
exists on the desktop only; its formulas are not bounded. How much memory a whole note may take in
the reading view is L14's to decide.** A named limit until then: a table at the table budget with
formulas in its cells runs the reading view out of 128 MB (the performance workflow's hunt of
2026-11-18, 18 of 200 drawn tables); the index and the note parse of the same tables stay under
128 MB. The table check and the hunt therefore run the reading view under 128 MB with remark-math
and its HTML tree but without KaTeX's layout (`table-budget.ts`): what they measure is the parse
the table budget decides, not the desktop's formulas.

**Tables over the budget keep their links in the index (2026-11-17).** A table over the budget is
text for the reading view; the index read it as text too, and a price table of 2 000 rows gave it
2 links where `main` gave 2 002 — lost to the backlinks and the graph, and left behind by a rename
of the notes they lead to. `parseMarkdownAst`, which the index, a rename and the workspace index
read, reads each row of such a table on its own, under the table's header and delimiter row (the
reader of every other table, one row at a time), and keeps of it only its links, at their places;
tags were never lost, they are read from the text. A price table of 5 000 rows gives its 10 000
links under 128 MB (61 MB), and 2 000 rows take 1.8 s where `main`, reading them as a table, takes
2.8 s and 135 MB (`table-row-links.test.ts`). The parse of such a table as text makes a link of
every URL and e-mail address it meets, and the rows gave each again: 2 400 rows of URLs stood in
the index with 19 202 links (131 MB) where `main`, reading them as a table, has 9 602 (twelfth
review, 2026-11-18). A link the parse as text made inside the table gives up its place to its text
before the rows' links join (`unwrapLinksIn`), so each is read once; over the 18 forms of the
review the index then finds the same links and tags as `main` (count and hash) at the most rows
`main` still reads as a table, and the test holds the links of URLs, Markdown links, a price table
and a table in a quote against the parse of the same table as a table, link for link and line for
line.

**What the scan costs.** The scan runs at every pause in typing (the properties panel, the status
bar), so it is held to twice what `main`'s takes at most there. It reads characters by their codes
with a table of what to do with each, and it keeps the parts of the table rows it weighed in the
latest two scans, by the row and the characters around it: a pause re-weighs only the rows that
changed, and what it keeps is the rows of at most two texts. Measured in the review of 2026-11-17:
at a pause in typing 19 to 37 ms for a note of 1 MB against 8.5 to 19 ms at `main`; the first scan
of a note, with nothing kept, 57 to 145 ms a MB against 8 to 9 ms, linear in the size; in the
index under 5 % of the parse.

**What the criterion covers, and what not.** Covered: one table alone in an otherwise empty
note, read by the index parse, the note-source parse and the reading view as the core can run it
— the note prepared for it (`prepareReaderSource`), GFM, `remark-math` for a note with math, its
HTML tree, without KaTeX's layout (above, "Formulas") — each under a heap of 128 MB, for the shapes measured and the shapes the
search draws (words, numbers, every literal, references with their definition, links, tags,
formulas of any length between one or two `$`, references, links, images and wiki links without
blanks between them, highlights, CJK, emoji, CRLF, a byte order mark, quotes, lists, callouts,
blocks twelve deep, items in items under a paragraph line). The desktop app's own remark plugins (tag pills, highlights) are held by
nodes in `readerTableBudget.test.tsx`, not by heap. Not covered: what React and the DOM hold
beyond the page, a note embedded in a cell (`![[…]]` expands in the reading view), code blocks
and Mermaid diagrams in cells, and the memory of a note of many tables (L14). The gauge tests
against events and nodes catch shapes dense in structure; they do not see memory — the heap
search does, in `--calibrate --search` and in the performance workflow's `--hunt`, which runs on
every push and daily on `main`, never cancelled by a push. The hunt holds three more things of each
drawn table (since 2026-11-16): every parse ends within 20 s; where the scan reads a table exactly,
the parser reads one too (an item from 2 inside an item under a paragraph makes the header text
of the paragraph, and the scan read it as a table, took its rows out of the paragraph's measure,
and the parser spent 17 s on the paragraph's brackets); and the scan's time grows with the note,
not faster (at eight times the rows, or a long row eight times as long, at most sixteen times the
time: a row with a wiki link and 160 000 code spans took the scan 16 s, now 0.15 s). It draws long
rows of three kinds — a wiki link and thousands of code spans, one wiki link of 200 KB whose label
is `[[x` over and over or brackets alone — and runs the scan alone over such a row eight times as
long under 128 MB; and cells of units without blanks between them, among them `$$…$$`, `\$$…$`,
`` `$` $…$ ``, `[l][r]`, `[r][]` and `[r]` with their definitions.

**What the budget costs against `origin/main`** (the fourth review, `review-tables-5/cap.mts`;
the maintainer decided on 2026-11-15 to keep the margin of about 30 %). The table gives the most
rows of a form that each scan still reads as a table, for the note's parsers (the raw text) and
the reading view (the note prepared by `prepareReaderSource`), on `origin/main` (`d44a9d57d`) and
on this branch; the last column is the branch's lower limit over main's.

| Form | main, note | main, reader | branch, note | branch, reader | branch / main |
|---|---:|---:|---:|---:|---:|
| 3 columns of a word | 4 493 | 4 493 | 3 517 | 3 517 | 0.78 |
| 5 columns of a word | 3 741 | 3 741 | 2 541 | 2 541 | 0.68 |
| 8 columns of a letter | 3 640 | 3 640 | 1 800 | 1 800 | 0.49 |
| 2 columns, a word and a wiki link | 4 189 | 3 296 | 2 376 | 2 376 | 0.72 |
| a task list of 5 columns, a wiki link and a sentence | 2 368 | 2 224 | 1 402 | 1 402 | 0.63 |
| a cell of a hundred wiki links | 909 | 596 | 60 | 60 | 0.10 |

A table eight quotes deep is not in the table: on main its search did not end within 15 minutes,
since main weighs no quote level. A column of integrals was not measured against main.

Against the state reviewed sixth (`f5dfc5bbf`) the rework of the same day leaves the forms above as
they were (3 517, 2 541, 1 800, 2 376, 1 402 and 60 rows, 2 556 rows of three columns with a
Markdown link, 115 rows of 80 Markdown links); a column of a short formula loses (1 172 rows, now
1 078; main 4 905), for the formula weight of 600; a table with an `@date` in each row gains (one
date and a cell: 2 631 rows, now 3 299; five dates in a cell: 972, now 1 552; main 4 586 and
2 794), since the date weighs what the reading view writes for it.

**Open until L14: a stretch read as written costs the parse in its words and its spelled-out characters.**
GFM tries an e-mail address at every start of a run of letters and digits and holds the text in a
piece for each, and the reading view spells out each character of a wiki link's label that Markdown
would read (`_`, `&`, `<`, `!`, `$`, a backtick, `\`, `[`, `]`). Neither the table budget nor the paragraph budget weighs the
stretch that is read as written, so a large one can still run a parse out of 128 MB. Measured in the
review of 2026-11-16, at 128 MB: on this branch the note parse (`parseMarkdownTree`) reads a table
row of one wiki link whose label is `[[x` over and over up to about 850 KB (main 1.5 MB and more,
since main reads it as a table and the wiki-link syntax takes the whole cell), the index parse up
to 1 MB, and a wiki link whose label is `a_a_…` up to about 500 KB (main about 1 MB). The other way
round, main runs out in the reading view for both at 300 KB (this branch reads `[[x…` to 600 KB),
and on main a paragraph of `x x …` runs out at 600 KB and a table row of it at 450 KB. This is
the class, not one form: wherever a parse reads a large stretch as written. L14 (the memory of a
whole note) closes it, with this as its acceptance: for each of these forms the branch is in no
reading worse than main and stays under the memory budget.

Main and the branch weigh differently, so the loss is not the margin alone. The margin of about
30 % costs every form the same; beyond it, the branch weighs a cell and a row at what the reading
view's heap takes for them (8 columns: 0.49), and a wiki link as the Markdown link and the literal
the reading view makes of it (a hundred wiki links in a cell: 0.10). Main stays under 128 MB at its
limits for the forms of a few columns, but a parse takes 3 to 23 s there; at 8 and 12 columns and
in the measured series it runs out of memory. Whether main's 596 rows of a hundred wiki links stay
under 128 MB in the reading view was not measured, nor the branch's 60: the calibration fits the
link weight on shapes of one to three wiki links a row, and the search draws cells of mixed units.

The scan runs on every open and every index pass, for every note. For an ordinary note it costs
what it cost on `origin/main`: 1 MB of prose 4 to 8 ms (main 9 to 14 ms), a note of 2 000 small
tables 11 to 25 ms (main 4 to 7 ms); a table line is weighed only where the line under it may be a
delimiter row, and a line that starts with a letter or a pipe is asked nothing more. Shapes made to
cost it stay linear but cost more than on main: 100 000 two-line tables 0.2 to 0.3 s (main 0.04 s),
40 000 tables in quotes behind an unclosed `---` 0.1 to 0.3 s (main 0.02 s), a header of 1 000
columns over 100 000 rows of `|` 0.1 s (`review-tables-4/lin4.mts`, timings on a shared machine).
A large table costs the scan about 7 times what it costs on main, a table of CJK text 9.7 times
(124 to 160 ms per MB, `review-tables-5/lin.mts`): it weighs every row, where main measured the
table's rows and length. That is the parse alone: the heap a WebView gives the app is
not known here, so raising the budget needs a measurement in the phone's WebView first. A table
over the budget is read as written, as before: in the index it has no links, and the reading view
shows its lines as one paragraph of text with the pipes in it, no table, its quote or list around
it as it was — and no other block: its `=` and `-` are read as written as well, so that a row of
`==` cannot underline the rows above it as a heading.

**One note, many tables (open, 2026-11-13).** The memory of a parse is the note's, and the budget
is the table's. Measured under the same criterion (each parse in its own process, 128 MB): one
table at the budget passes, two do not; at half the budget three tables of a word and a link
pass, at a tenth seventeen; of sixteen one-character cells per row, two at half, twelve at a
tenth. What a parse holds at its peak adds up over the tables of a note — the tree it keeps is
small, 7 to 10 MB a table at the budget, the peak about ten times that. The fixture's long table
note (80 × 200 rows) does not pass, 22 of its 80 sections do; a list of 9 500 linked items without
any table does not either. Before L13 the same was true with the lower rule: three tables of 2 500
rows passed, four did not. Nothing bounds the memory of a whole note; that is a package of its
own. Read as written, 12 000 such rows take 0.3 s and about 120 MB of resident memory at
the peak.

What the written reading costs above the budget is the one thing not linear here, and it is not the
table's: micromark's text initializer (`resolveAllText`, 4.0.2) merges adjacent `data` events with
one `splice` each on the paragraph's whole event list, quadratic in the lines of one paragraph —
20 000 such rows read as written take 2.5 s, 40 000 rows 19.6 s (93 % in that function), 50 000
rows 23 s in the reading view. The same holds for any paragraph of that many lines. micromark 4.0.3
(2026-09-26, "use edit map in text initializer") fixes it, but the same release changes how
emphasis next to other punctuation is read ("fix attention flanking next to others"), so taking it
is a package of its own with its own corpus check, not part of this one. Lists are in the same
class as tables for memory (20 000 list items with a link: 409 MB at the peak), with no budget of
their own.

`inline-parse-budget.test.ts` reads a table at the budget (about 2 530 rows) as a table with every
link, the same table one row longer as written — one paragraph, every other block of the note as
before — within 5 s on the reference core, and times a table of 4 000 rows apart from those (3 s on
the reference core, about half a second here).

The core gate still leaves the long note out (`longTableNote: false`): taking it in would void
every recorded baseline, and the unit test above already holds its cost. Whether the editor
still holds a 19 600-line note in the browser report is the editor's question (L6), not this
parser's any more.

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

## Parser corpus 0.8.7 vs 0.9.0 (§ 3.185 Nr. 8, 2026-11-24)

0.9.0 moved `micromark` 4.0.2 → 4.0.3 and `micromark-core-commonmark` 2.0.3 → 2.0.4 (with
`micromark-extension-gfm-table` 2.1.1 → 2.1.2 and `mdast-util-to-hast` 13.2.1 → 13.2.2). The comparison
the L14 note had planned (`Uebergaben_nach_0.9.0/L14_Korpus_micromark_4.0.3_2026-11-13.md`) was run for
both sides with the exact versions each tag's lock file pins.

**Method (reproducible).** `packages/core/scripts/perf/parser-corpus-digest.ts` writes one hash per text and
per reading; `parser-corpus-compare.ts` lists every text where a reading differs. Run the digest in a
checkout of each release (for `v0.8.7`: `git worktree add ../x v0.8.7`, `pnpm install --frozen-lockfile`, copy
`parser-corpus-digest.ts`, `parserCorpusForms.ts` and `parser-corpus-compare.ts` in), then compare. Six
readings per text: the index's AST (`parseMarkdownAst`), the editor tree, the CommonMark tree, the reading
view's hast from the raw and from the prepared source, and what the index takes from the AST (links, tags,
front matter).

**Corpus: 4247 texts** — the hand-made forms (`HARD_FORMS`) (emphasis next to punctuation, Unicode, strikethrough, wiki
links, tags, code, math, tables, indented/fenced code, HTML blocks, setext, line endings, BOM, an unclosed
`---`) and each of them again as a 100-line paragraph; the 1000-note perf fixture vault (without the long-table
note, see below); the table corpus (`NASTY_TABLES`); the 652 examples of the CommonMark
0.31.2 spec; and every note of the maintainer's local test vaults (named by a hash of the path only; no content
is part of this document).

**Result: 5 of 4247 texts differ, all of one kind — `*` directly next to `_`, inside a word:**

| Input | 0.8.7 | 0.9.0 |
| --- | --- | --- |
| `a*_b_*c` | a, emphasis(emphasis(b)), c | `a*`, emphasis(b), `*c` |
| `a**_b_**c` | a, strong(emphasis(b)), c | `a**`, emphasis(b), `**c` |
| `word*_x_word` | `word*_x_word` (the same in both) | differs only as a 100-line paragraph |

The five differing texts are the forms `attn_intraword_star_underscore` and
`attn_intraword_double_star_underscore`, their two 100-line paragraph variants, and `word*_x_word` as a
paragraph; in each of them the five AST/hast readings follow the parser, so the
index, the editor tree and the reading view agree with each other on each side. Links, tags and front matter
facts are identical everywhere. Tables, the fixture vault, the spec examples and the test vaults are identical
in every reading.

**Cause and decision.** `micromark-core-commonmark` 2.0.4 (`lib/attention.js`) no longer lets `*` and `_`
count as punctuation when it decides whether a delimiter run can open or close. By the CommonMark flanking
rule the first `*` of `a*_b_*c` (a letter before it, a punctuation mark after it) is not left-flanking, so it
cannot open emphasis: the 0.9.0 reading is the specification's, the 0.8.7 reading was the deviation. Taken as a
deliberate, specification-conforming change, **without a lock file change; it can be reverted** by pinning
`micromark-core-commonmark` back to 2.0.3 (the 0.8.7 column above returns). It touches only
intraword `*_…_*` combinations, which notes hardly contain. (Maintainer decision, 2026-11-24.)

**Not part of the digest: the long-table note.** With `gfm-table` 2.1.1 the 20,000-row note takes minutes;
`packages/core/test/gfm-table-parse.test.ts` already proves 2.1.1 and 2.1.2 produce the same tree on it.

## Start bundle (L5), 2026-11-25

What each shell loads before its first picture, from the bundle gate (`pnpm perf:bundle`, both
shells built with source maps; the baseline before is the release commit of 0.9.0):

| Shell | | Start | gzip | Files | Entry file | Shortly after (gzip) |
|---|---|---|---|---|---|---|
| Desktop | before (0.9.0) | 7 804 033 | 2 427 962 | 98 | 95 942 | — |
| Desktop | after | 3 981 956 | 1 205 611 | 7 | 6 190 | 2 129 006 (679 820) |
| Phone | before (0.9.0) | 7 892 524 | 2 412 166 | 60 | 1 132 589 | — |
| Phone | after | 4 454 456 | 1 330 240 | 5 | 4 472 | 1 384 774 (451 292) |

Desktop −49 %, phone −44 %. "Shortly after" is what the shell loads once its first picture stands, with nobody
doing anything and the AI switched off (the parts loaded ahead while it idles, and the language's locale file with the English one: they load before the first
picture, but `index.html` does not name them, so the start bytes leave them out) — measured by the gate since the review of L5, so a
saving that only moved bytes to a moment later shows as that. The three `mustNotStart` rules hold for the start and
for that moment, in both shells. Both shells are still over the plan's 3.5 MB: what is left is listed at the end.

**One start chunk.** What the start loads statically was spread over 262 (desktop) and 368 (phone) small chunks
— whatever other parts shared with it. `scripts/vite/startChunk.mjs` computes the static closure of the shell's
`main.tsx` in the build and puts every module of it, but `main.tsx` itself, into one chunk `start`: 7 and 5 files.
The entry file is now the few bytes around `main.tsx` (the budget of 400 KB for the phone's entry file is met
trivially; the start bytes are what counts). The time to the first editable note did not change measurably (headless
Chromium over a local server, three runs each, first tree / first editable note in ms: before 4 135 / 4 633, 4 122 /
4 738, 4 040 / 4 645; after 4 074 / 4 732, 4 079 / 4 697, 4 126 / 4 709): on a local disk the number of files
costs little, on a device with a slow WebView each request costs more.

**The cause that weighed most: barrels under `strictExecutionOrder`.** The production bundles run
every module in the order its imports say (stability plan R10). Under that option the
initialisation of a barrel — `packages/ui/src/index.ts`, `packages/core/src/index.ts`, each one
`export * from` hundreds of modules — runs every module it re-exports. One
`import { toast } from "@plainva/ui"` in the start therefore carried the whole package: the AI
harness, the database views, the template catalogue, even the parity catalogue that no runtime
code reads. `"sideEffects": false` and `treeshake.moduleSideEffects` change nothing here — and would be wrong: the import
barrel registers its adapters while it loads. The plugin never steps over a module that runs code of its own at
load (`runsCodeAtLoad`); a name such a module hands on is imported from it.
`scripts/vite/barrelImports.mjs` (wired by `scripts/vite/packageBarrels.mjs` in both
`vite.config.ts`) rewrites, in a build only, every named import, named re-export and
`const { … } = await import(…)` of a package entry to the module that defines each name; it
follows `export *`, `export { a as b } from` and a module's own re-export of a name it imported.
Tests and the dev server keep the barrels, so `vi.mock("@plainva/core")` still mocks what a test
means. The map is held by `startBundle.test.ts`. This alone took the desktop from 6.11 to 5.13 MB
of script.

**Entries of their own.** `@plainva/core/ai`, `/import` and `/workspace` and `@plainva/ui/ai` are
no longer part of the main entries (aliases in both `vite.config.ts`, `paths` in the
`tsconfig.json`s). What the vault needs without the AI moved out of `core/src/ai/`:
`withholding/` (the reader's view and the withholding of links the index uses),
`proposals/properties.ts` and `proposals/authors.ts` (suggested properties and machine authors —
note format), `noteAiRules.ts` (the two dimensions of a note's AI rule).

**The AI loads when its switch is on.** `packages/ui/src/aiPorts/` holds what a surface of the
start needs to know of the AI without the harness: its switch (`aiSwitchOf`, the harness's own rule,
held by a test), the session loader (`createAiSessionLoader`, `ensureAiIfOn`), the session and
model contexts, the doors at a picture and a voice note, the counts of related notes and hints, the
comment thread's door, and `aiComponent(name)`, which draws a component of the harness once it is
loaded and nothing before. Nothing in `aiPorts/` imports a value from `ai/` (`startBundle.test.ts`).
Each shell has a loader (`desktopAiLoader.ts`, `mobileAiLoader.ts`) and a host that runs the AI's
hooks as before and reports them up (`DesktopAiHost`, `MobileAiHost`): mounted at the start when the
switch is on, or when a surface of the AI opens (its settings, its tab), and until then the shell
reads an AI that is off. The phone's directory for the system assistant follows the switch through
the loader instead of loading the AI.

**What loads on demand.** Desktop: the AI's host and its surfaces, the database viewer (also
embedded), the import wizard, the local graph of the right column, the cloud setup and the template
catalogue of the start screen, the PIM runtime, the providers' sync targets and engine, the
encrypted workspace, the send queue, the accounts' actions, the document icon set, CodeMirror's
"Select all" for the context menu. Phone: every screen but the navigator, a note and a folder's
list, the AI and its sheets, the sync service's engine and targets, the calendar targets, the
encrypted workspace's runtime, the IMAP/SMTP transport (`createLazySocketMailTransport`, whose
methods a test holds against the socket transport's), the template catalogue, the emoji picker and
the note's local graph.

**One KaTeX — a visible correction.** mermaid, rehype-katex and micromark-extension-math asked for KaTeX 0.16
beside the app's 0.19, and both copies (about 500 KB each) were built. `pnpm.overrides` in the root `package.json`
keeps one (0.19.1); their use is `renderToString`, which 0.19 keeps. This is not "nothing changes": KaTeX 0.17
prefixed thirteen classes of its markup with `katex-` (`base`, `strut`, `sizing`, `root`, `accent`, `stretchy`,
`overlay`, `vbox`, `thinbox`, `inner`, `fix`, `tag`, `hline`), and the style sheet the app ships has always been
0.19's (`MarkdownReader.tsx` imports `katex/dist/katex.min.css`). Before, the reading view (rehype-katex) and
mermaid's labels drew 0.16 markup under 0.19's style sheet — formulas set with the old classes the style sheet no
longer styled; now markup and style sheet are one version. Apart from that rename the two versions agree:
`apps/desktop/src/katexVersions.test.ts` renders a corpus of formulas — and formulas that cannot be read — in every
way the app does (reading view with its fallback, the editor's preview, mermaid in `htmlAndMathml` and `mathml`, the
error messages) with both versions and fails on any other difference; the review's comparison over 142 formulas
from the test vaults found the same.

**Locale files: one per language, as before.** L5 first cut each language into areas (`ai`, `settings`, `mail`,
the rest) at build time, loaded beside the core. The second review measured what that brought: nothing. The locale
files were never part of the static start (they load with `i18nReady`, before the first picture, and the gate does
not count them), all areas arrived in the same millisecond as the core, and a start that waits for all of them —
which a message the start puts up needs — waits just as long. What was left was four requests instead of one, a
build plugin, a second error mode (an area that never loads: the app starts a second later and the settings read
raw keys) and special handling of missing keys. So the split is gone: one file per language, as on `main`. The
fault the special handling caused stays fixed: a call with a default text (`t(key, { defaultValue })`,
`t(key, "…")`) reads its default when the key is missing — i18next's own behaviour again, held over every such call
in the sources by `i18nDefaults.test.ts`.

**Ways to keep it.** A part loads through `lazyPart` (`packages/ui/src/lib/lazyPart.ts`): one
component per loader, drawn at once once it was loaded ahead, and a failed load is shown by the
part's `AreaBoundary` and loaded again on the next mount, never in a loop. Each shell declares its
parts with `deferredPart` (`apps/<shell>/src/lib/deferredParts.ts`), which asks `lazyPart` where the
part renders, so no shared function runs at module load (moduleInitBoundary.test.ts). A part marked
`prefetch` (the phone's frequent screens, the desktop's database viewer and local graph — never a
part of the AI) is loaded while the app idles after the start. What these loads carry is measured by the gate as
"shortly after the start" (below), so a part loaded ahead cannot bring the AI with it unnoticed.

**What is written never depends on whether a chunk has loaded** (review of L5, round 2). A part loaded on demand may
draw less until it is there — never write, index, queue or send something else. Every place L5 turned from static
to loaded on demand that has an answer of its own until the load:

| Place | Until the load | Why it cannot reach a file, the index, a queue or a request |
|---|---|---|
| The suggestion mode's word diff (`suggestMode.ts`) | the marks and the count drawn as one stretch | the chunks a proposal is made of come from the word diff only: `suggestionChunks` throws without it, `session.suggestion()` waits for it (and tries a failed load again) — `suggestModeDiffLoad.test.ts` |
| A component of the harness (`aiComponent`, `deferredAiPart`) | draws nothing | a drawing; nothing of the AI acts while its module is not there |
| The provider's name at a database (`useBaseAi`) | the provider's id | shown in the plan only; a run is the session's (`fillProperty`) |
| The columns a run fills, a filter in words (`BaseViewer`, `BaseConfigPanel`, the phone's twins) | none offered | no door is drawn; the panels read the harness through `useAiModule`, so they draw again when it arrives |
| The AI's session in the start (`desktopAiLoader`, `mobileAiLoader`) | `null`: what a window without the AI sees | every surface of the AI that opens asks for the session itself (the desktop's tab, the phone's AI screens); a routine, a confirmation, a write of the AI exist only in a session |
| The switch at the phone's settings row (`SettingsScreen`) | an empty summary | a drawing |
| A parked suggestion's block count on the phone (`NoteScreen`) | 0 in the banner | a drawing; resuming waits for the reconcile |

The rest waits: the sync's and the workspace's modules, the mail transport, the PIM service, the intent directory's
policy and the note's mail actions are awaited before their first use.

**First use of a part loaded on demand** (this machine, headless Chromium, the chunk and the imports
it adds, over a local server; median of 5): desktop AI host 110 ms, database viewer 110 ms, local
graph 70 ms, import wizard 69 ms, cloud setup 90 ms; phone AI host 113 ms, tasks 65 ms, today 71 ms,
calendar 58 ms, settings 108 ms, database 52 ms, search 106 ms. A part marked `prefetch` and loaded
in the idle time draws without that wait (`lazyPart.test.tsx`).

**Offline, and never empty.** Every lazily loaded part is a chunk of the app's own bundle.
`e2e-prod/chunk-load.spec.ts` (both shells) loads each chunk on its own with every other host refused.
`apps/desktop/e2e/offline-surfaces.spec.ts` opens every surface of the desktop — the ribbon's views, a database, the
settings page by page, the palette, the import wizard, the quick switcher, and the AI's tab as a restart restores it
with the AI switched off — and `apps/mobile/e2e-prod/offline-screens.spec.ts` every screen the phone's navigation
restores, both with every other origin refused. They fail on a failed area, a failed bundle file, a script or style
sheet from another host — and on a surface that stands empty (review of L5: the desktop's AI tab, restored with the
AI off, drew nothing; it now asks for the session itself, as the phone's AI screens do).

**Shortly after the start, the AI switched off.** The gate opens each built bundle in a browser
(`scripts/perf/afterStart.mjs`: the desktop over the vault fixture of the menu tests, the phone over Capacitor's web
plugins) and waits until no file is asked for: what loads then without anyone doing anything — the parts loaded
ahead, what the start asks for after its first picture — is counted apart from the start, and the `mustNotStart`
families may not be among it either. Two surfaces of the start loaded the harness that way (review of L5): the
phone's system-assistant directory imported the AI's policy at the start, and the database viewer, which the
desktop loads ahead, imported the column-fill helpers. The policy now loads when the directory is built (only while
the AI is on); the database's AI parts moved into the harness (`ai/baseAiParts.tsx`, drawn through `aiComponent`),
and no database, search or settings screen of the phone makes the session any more (`useMobileAiSession`). Opening
a surface loads no code of the AI either (review of L5, round 2): the phone's search draws its meaning-search parts
through `aiComponent`, and the desktop's settings mount the two AI pages — and load their code — the first time one
of them is shown, not with the dialog (which loaded 222 modules of the AI before). The gate measures only the start
and the moment after it, not the surfaces (follow-up in the maintainer's plan).

**The build plugin, by the parser.** `barrelImports.mjs` reads every module with the parser the build uses (oxc,
through Vite), not by text: an import inside a string, a template or a comment stays as it is, and a string that
looks like a comment cannot hide the exports after it. An entry with an import for its effect alone is never
stepped over. A form it cannot place — an import of a name two `export *` hand on from different modules (a name
an entry shadows is fine, as in the language), a name exported twice, `export =`, a module that does not parse —
stops the build with the file and the reason. A module the entries reach only through their re-exports now runs only
where something imports a name from it: `barrelLoadCode.test.ts` lists every such module that runs code at load
(a statement, an import for its effect, an initializer that registers, installs, subscribes or touches a global)
with why skipping it is safe, and fails on a new one. `barrelImports.test.ts` holds each input form;
`barrelBindings.test.ts` binds every value export of all seven entries (over 5 000) through the type checker and
fails where the plugin's target is another declaration than the entry's. The gate fails when a source module stands
in more than one chunk of a build (it would run twice, with two copies of its state).

**What is left over the budget.** Measured from the source maps of the start files (source characters, not bytes):
on both shells React (~560 KB), the core's vault, index and query service, YAML and zod (frontmatter), the encrypted
workspace (~420–660 KB, still reached through `encryptedRemoteGate.ts` at the vault's open on the desktop and
through the workspace lock of the phone's widgets), the sync's folder identities (`syncStateBinding.ts` reads them
from the target modules) and the PIM cache; on the desktop the mail module's text and sanitising and
`@codemirror/merge` (the desktop's editor reconciles a parked suggestion at the open, `suggestionPark.ts`). On the phone
the note editor is part of the start by design (a note is one of the three screens that stay), with CodeMirror, its
Markdown and the embedded HTML/CSS/JavaScript grammars; `@codemirror/merge` and parse5 are out of its start since
the review round (the suggestion mode loads its word diff with the mode; the attachment MIME table and the base64
helpers stand apart from the mail text). The next steps, after the vault's close path of B2: the workspace's
document hashing apart from its signing, the folder identities apart from the targets, the workspace lock and status
apart from the workspace's runtime on the phone.

## Start bundle, second pass (B1b), 2026-11-27

From the bundle gate against `main` at `e008c1467` (start bytes; "shortly after" with the AI off, as above):

| Shell | | Start | Shortly after | Together |
|---|---|---|---|---|
| Desktop | before | 4 017 810 | 1 660 740 | 5 678 550 |
| Desktop | after | 3 879 896 | 1 752 289 | 5 632 185 |
| Phone | before | 4 483 509 | 910 923 | 5 394 432 |
| Phone | after | 4 074 534 | 950 685 | 5 025 219 |

The numbers are CI's (`perf-bundle.json` of the Performance runs `46036946654` and `46067248094`); a run on a
machine measures the same since the browser's language is fixed (below; the start differs by 3 bytes, the paths of the
build folder).

**What the gate measured before.** `afterStart.mjs` opened the bundle in a browser with the machine's language. On a
German machine the app loaded its German locale file (465 942 bytes) and date-fns' German locale (7 517) beside the
English ones; CI runs in English and never loads them. The baselines of "shortly after" were recorded on such a
machine (since L5, 2026-11-25), so they stood 0.47 MB above what CI measured, and CI's check of "shortly after" let
that much growth through without failing — a branch that was red on the machine was green in CI. The two lists of
files were otherwise the same by name. The page's language is now `en-US` on every machine, and the baselines are
recorded anew; CI's and a machine's run agree to the byte for "shortly after".

**Every language but English loads its locale file on top of the English one**, which stays as the fallback: German
adds 465 942 bytes (and date-fns' German locale, 7 517), so a German desktop loads 2.23 MB shortly after the start
and a German phone 1.42 MB. The gate measures English, the cheapest case; the other languages' files differ in size.

**How it was measured.** A build with a plugin that dumps each chunk's modules and the static module graph, then the
dominator tree of the start's modules from `main.tsx`: a module's "retained" size is what would leave the start if
its import(s) were made dynamic. That finds the cheap cases — a small import that holds a large module in the start.

**The desktop's editor is part of its start, by decision** (maintainer, 2026-11-27, as on the phone). It was there by
accident: Vite's preload helper (`\0vite/preload-helper.js`, which every `import()` needs) was taken into the vendor
group `editor` — a group takes in what its modules depend on, and `@codemirror/language-data` loads the languages by
`import()` —, so every `import()` of the start imported the whole of CodeMirror (675 KB) for 3.5 KB. Taken out, the
editor merely loaded a moment later (the gate's vault opens a note) and the first editable note waited one request
longer. Now `language-data` stands outside the group and `scripts/vite/editorInStart.mjs` names the `editor` chunk in
`index.html` as a `modulepreload`; `mustStart` in the gate's baseline fails a build whose start lacks CodeMirror.

**Out of the start.** Both shells: the sync targets' folder identities stand in `core/src/sync/targetIdentities.ts`,
apart from the targets (the vault's open compares them; reading them from the targets carried every target and
fast-xml-parser into the start). Desktop: S3 and WebDAV load at the open only for a vault that uses one
(`services/syncXmlTargets.ts`); the emoji catalogue of the `:name` completion loads with the first `:name` (both
shells, `editorTriggers.ts`). Phone: the note's context sheet (loads with its first opening), the ```tasks block's
view (with the first block), the settings search's highlight (with a search hit), the workspace migration and its
worker (when a setup is activated or resumed).

**What loads ahead on the phone, and why.** The context sheet loads ahead in the idle time, like the frequent screens:
it is opened often, and its first opening should not wait. The ```tasks block's view loads with the first block a note
shows (a block is rare, and the note around it draws at once). The emoji catalogue loads with the first `:name` typed
(the list follows the typing anyway). The settings search's highlight loads with a hit (the page it opens draws at
once; only the mark follows). The workspace migration loads when a setup is activated or resumed (rare, and the step
shows its progress). S3 and WebDAV still load with every phone vault that syncs: the phone's account password check
(`apps/mobile/src/services/accountPassword.ts`) builds those targets statically, and the phone's sync service loads
all targets together; bringing that apart is left for the next pass (the result for the person is the same).

**Why "shortly after" grew.** The desktop's CalDAV calendar target reads XML too; it found the parser in the start
before and brings it along now, and the gate's vault has a calendar account (+92 KB with fast-xml-parser and
its helpers, loaded after the first picture instead of before it). On the phone, building blocks the moved parts shared
with screens that load ahead in the idle time (the tasks and today screens) moved into those screens' chunks (+40 KB).
Both are bytes after the first picture rather than before it, not copies: the gate finds no module in two chunks
of either build. The maintainer decided (2026-11-27) that "shortly after" may grow by what leaves the start: its
baseline is recorded anew, and the gate holds the sum of start and shortly after per shell instead (`growth` over the
baselines' sum; in CI desktop 5 678 550 → 5 632 185, phone 5 394 432 → 5 025 219 against `main`).

**Why three candidates stay.** zod checks the parsed note (`core/src/markdown-ast.ts`, `metadata.ts`) on every
note the index reads, and the index reads at the vault's open. The right column's sections draw in the first picture
whenever the column is open, which a restored layout is. The desktop's settings profile, with the account repair,
runs at the vault's open (`repairDesktopAccounts` in `settingsProfile.ts`).

**What is left** (source size before minifying, the file is about 0.55 of it): both shells React (~540 KB), the
editor with its Markdown/HTML/CSS/JavaScript grammars (desktop 675 KB file; phone ~950 KB source, by decision), YAML
(~190 KB) and zod (~190 KB, through `core/src/markdown-ast.ts` and `metadata.ts`; replacing it is a package of its
own), the vault, index and query service; on the desktop the right column's sections (databases ~86 KB, journal ~52 KB,
calendar ~45 KB source) and the settings profile (~110 KB with the account repair); on the phone the encrypted
workspace's lock and runtime (`mobileWorkspaceSecurity.ts` without the migration, ~150 KB).

**A load that fails or hangs** (the rest of L5). Every component loaded on demand goes through `lazyPart`, and it
through `loadPart` (`packages/ui/src/lib/partLoad.ts`): a load that has not settled after 20 s
(`PART_LOAD_TIMEOUT_MS`) fails, and a failed one is a `PartLoadError`. The part's own `AreaBoundary` shows either as "This area
could not be loaded" with its reload (never the app-wide boundary); `errorText` says the same sentence for a `PartLoadError` and for the browsers'
own messages ("Failed to fetch dynamically imported module …"), so a load that did not go through `loadPart` is
still said in the app's words. The suggestion mode's word diff loads through it, so a send that waits for it ends.
The desktop's 40 components behind React's bare `lazy` — which kept a failed load for ever — are `deferredPart`s now,
as the phone's were; `apps/desktop/src/partLoad.test.tsx` fails on any `lazy(` in the sources.
