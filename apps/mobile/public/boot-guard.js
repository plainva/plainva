/*
 * Plainva boot guard — phone edition.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The desktop learned this twice (v0.3.0, issue #46): a blank window tells the
 * user nothing and tells us nothing. The phone had the same hole and one more
 * reason to care — apps/mobile/src/main.tsx carries a fatal overlay, but it
 * lives INSIDE the module graph. When the graph fails to PARSE, nothing in it
 * runs, including that overlay. It is dead in exactly the case it was written
 * for. This file is a classic ES5 script with no imports, so it survives an
 * engine that refuses the bundle.
 *
 * WHY THE PHONE NEEDS IT EVEN THOUGH iOS HAS A FLOOR
 * On iOS the engine ships with the system, so IPHONEOS_DEPLOYMENT_TARGET keeps
 * an unsupported device out of the App Store install in the first place — but
 * not out of TestFlight, and not out of a device that was already on an older
 * build. On ANDROID nothing keeps it out at all: the WebView is an updatable
 * component, so its version has no fixed relation to the OS version. A phone
 * whose Play Store no longer updates can sit far below the floor on a current
 * Android. There the guard is the only thing that says so — and it can name
 * the fix, because updating Android System WebView is something a user can
 * actually do.
 *
 * WHY public/ AND NOT AN INLINE <script>
 * Files in public/ are copied verbatim by Vite — no bundling, no transpiling,
 * no minification — which is what keeps the ES5 in here actually ES5. It is
 * also loaded as a CLASSIC script before the module: modules are deferred by
 * spec, so this runs first no matter where the tag ends up in the built HTML.
 *
 * The floor is the same as the desktop's because the phone ships the same
 * shared packages, and those are what set the bar: Safari 16.4, which on iOS
 * means iOS 16.4. A ratchet (apps/desktop/src/floorConsistency.test.ts) keeps
 * the numbers here, in build.target, in the Xcode project and in the handbook
 * from drifting apart.
 */
(function () {
  "use strict";

  var OVERLAY_ID = "plainva-boot-failure";
  /* Longer than the desktop's 8s on purpose: a cold start on a cheap Android
     runs the Capacitor bridge and the plugin registration before React paints,
     and calling that a failure would be worse than waiting. */
  var STARTUP_GRACE_MS = 12000;

  var shown = false;
  var errors = [];

  /* The app is up as soon as React has put anything into #root — the only
     mount signal available from outside the module graph. Asked at the moment
     of the error, never cached: an error is a BOOT failure only while nothing
     has rendered. Afterwards a stray rejection (a failed sync, a token
     refresh) belongs in diagnostics, not over the whole app. */
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
     none of which exist when this runs. The top padding clears the status bar:
     the app is edge-to-edge, so a plain inset:0 box would start its heading
     under the clock. */
  function mountOverlay() {
    var box = document.createElement("div");
    box.id = OVERLAY_ID;
    box.setAttribute("role", "alert");
    box.setAttribute(
      "style",
      "position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;" +
        "background:#ffffff;color:#1b2b29;overflow:auto;" +
        "padding:calc(44px + env(safe-area-inset-top,0px)) 20px calc(24px + env(safe-area-inset-bottom,0px));" +
        "box-sizing:border-box;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "font-size:15px;line-height:1.55;-webkit-user-select:text;user-select:text;",
    );
    document.body.appendChild(box);
    /* Tells the in-module overlay in main.tsx to stand down. Both listen for
       the same errors; two stacked overlays would bury the more specific one,
       and the more specific one is this. */
    window.__plainvaBootFailureShown = true;
    return box;
  }

  function block(parent, heading, lines) {
    var h = document.createElement("h1");
    h.setAttribute("style", "margin:0 0 10px;font-size:19px;font-weight:600;line-height:1.3;");
    h.textContent = heading;
    parent.appendChild(h);

    for (var i = 0; i < lines.length; i++) {
      var p = document.createElement("p");
      p.setAttribute("style", "margin:0 0 10px;");
      p.textContent = lines[i];
      parent.appendChild(p);
    }
  }

  /* The technical part is what turns "it's broken" into a fixable report, so
     it is on the screen rather than in a console nobody can open on a phone —
     selectable, and copyable where the engine has a clipboard. */
  function detail(parent, text) {
    var pre = document.createElement("pre");
    pre.setAttribute(
      "style",
      "margin:0;padding:12px 14px;background:#f2f5f4;" +
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
        "margin:14px 0 0;padding:11px 16px;font:inherit;font-size:15px;cursor:pointer;" +
          "background:#1f6f68;color:#ffffff;border:0;border-radius:8px;min-height:44px;",
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

  /* English only — deliberately. There is no i18n bundle at this point,
     guessing the language from navigator would be one more thing that can be
     wrong on the screen that exists because something was wrong, and this text
     is written to be pasted into an issue. */
  function showUnsupported(missing) {
    if (shown) return;
    shown = true;
    var box = mountOverlay();
    var android = /Android/i.test(String(navigator.userAgent));

    block(box, "Plainva can't start on this device", [
      android
        ? "Plainva needs a newer web engine than this device provides. On Android that engine " +
            "is a separate component, so this is usually fixable: open the Play Store and " +
            "update Android System WebView (and Chrome), then start Plainva again."
        : "Plainva needs a newer web engine than this device provides. On iOS and iPadOS that " +
            "engine is part of the system, so Plainva needs iOS/iPadOS 16.4 or later.",
      "Your notes are untouched — the app stopped before it opened anything.",
      "If this device LOOKS new enough, the details below are what we need — please copy them " +
        "into a report: github.com/plainva/plainva/issues",
      "System requirements: plainva.com",
    ]);

    /* WHICH probe failed, not just THAT one did. The name plus the user agent
       are the two things that turn the next screenshot into an answer — on
       Android the user agent also carries the WebView version, which is the
       number that actually decides this case. */
    detail(box, "Missing: " + missing.join(", ") + "\n\nUser agent: " + String(navigator.userAgent));
  }

  /* The net for what the feature probe does not know about — the next baseline
     step, a broken chunk, a Capacitor plugin missing on this platform (which
     is how the iOS black screen of 2026-07-11 presented: AtomicFile existed
     only on Android and the first write at boot threw). */
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
    if (!appHasMounted()) showStartupFailure();
  }

  /* The two features that mark the supported floor, each reported BY NAME.
     Lookbehind is the one that actually bites (Safari 16.4, and it throws at
     PARSE time, so a single literal takes a whole chunk down); structuredClone
     stands in for the 15.4 step below it. Kept deliberately short — a guard
     that tests everything becomes a second place to maintain the floor.

     Returns the list of MISSING features, empty when the engine is fine. */
  function missingEngineFeatures() {
    var missing = [];
    try {
      new RegExp("(?<=a)b");
    } catch (e) {
      missing.push("RegExp lookbehind (Safari 16.4 / iOS 16.4)");
    }
    if (typeof structuredClone !== "function") missing.push("structuredClone (Safari 15.4 / iOS 15.4)");
    return missing;
  }

  window.addEventListener("error", function (e) {
    record("error", e.error || e.message);
  });
  window.addEventListener("unhandledrejection", function (e) {
    record("promise", e.reason);
  });

  /* The quiet failure: no exception, nothing rendered. Without this the screen
     stays blank and the guard would have been for nothing. */
  window.setTimeout(function () {
    if (!appHasMounted()) showStartupFailure();
  }, STARTUP_GRACE_MS);

  var missingFeatures = missingEngineFeatures();
  if (missingFeatures.length) showUnsupported(missingFeatures);
})();
