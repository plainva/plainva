# Test load

How unit tests stay fast enough that a loaded machine or a slow CI runner does
not turn them red for no reason.

A pre-commit hook runs the affected suites one after another, CI runs all of
them on Linux and Windows runners, and several sessions share one machine. A
test that costs seconds alone costs tens of seconds there. The failures behind
this note (September 2026) were all of that kind: nothing was wrong in the
code, a hook or test ran past its time limit while loading modules or touching
files it did not need.

## Rules

1. **A test loads what it checks.** Importing a package barrel (`@plainva/ui`,
   `@plainva/core`) evaluates the whole package: 15–25 s cold, around 3 s
   warm. A test of one component or helper may import it from its own module
   (`DateJumpPicker.test.tsx`). A service that tests have to boot keeps its
   heavy collaborators out of the module it is tested through —
   `pimRuntime.ts` holds the phone's PIM runtime, `pimService.ts` hands in
   sign-ins and provider clients (`PimRuntimeWiring`); a pin in
   `pimWiring.test.ts` keeps the runtime light.
2. **Setup files import no barrel.** They run in front of every test file of a
   shell. The desktop's setup takes its seams from `@plainva/ui/i18n`;
   `testSetupWeight.test.ts` fails a setup file that imports `@plainva/ui` or
   `@plainva/core`.
3. **Load the subject when the file is collected.** A static import has no time
   limit; `await import()` in a `beforeAll` pays for the module graph under the
   10 s hook limit, in an `it` under the 20 s test limit. Use dynamic imports
   only where the test needs a fresh module (`vi.resetModules`), and keep the
   barrels out of that module's graph with a mock (`WindowControls.test.tsx`).
4. **A render test may replace a barrel with the modules it renders.**
   `CommentsScreen.test.tsx` (phone) and `CommentsOverview.test.tsx` (desktop)
   mock `@plainva/ui` and `@plainva/core` with exactly the real modules the
   screen imports; a new import fails there with vitest's "No … export is
   defined on the mock".
5. **Source-scan guards read through `test-sourceTree.ts`.** Listing the trees
   stays cheap; reading ~1 300 files one by one took 10–26 s under load. The
   helper keeps a snapshot under `node_modules/.cache/plainva-scan-guards` and
   re-reads only files whose size or modification time changed.
6. **Disk only where files are the subject.** A test about a vault's content —
   a template, an index, a database — runs on `MemoryVaultAdapter`
   (`packages/core/test/helpers/memoryVault.ts`), which `memory-vault.test.ts`
   holds to `LocalVaultAdapter`'s answers. A test about files keeps real files
   but repeats a steady state only as often as it proves something: the
   conflict-session, editor-save and phone save tests make twenty saves, not a
   hundred.
7. **No time limit is raised to cover a slow import, scan or disk loop.** Make
   the work cheap instead; a raised limit hides the next one too.

## Measuring

Vitest reports where a file's time goes. A reporter's `onTestRunEnd` gets
`testModule.diagnostic()` with `setupDuration`, `collectDuration`, `duration`
and, with `--experimental.importDurations.limit=<n>`, the slowest imports per
file. Compare before and after in the same conditions, one after the other.

## Failing E2E runs in CI

Playwright records a trace on the first retry of a test. Each desktop config
writes its results into its own folder under `test-results/`, and a CI job
that failed or needed a retry uploads them as the artifact
`playwright-checks-<attempt>` or `playwright-webkit-<attempt>` for seven days.
Open a trace with `npx playwright show-trace <trace.zip>`.
