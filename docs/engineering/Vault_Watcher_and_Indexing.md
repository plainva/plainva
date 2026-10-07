# Vault watcher and indexing

How a change on disk reaches the index, what makes the app walk the whole vault, and why neither may ever hold up typing. Written with issue #122 ("Saving makes typing really hard", Windows, 0.8.4); issue #110 (files moved outside Plainva, macOS) is the reason the watcher reports every path.

The rule behind all of it: **performance comes first — typing must never stall.** A reconcile of the index is background work. It may take its time; it may not take the UI thread, and when it finds nothing changed it may not make anything reload.

## The way of a change (desktop)

```
notify (ReadDirectoryChangesW / FSEvents / inotify)
  └─ vault_watch.rs      classify: create | modify | remove | rename | any | rescan | error
                         gathered for 150 ms, every path of every event kept (issue #110);
                         events of the app's own temp file dropped
      └─ mapNativeWatchBatch (TauriVaultAdapter.ts)   absolute → vault-relative; what cannot be
                                                      attributed becomes the rescan marker
          └─ createWatchBatchCollector (watchBatch.ts) the 1 s debounce window: per path the
                                                       STRONGEST kind; internal paths dropped
              └─ createIncrementalIndexQueue           one batch at a time; per path
                  └─ VaultIndexer.inspectPath          indexed | removed | unchanged |
                                                       directory | folder-gone
                  └─ VaultIndexer.reconcileFolder      a flat look at one folder
                  └─ VaultIndexer.indexVaultFull       the full scan — only when escalated
                      └─ onBatchDone → version bumps   only for what actually changed
```

The phone has no watcher. Nothing there scans because of a save; the full scan runs when a vault opens, on the return to the app (at most once a minute), on pull-to-refresh and after folder operations.

## What the watcher really reports

The event KIND is what separates a harmless report from a structural one, and it used to be thrown away on the way to the queue (only paths and a `moved` set arrived). The kinds per platform, for the three cases that matter:

| Case | Windows (ReadDirectoryChangesW) | Linux (inotify) | macOS (FSEvents) |
|---|---|---|---|
| The app's own save of `Sub/note.md` (temp file beside the note, renamed over it) | modify `Sub` · create + modify temp · modify `Sub` · remove `note.md` · modify `Sub` · rename `note.md` — **the parent folder three times** | create + modify temp · rename temp → note (paired or as two halves) — no folder event | rename events for temp and note, each on its own path — no folder event expected |
| Another program writes one file in place | modify file (once or more) | modify file | modify file |
| Another program creates a file in `Sub` | create + modify file · modify `Sub` | create + modify file | create (+ modify) file |

Windows was measured on this code base with the watcher's own filter (`notify` 8.2; the filter includes `LAST_WRITE` and `ATTRIBUTES`). A save in the vault ROOT reports no folder — the root's own events are dropped (`""`). The Linux and macOS columns follow the `notify` backends' documented behaviour and the cases pinned in `vault_watch.rs`; they were not re-measured for #122.

**A vault inside a cloud-files folder (OneDrive)** adds a second wave: seconds after a save the sync client updates the file's sync state and attributes, and — because the filter includes attribute changes — the note and the folders above it are reported as modified again. Nothing was created, renamed or removed, and no modification time moved. These later echoes are handled exactly like the first one: the note's row has the same mtime (`unchanged`), each folder gets a flat look that finds nothing, and nothing is bumped.

## What escalates to a full scan, and why

A batch is indexed path by path. It gives up on that and runs `indexVaultFull()` for exactly these reasons (`EscalationReason` in `incrementalIndexQueue.ts`); each writes a diagnostics line:

| Reason | What triggers it | Why it stays |
|---|---|---|
| `rescan requested` | The rescan marker: the watcher reported lost events or an error, the native side folded more than 2 000 changes into one request, or an event named a path outside every known root. | The watcher itself says it no longer knows what changed. Slower, never wrong. |
| `batch above the limit` | More than 50 paths in one batch (a `git checkout`, a first sync). | Fifty per-path inspections cost more round-trips than one walk. |
| `folder created or renamed` | A path that is a folder and was created, renamed, moved in, reported without a kind, or enqueued by a caller that knows no event (a sync pull). | Many paths changed under one name; only the folder's own event announces them. |
| `folder removed or moved away` | A vanished path with indexed files still below it; or a removed file whose parent folder is gone too. | The full scan purges the rows and reports **every** deletion to the sync layer. Data safety: this is not to be approximated. |
| `path could not be indexed` | One path failed twice, or a folder reconcile failed. | The fail-safe. |

What no longer escalates (issue #122):

- **A folder that was only modified.** `inspectPath` answers `directory`; the queue knows the path carried nothing but `modify` events and reconciles that one folder flat (`reconcileFolder(folder, { recursive: false })`). A flat look that finds the folder as the index knows it writes nothing and bumps nothing. A folder that was modified AND created/renamed/removed in the same window counts as the stronger kind.
- **The app's own temp file.** `.plainva-tmp-…` is an internal path (`internalPath.ts`): dropped in the watcher (Rust), in the collector, in `inspectPath` before any disk probe or query, and by both vault walkers. A leftover after a hard kill is never indexed; one that an older version indexed leaves the index without being reported as a deletion. A user's own dot-file (`.env-notes.md`) is not affected — the rule is the prefix, not the dot.
- **A path that fails once.** A file another program still holds open, or one that vanished between the look and the read, is tried again 1.5 s later before anything escalates. A full scan would have met the same file.

What was looked at and left as it is:

- The limit of 50 counts folder paths too, so thirty files written into thirty folders by another program still become one full scan. That is the limit doing its job; the scan it buys is now cheap.
- A folder created, renamed or moved by the app itself is reported like any other and runs a full scan. It usually finds nothing left to index; the folder list differs from the last scan, so the tree is told once more.
- On Linux and macOS an EMPTY folder deleted outside the app sends an event for the folder that the index has no row for (`unchanged`); the tree drops it on the next refresh. On Windows the parent's `modify` leads to a flat look, which notices (see `foldersChanged` below).

## The internal-path rules are data

`INTERNAL_PATH_RULES` (`packages/core/src/vault/internalPath.ts`) is the one list of what is never indexed, listed or synced: four generic matchers (exact, exact ignoring case, prefix, leading-dot-and-suffix). The native walk does not carry a copy — it receives the rules with every call. A folder skipped natively but not by the frontend would look like a mass deletion to the index and to sync, so there must not be two lists. `internalPathRules.fixture.json` pins the rules and a list of verdicts; the core unit test and the Rust test both read that file.

## A full scan that does not block

Even a justified full scan — a first sync, many external changes, F5, the automatic refresh on window focus — runs while somebody may be typing.

1. **The walk is one native call** (`vault_walk.rs`, command `vault_walk`). The frontend walker cost two IPC round-trips per folder; a vault with a few thousand folders meant thousands of round-trips per scan, and the file tree repeated the walk after every structural bump. The native walk runs on blocking worker threads (eight directory reads in flight, for network shares), follows the frontend walker's rules exactly — links followed, loops cut by identity where the platform has one and by the depth cap everywhere, unreadable folders and entries reported, internal folders not entered, start folder resolved through the same root registry as every checked read — and returns once, entries as compact tuples. It can be cancelled when the vault closes. It never opens or reads a file: sizes and times come from the directory listing, so a placeholder in a cloud-files folder is not downloaded by a walk. Hosts without the command (browser fixtures, the E2E mock) keep the frontend walker.
2. **The loops let go.** Comparing the listing with the index is synchronous work over every file. Each loop yields once it has run for about a frame (`createYielder`, core) — on the desktop and on the phone, which share the indexer. `isAppleDoubleOnDisk` only ever looks at names of the `._*` shape and caches its verdicts; no other file is read by an unchanged scan.
3. **The scan says what it changed.** `IndexScanReport` carries `walked`, the three counts and `foldersChanged` (the set of folders on disk against what the previous scan of this indexer saw; `true` on the first scan). A flat folder reconcile keeps that set current and reports `foldersChanged` for its own level.
4. **Only what changed reloads.** A changed folder list bumps the tree's structure; changed files bump the file version; a scan that found the vault as it was bumps nothing. That holds for the queue's scans and for the automatic refresh (window focus, the interval net; on the phone the return to the app, which no longer announces `m-vault-changed` for an unchanged vault). A refresh somebody asked for (F5, the tree's button, pull-to-refresh) still redraws everything.

## Diagnostics

Full scans used to leave no trace, so a user could not show us this problem. Both shells now write, under the source `index` (counts and tokens only — no file names, no paths, no vault name):

```
batch of 2 path(s) from watcher escalated to a full scan: folder created or renamed
full scan (watcher: folder created or renamed): 20120 files walked in 412 ms — 2 added, 0 changed, 0 removed, folders changed
full scan (automatic refresh): 20120 files walked in 180 ms — nothing changed
```

The trigger is the token the caller of `indexVaultFull(trigger)` passed: `open`, `manual refresh`, `automatic refresh`, `return to the app`, `sync: batch above the limit`, `watcher: rescan requested`, `folder moved in the app`, `index rebuild`, and so on.

## Measuring

The scripts under `apps/desktop/scripts/perf/` make the measurement repeatable (`cdp.mjs` is their shared attachment to the window). They need a dev build running under its OWN identity and port, with the WebView's debugging port open — never the installed app, never port 1420:

```
# a synthetic vault (never inside a real one; the script refuses a folder it did not make)
node apps/desktop/scripts/perf/make-synthetic-vault.mjs <dir>/v20000 20000

# dev server and an isolated build of this checkout
cd apps/desktop && pnpm exec vite --port 1470 --strictPort
cd apps/desktop/src-tauri && TAURI_CONFIG='{"productName":"Plainva Perf","identifier":"com.plainva.desktop.perf","build":{"devUrl":"http://localhost:1470"},"plugins":{"updater":{"endpoints":[]}}}' cargo build
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333" ./target/debug/plainva-desktop.exe

# the walk and an unchanged full scan, both walkers, in the real window
node apps/desktop/scripts/perf/measure-full-scan.mjs <dir>/v20000

# real typing with the vault open: tree expanded, a note four folders deep in the editor
node apps/desktop/scripts/perf/measure-typing.mjs <dir>/v20000 --open
```

`PLAINVA_WALK_BENCH_DIR=<vault> cargo test --release walk_benchmark -- --ignored --nocapture` times the native walk alone.

### Measured (2026-10-07)

One machine: Windows 11, local SSD, a fast desktop CPU, WebView2. An optimized build (`cargo build --release`, same `TAURI_CONFIG`) of this checkout, frontend from the dev server. Synthetic vaults of 5 000 notes (5 994 entries, 951 folders) and 20 000 notes (22 959 entries, 2 792 folders). "Before" is the frontend of the commit this work started from (`4d11416b`), served to the same binary; the native side then merely goes unused.

**Typing in a note four folders deep, 20 000 notes, tree expanded** — 20 s of typing at a character every 150 ms, then 40 s of watching; three rounds each (`measure-typing.mjs`):

| | Before | After |
|---|---|---|
| IPC round-trips in the minute | 10 400 – 23 000 | 75 – 89 |
| Long tasks (> 50 ms) | 2 – 5 per round, the longest 84 – 156 ms | none |
| Longest stall of the UI thread | 150 – 187 ms | 15 – 24 ms |
| Slowest single keystroke | 22 – 72 ms | 13 – 20 ms |
| Full scans caused by the saves | yes — the round-trips above are those walks | none |

**The walk and an unchanged full scan**, median of five (`measure-full-scan.mjs`):

| | 5 000 notes | 20 000 notes |
|---|---|---|
| Frontend walker: walk | 8.9 s, 1 906 IPC round-trips | 25.4 s, 5 586 IPC round-trips |
| Native walk: walk | 34 ms, 3 IPC round-trips | 68 ms, 3 IPC round-trips |
| Unchanged full scan with the native walk | 64 ms, longest stall 17 ms | 161 ms, longest stall 26 ms |

How to read this:

- The frontend walker never held the thread in one piece — its longest stall was about 30 ms. What it did was keep the IPC bridge busy for the length of the walk, and the stalls a person feels came after it: the scan ended by bumping both tree versions, the file tree walked the vault a second time and every view hanging on the versions reloaded. On this machine that was 150 – 190 ms per save at 20 000 notes. A slower machine, a larger vault and a slower disk all stretch it, and every save started the next round.
- **Not measured: a vault inside a OneDrive folder**, which is where the reporter of #122 has his. Listing a cloud-files folder is answered by the sync client and is slower per call, so the old walk hurt most there, and the client's later attribute changes started further scans. The fix removes the scans for both waves; that the client's echo consists of `modify` events only is taken from the event filter and pinned by a unit test, not observed on a real OneDrive folder.
- Not measured either: macOS and Linux (the watcher there reports no folder for a save, so #122 as reported is a Windows behaviour; the native walk and the reload rules apply on all three), and the phone (no watcher; its walk is one bridge call per folder and was not changed — the loops after it, and the reload on return to the app, were).
- A debug build is slower per IPC call but shows the same picture (20 000 notes: frontend walker 35 s, native walk 205 ms).
