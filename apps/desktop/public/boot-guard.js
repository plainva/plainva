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
 * The supported floor is Safari 16.4. macOS states 12 (Monterey) because that
 * is the oldest still-supported system able to install that Safari — but the
 * OS version can only ever be a rough filter: Safari updates separately, so
 * Ventura 13.0 shipped BELOW the bar (Safari 16.1) while Monterey with current
 * updates sits well above it. This probe is the only thing that measures the
 * engine itself. A ratchet (src/floorConsistency.test.ts) keeps the numbers in
 * build.target, minimumSystemVersion and the docs from drifting apart.
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

  function rule(parent) {
    var hr = document.createElement("div");
    hr.setAttribute("style", "height:1px;background:#d8e0de;margin:22px 0;max-width:62ch;");
    parent.appendChild(hr);
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
      btn.textContent = "Copy details / Details kopieren";
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(text).then(
          function () {
            btn.textContent = "Copied / Kopiert";
          },
          function () {
            btn.textContent = "Select the text above / Text oben markieren";
          },
        );
      });
      parent.appendChild(btn);
    }
  }

  /* English first, German below: there is no i18n bundle at this point, and
     guessing the language from navigator would be one more thing that can be
     wrong on the screen that exists because something was wrong. */
  function showUnsupported() {
    if (shown) return;
    shown = true;
    var box = mountOverlay();

    block(box, "Plainva can't start on this system", [
      "Plainva needs a newer web engine than this system provides. On macOS the engine comes " +
        "with Safari, so installing the latest Safari usually fixes this — Plainva needs " +
        "Safari 16.4 or newer, which macOS 12 (Monterey) and later can install. On Linux it " +
        "needs WebKitGTK 2.40 or newer, on Windows an up-to-date WebView2 runtime.",
      "Your notes are untouched — the app stopped before it opened anything.",
      "System requirements: plainva.com",
    ]);

    rule(box);

    block(box, "Plainva kann auf diesem System nicht starten", [
      "Plainva braucht eine neuere Web-Engine, als dieses System bereitstellt. Unter macOS " +
        "kommt die Engine mit Safari — ein Safari-Update behebt das meist. Plainva braucht " +
        "Safari 16.4 oder neuer; installieren lässt sich das ab macOS 12 (Monterey). Unter " +
        "Linux braucht es WebKitGTK 2.40 oder neuer, unter Windows eine aktuelle " +
        "WebView2-Laufzeit.",
      "Deine Notizen sind unberührt — die App hat gestoppt, bevor sie etwas geöffnet hat.",
      "Systemanforderungen: plainva.com",
    ]);
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

    rule(box);

    block(box, "Plainva ist nicht gestartet", [
      "Vor dem Öffnen ist etwas schiefgegangen. Deine Notizen sind unberührt.",
      "Bitte melde das mit den Angaben unten: github.com/plainva/plainva/issues",
    ]);

    detail(box, errors.length ? errors.join("\n\n") : "No error was reported — the app simply never rendered.");
  }

  function record(label, value) {
    errors.push("[" + label + "] " + describe(value));
    /* Only a boot failure takes over the screen. Once the app is up it owns its
       own error handling, and covering it would hide a working program. */
    if (!appHasMounted()) showStartupFailure();
  }

  /* The two features that mark the supported floor. Lookbehind is the one that
     actually bites (Safari 16.4, and it throws at PARSE time, so a single
     literal takes a whole chunk down); structuredClone stands in for the 15.4
     step below it. Kept deliberately short — a guard that tests everything
     becomes a second place to maintain the floor. */
  function engineSupported() {
    try {
      new RegExp("(?<=a)b");
    } catch (e) {
      return false;
    }
    if (typeof structuredClone !== "function") return false;
    return true;
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

  if (!engineSupported()) showUnsupported();
})();
