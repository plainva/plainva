# Screenshot captures

Two tools photograph the app so that a change to the interface can be judged against the state before it: the phone baseline and the desktop walk. Both run in a browser against test doubles, never on a device, and both write into a folder that git ignores. The pictures are a review aid, not a test: what a picture shows still has to be read, and what it cannot show is listed at the end.

## Phone: `apps/mobile/scripts/screenshot-baseline.mjs`

Serves the production bundle and photographs every surface in its catalog, per theme. The app runs with a real SQLite index over a bridge (`screenshot-fixture.mjs`), a seeded fixture vault, a fixed wall clock (2026-08-02 09:00 UTC) and a local mail fixture; nothing leaves localhost. Every surface names a selector its subject must render (`requires`), so a picture of the wrong screen fails instead of passing.

```sh
cd apps/mobile
npx vite build --mode e2e
npx vite preview --port 1474 --strictPort &           # any free port except 1420, 1430, 1440
node scripts/screenshot-baseline.mjs --base-url http://localhost:1474/ --out screenshots/before --themes light,dark --lang en --viewport 390x844
```

Useful options (`--help` is the comment at the top of the script):

- `--only home,calendar-agenda` picks surfaces; `--themes light,dark,nord,lcars,win95`.
- `--viewport 360x740`, `--tablet`, `--tablet-landscape`, `--landscape` change the window; the window class (phone, rail, two columns) follows from the width.
- `--lang de|en` sets the UI language and the browser locale.
- `--surfaces <file.mjs>` adds a round's own walks without forking the script. The module's default export receives `{ area, settingsArea, AREAS_SWITCH, SETTINGS_BTN }` and returns surfaces; steps can click, fill, press a key, scroll, evaluate and take intermediate photos (`{ shot: "open" }` → `<surface>__open.png`).
- Without `--base-url` the script builds and serves the bundle itself on `--port` (default 1441).

A failed surface leaves `<surface>.FAIL.png` — the picture of what was on screen is the diagnosis. `report.json` records the run's viewport, language and what the index held.

## Desktop: `apps/desktop/e2e-screenshots/walk.spec.ts`

Walks the desktop shell scene by scene in Chromium against the Tauri double of the E2E suite, in light and dark (`playwright.screenshots.config.ts`). The doubles are read from the specs themselves at run time (`specMocks.ts`: the first `page.addInitScript` of a spec's `beforeEach`, or of a named helper), so the walk always photographs the double the suite tests against. The main scene adds a richer vault (`reviewVault.ts`). The walk runs on the suite's fixed test clock (`e2e/fixtures/clockedTest.ts`), so two walks of one commit photograph the same day.

```sh
cd apps/desktop
npx vite --port 1464 --strictPort &                   # never 1420 (E2E) or 1440 (isolated dev)
E2E_BASE_URL=http://localhost:1464 PLAINVA_SHOTS_DIR=screenshots/before npx playwright test --config playwright.screenshots.config.ts
```

`PLAINVA_SCENES=main,mail` picks scenes (main, ai, firstrun, whatsnew, mail, cal, base); `--project light` or `--project dark` picks a scheme. A step the walk cannot reach is logged as `SKIPPED` and the walk goes on.

## Before and after

Capture the same surfaces before and after a change into two folders, then:

```sh
node scripts/screenshot-side-by-side.mjs apps/mobile/screenshots/before apps/mobile/screenshots/after side-by-side.html
```

The page pairs pictures by their path, marks identical pairs (hidden by default) and lists pictures that exist on one side only. Run both sides at the same commit of the tools and with the same options; otherwise every picture differs for reasons that are not the change. The phone baseline also has `--compare <a> <b>`, which only reports which files differ.

Where a mockup exists, the after-picture is compared against the mockup, not against the before-picture: the before-picture shows what was, not what was decided.

## What the pictures cannot prove

A surface the doubles cannot render is UNVERIFIED, never green. In particular:

- **Search snippets on the desktop.** The desktop double has no search index; the sidebar search shows hits without the two-line snippet the app shows under each hit (the review of 2026-11-10 first reported this as a bug; it was the double). The phone baseline has a real index.
- **The native status bar, safe areas and the notch.** The phone runs in a plain browser: no status bar, no home indicator, no insets, so nothing proves that a surface clears them.
- **The keyboard.** No software keyboard opens: the writing bar above the keyboard, a sheet over the keyboard and anything that moves when it appears are not shown.
- **Native parts.** The system share sheet, the date and file pickers, the back gesture, haptics, widgets, notifications and the Rust side of the desktop (file watching, the real file system, windows) are doubles or absent.
- **Providers.** Calendar, mail and cloud accounts answer from fixtures or not at all (requests outside localhost are blocked); a failure banner in a picture is the fixture's, not the provider's.
- **Fonts and rendering of the real platforms.** Chromium on the capture machine draws the pictures; WebKit on iOS and macOS and the Android WebView differ in fonts, scrollbars and form controls.
- **Motion and time.** Animations are off and the clock is fixed; a picture shows a settled state, never a transition.
