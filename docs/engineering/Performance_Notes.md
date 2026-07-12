# Performance Notes (Measurement Guide)

Last reviewed: 2026-07-05 (internal planning document, maintainer workspace — P2)

This document records WHAT is measured against (budgets from an internal planning document, maintainer workspace, §4.3), HOW it is measured (synthetic test vaults + fixed measurement points), and which structural changes the P2 sprint introduced. The maintainer will add native measurements after the first runs.

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

## Generating test vaults

```powershell
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-1k 1000
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-5k 5000
node scripts/gen-test-vault.mjs C:/tmp/plainva-vault-20k 20000
```

Deterministically seeded (comparable runs): ~sqrt(n) folders, OKF frontmatter, ~5 wiki links per note, tags, date property, a few `.base` files.

## Measurement points

1. **Initial index**: open the vault for the first time; time until the loading bar disappears (console: `[VaultContext] ...` timestamps). Expectation for 5k: under 60 s (budget), target well below that.
2. **Watcher tick after save**: change a large note, save it; the console now shows `vault watcher detected changes [path]` followed by the incremental update — NO full reindex progress should run anymore.
3. **No-op sync tick**: WebDAV vault, 15 s tick with an unchanged remote; observe DevTools network/IPC activity. Expectation: 1 `sync_state` query instead of one per file.
4. **File switch with the right sidebar open** (context graph + backlinks open): time until both sections have settled. A second switch to the same/another file without an edit = graph cache hit.
5. **Base with 2.000 rows**: opening + scrolling + saving a note OUTSIDE the source (must no longer reload the base, provided there are no tag sources/relations).
6. **Search**: typing in the sidebar with 5k notes; results < 200 ms (FTS with LIMIT 50).

## Structural changes from the P2 sprint (2026-07-05)

- **Indexes**: `links(source_id)`, `properties(file_id)` (eliminates CASCADE full scans on every save), `files(title COLLATE NOCASE)` (wiki link resolution without a table scan).
- **Indexer bulk pass**: 3 upfront SELECTs per file replaced with 3 queries per RUN; links/tags/properties as multi-row INSERTs (chunk size 150); deletions as IN batches. Order of magnitude for a 10k vault: from ~150-400k down to ~40-80k IPC roundtrips; the optional Rust bulk command (a real transaction) remains a follow-up option if the native measurement still needs it.
- **Incremental watcher**: event paths are indexed individually (`VaultIndexer.indexPath`); folder cases and floods (>50 paths) fall back to a full scan. Pure echoes (unchanged mtime) no longer trigger a re-render.
- **Sync tick**: `SyncStateRepository.getAllStates()` loads the state once per cycle (previously 1 SELECT per remote file every 15 s); `base_text` is deliberately left out (a conflict case loads it specifically).
- **Link resolver corpus index**: `buildLinkTargetIndex` + `resolveLinkTargetIndexed` make graph load, backlinks, and reverse columns O(links) instead of O(links × files). (Follow-up 2026-07-06: `GraphService.loadGraph` initially did NOT use the index — it still did a single-shot resolve per link row; since the follow-up package, loadGraph builds the index once per run, and likewise `convertWikilinksToMarkdownLinks` once per document.)
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
60 s budget outright (151 s), so the Rust bulk-insert command (real SQL
transaction instead of the JS mutex) is now a REQUIRED follow-up, no longer
just designated.** The `large` profile (5k deliberately huge notes) is an
extreme stress case, not a realistic vault: cold indexing balloons to ~15 min
(FTS insert cost scales with content bytes), a single changed huge file costs
~350 ms to re-index (async after save — acceptable), and the PHRASE search
"quick brown" hits 644 ms (term searches stay ≤5 ms). If real vaults with
many megabyte-sized notes show up, phrase-search cost and per-file FTS
chunking join the bulk-insert follow-up. JSON outputs live in the maintainer
workspace scratchpad; re-run via
`pnpm --filter @plainva/core run benchmark -- --files 20000 --runs 3`.

## Native measurements (maintainer, to be added)

| Measurement point | 1k | 5k | 20k | Date/Build |
|---|---|---|---|---|
| Initial index | | | | |
| Watcher tick after save | | | | |
| No-op sync tick | | | | |
| File switch (sidebar open) | | | | |
| Search (typing -> result) | | | | |

Open follow-up candidates after measurement: Rust bulk insert command with a real transaction (the JS `transaction()` is just a mutex), base view virtualization (from ~1-2k rows), graph layout chunking/worker (>2-3k visible nodes), FTS contentless (index DB size).

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
