/*
 * Plainva boot guard.
 *
 * WHY THIS FILE EXISTS AT ALL
 * A blank window is the worst failure this app can have: it tells the user
 * nothing and it tells us nothing. It happened twice — v0.3.0 (a module-level
 * read evaluated before its dependency in the production bundle) and issue #46
 * (a regular expression the installed WebKit cannot parse). Both times the
 * window opened, no JavaScript ran, and the screenshot showed white.
 *
 * WHY IT IS NOT A MODULE
 * When the module graph fails to PARSE, nothing inside it runs — including any
 * error handling it carries. apps/mobile/src/main.tsx is the content model for
 * this file, not the technical one: it lives inside a module and would be dead
 * in exactly the case it is meant to report. This file is a classic script,
 * plain ES5, no imports, no dependencies, so that it survives an engine that
 * refuses the bundle.
 *
 * WHY public/ AND NOT AN INLINE <script>
 * The app runs under "default-src 'self'" with no 'unsafe-inline' for scripts
 * (see tauri.conf.json), so an inline script is blocked by the CSP. Files in
 * public/ are copied verbatim by Vite — no bundling, no transpiling, no
 * minification — which is also what keeps the ES5 in here actually ES5.
 *
 * The supported floor is Safari 16.4, which on macOS means the system: an app
 * embeds WKWebView, a system component that moves with OS updates — NOT with
 * Safari.app, which on an unsupported Mac can run years ahead of it. Monterey
 * stops at Safari 15.6.1 however current its Safari is (issue #46 measured
 * exactly that), so the floor is macOS 13.3 — Ventura shipped with 16.1 and
 * only reached 16.4 at 13.3. This probe still measures the engine itself,
 * because no version number can be trusted to describe it. A ratchet
 * (src/floorConsistency.test.ts) keeps the numbers in build.target,
 * minimumSystemVersion and the docs from drifting apart.
 * See the workspace plan "WebView-Untergrenze".
 */
(function () {
  "use strict";

  var OVERLAY_ID = "plainva-boot-failure";
  /* Long enough that a cold start on a slow disk is not called a failure,
     short enough that nobody sits in front of a white window wondering. */
  var STARTUP_GRACE_MS = 8000;

  var shown = false;
  var errors = [];

  /* The app is up as soon as React has put anything into #root. That is the
     only mount signal available from outside the module graph — and it must be
     asked at the moment of the error, not cached: an error is only a BOOT
     failure while nothing has rendered. Afterwards a stray rejection (a failed
     sync, a token refresh) belongs in diagnostics, not over the whole app. */
  function appHasMounted() {
    var root = document.getElementById("root");
    return !!(root && root.firstElementChild);
  }

  function describe(value) {
    if (value && value.stack) return String(value.name) + ": " + String(value.message) + "\n" + String(value.stack);
    if (value && value.message) return String(value.name) + ": " + String(value.message);
    return String(value);
  }

  /* One readable surface, independent of React, the theme and the app CSS —
     none of which exist when this runs. Deliberately fixed-position rather
     than rendered into #root: it must stay visible even if the app does mount
     afterwards, so a false negative is loud rather than silent. */
  function mountOverlay() {
    var box = document.createElement("div");
    box.id = OVERLAY_ID;
    box.setAttribute("role", "alert");
    box.setAttribute(
      "style",
      "position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;" +
        "background:#ffffff;color:#1b2b29;overflow:auto;" +
        "padding:56px 28px 32px;box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "font-size:14px;line-height:1.55;-webkit-user-select:text;user-select:text;",
    );
    document.body.appendChild(box);
    return box;
  }

  function block(parent, heading, lines) {
    var h = document.createElement("h1");
    h.setAttribute("style", "margin:0 0 10px;font-size:19px;font-weight:600;line-height:1.3;");
    h.textContent = heading;
    parent.appendChild(h);

    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement("p");
      p.setAttribute("style", "margin:0 0 10px;max-width:62ch;");
      p.textContent = lines[i];
      parent.appendChild(p);
    }
  }

  /* The technical part is what turns "it's broken" into a fixable report, so it
     is on the screen rather than in a console nobody can open in a release
     build — selectable, and copyable where the engine has a clipboard. */
  function detail(parent, text) {
    var pre = document.createElement("pre");
    pre.setAttribute(
      "style",
      "margin:0;padding:12px 14px;max-width:82ch;background:#f2f5f4;" +
        "border:1px solid #d8e0de;border-radius:6px;overflow:auto;" +
        "font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;" +
        "line-height:1.45;white-space:pre-wrap;word-break:break-word;color:#7a1414;",
    );
    pre.textContent = text;
    parent.appendChild(pre);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      var btn = document.createElement("button");
      btn.setAttribute(
        "style",
        "margin:12px 0 0;padding:7px 14px;font:inherit;font-size:13px;cursor:pointer;" +
          "background:#1f6f68;color:#ffffff;border:0;border-radius:6px;",
      );
      btn.textContent = "Copy details";
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(text).then(
          function () {
            btn.textContent = "Copied";
          },
          function () {
            btn.textContent = "Select the text above";
          },
        );
      });
      parent.appendChild(btn);
    }
  }

  /* English only — deliberately. There is no i18n bundle at this point, guessing
     the language from navigator would be one more thing that can be wrong on the
     screen that exists because something was wrong, and this text is written to
     be pasted into an issue. */
  function showUnsupported(missing) {
    if (shown) return;
    shown = true;
    var box = mountOverlay();

    block(box, "Plainva can't start on this system", [
      "Plainva needs a newer web engine than this system provides. On macOS that engine is " +
        "part of the system rather than of Safari — installing a newer Safari does not " +
        "change it — so Plainva needs macOS 13.3 (Ventura) or later, which carries " +
        "Safari 16.4 or newer. On Linux it needs WebKitGTK 2.40 or newer, on Windows an " +
        "up-to-date WebView2 runtime.",
      "Your notes are untouched — the app stopped before it opened anything.",
      "If this system LOOKS new enough, the details below are what we need — please copy them " +
        "into a report: github.com/plainva/plainva/issues",
      "System requirements: plainva.com",
    ]);

    /* WHICH probe failed, not just THAT one did. On macOS the engine inside an
       app does not have to match the installed Safari, so "you need Safari 16.4"
       on a machine running 17.6 reads as a false alarm and ends the conversation
       right where it should start (issue #46). The names below plus the user
       agent are the two things that turn the next screenshot into an answer. */
    detail(box, "Missing: " + missing.join(", ") + "\n\nUser agent: " + String(navigator.userAgent));
  }

  /* The net for what the feature probe does not know about — the NEXT baseline
     step, a broken chunk, a plugin that is missing on this platform. */
  function showStartupFailure() {
    if (shown) return;
    shown = true;
    var box = mountOverlay();

    block(box, "Plainva didn't start", [
      "Something went wrong before the app could open. Your notes are untouched.",
      "Please report this with the details below: github.com/plainva/plainva/issues",
    ]);

    detail(
      box,
      (errors.length ? errors.join("\n\n") : "No error was reported — the app simply never rendered.") +
        "\n\nUser agent: " +
        String(navigator.userAgent),
    );
  }

  function record(label, value) {
    errors.push("[" + label + "] " + describe(value));
    /* Only a boot failure takes over the screen. Once the app is up it owns its
       own error handling, and covering it would hide a working program. */
    if (!appHasMounted()) showStartupFailure();
  }

  /* The two features that mark the supported floor, each reported BY NAME.
     Lookbehind is the one that actually bites (Safari 16.4, and it throws at
     PARSE time, so a single literal takes a whole chunk down); structuredClone
     stands in for the 15.4 step below it. Kept deliberately short — a guard that
     tests everything becomes a second place to maintain the floor.

     Returns the list of MISSING features, empty when the engine is fine. */
  function missingEngineFeatures() {
    var missing = [];
    try {
      new RegExp("(?<=a)b");
    } catch (e) {
      missing.push("RegExp lookbehind (Safari 16.4)");
    }
    if (typeof structuredClone !== "function") missing.push("structuredClone (Safari 15.4)");
    return missing;
  }

  window.addEventListener("error", function (e) {
    record("error", e.error || e.message);
  });
  window.addEventListener("unhandledrejection", function (e) {
    record("promise", e.reason);
  });

  /* The quiet failure: no exception, nothing rendered. Without this the screen
     stays white and the guard would have been for nothing. */
  window.setTimeout(function () {
    if (!appHasMounted()) showStartupFailure();
  }, STARTUP_GRACE_MS);

  var missingFeatures = missingEngineFeatures();
  if (missingFeatures.length) showUnsupported(missingFeatures);
})();
