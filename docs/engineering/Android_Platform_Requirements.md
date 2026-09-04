# Android platform requirements

Status: 2026-09-04. What Google Play and Android require of the mobile app,
when, and which guard in this repository backs each requirement. Re-check the
dates when a new Android version or Play policy lands; the test
`apps/mobile/src/androidPlatformGuards.test.ts` keeps the guards wired.

## The short version

There is **no new limit on app storage** in Android 17. The headlines about
"memory limits" mean RAM. Three things carry dates:

| Requirement | Applies | Deadline | Plainva today | Guard |
|---|---|---|---|---|
| **Target API level.** New builds must target the previous year's Android. | Play, all apps | API 36 since **2026-08-31**; API 37 expected from **2027-08-31** | `targetSdkVersion = 36` (`apps/mobile/android/variables.gradle`) | `androidPlatformGuards.test.ts` (floor 36) |
| **16 KB page size.** Every native library must be LOAD-aligned to 16 KB. | Play, apps targeting API 35+ on 64-bit devices | Updates since 2026-05; **hard block on upload from 2027-02-01** | Two native libraries in the bundle, both 16 KB-aligned (first run of the guard, 2026-09-04): `libsqlcipher.so` (`net.zetetic:sqlcipher-android` 4.17.0 via `@capacitor-community/sqlite`, 16 KB-aware since 4.6.1) and `libimage_processing_util_jni.so` (AndroidX camera, via the Capacitor camera plugin) | Workflow step **Check 16 KB page alignment of native libraries** in `.github/workflows/release-mobile.yml`, before the Play upload |
| **Per-app memory limit** ("Memory Limiter"). An app over its RAM budget is squeezed into zRAM, then killed. | Android 17 devices (Pixel first, other OEMs over the year); Play vitals from **2026-11**, stricter Play requirements from **2027-02** | rolling | Not measured yet (see below) | `ProcessExitPlugin` records a limiter kill in the sync diagnostics |

## Per-app memory limit

AOSP's Memory Limiter enforces cgroup `memory.high` / `memory.swap.max` per app
UID. The budgets by device RAM (visible / not visible):

| Device RAM | Visible | Background |
|---|---|---|
| 4 GB | 2 048 MiB | 1 024 MiB |
| 6 GB | 4 096 MiB | 2 048 MiB |
| 8 GB | 5 120 MiB | 3 072 MiB |
| 12 GB | 8 192 MiB | 4 096 MiB |
| 16 GB | 10 240 MiB | 5 120 MiB |

A WebView app the size of Plainva normally sits far below these. The risk is
not the budget but a **leak over hours** — a long sync session, a graph left
open, a search index rebuilt repeatedly. Two things follow:

1. **Measure** on a phone with the large test vault:
   `adb shell dumpsys meminfo com.plainva.app` at start, after a full-text
   search, after opening the graph, after 30 minutes of background sync.
   Record `TOTAL PSS` per point in the plan of record. Expect no upward drift.
2. **Know when it happened.** `ProcessExitPlugin` (Android 11+) reads
   `ActivityManager.getHistoricalProcessExitReasons` on every start;
   `services/processExits.ts` classifies the exits (the limiter names itself
   as `MemoryLimiter:AnonSwap` in the description; low memory, excessive
   resource use, crashes and ANRs are kept too) and the sync diagnostics screen
   lists them under "Ended by the system". A day without an entry is half the
   proof that the app stays inside its budget; the measurement is the other
   half.

Sources: AOSP "Memory Limiter" (source.android.com/docs/core/perf/memory-limiter),
Android Developers Blog "Preparing your app for broader memory limits" (2026-08).

## 16 KB page size

Native libraries compiled for 4 KB pages fail to load on 16 KB devices; Play
refuses uploads without 16 KB support from 2027-02-01. The bundle currently
carries two native libraries — SQLCipher for Android (through
`@capacitor-community/sqlite`, 16 KB-aligned since 4.6.1) and AndroidX's
image-processing JNI (through the Capacitor camera plugin) — and the guard's
first run (2026-09-04, `mobile-v0.8.0.2`) found every LOAD segment of both at
`0x4000`. The workflow step unpacks the AAB, runs `readelf -lW` on
every `.so` and fails the job when any `LOAD` segment is aligned below
`0x4000` (16384). It runs before the Play upload, so a dependency bump that
regresses this never reaches the internal track.

Sources: developer.android.com/guide/practices/page-sizes;
Android Developers Blog "Prepare your apps for Google Play's 16 KB page size
compatibility requirement" (2025-05).

## Target API level

Play requires new apps and updates to target the previous year's Android
(API 36 since 2026-08-31, extension to 1 November on request). Moving to API
37 (Android 17) is a deliberate step, not a version bump: apps targeting 37
get a hard cap on RemoteViews/widget bitmap memory
(`1.5 × screen width × screen height × 4` bytes, fatal on overflow). Plainva has
no widget today; the cap becomes relevant the day one is added.

## Where the app stores data (for the record)

- Vault, index, drafts and journals: `Directory.Data` (app-private).
- ZIP backups and the recovery file: `Directory.Documents` (visible to the
  user; retention is by count — see the maintainer's open point C25 on the
  empty `readdir` after a reinstall).
- Share staging and exports: `Directory.Cache` (the system may clear it).
- External vault folders: Storage Access Framework tree grants, outside the
  sandbox (`VaultFolderPlugin`).

None of these is subject to a new quota in Android 17.
