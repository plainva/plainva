// @vitest-environment node
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What a client window may reach through the shell (stage C0).
 *
 * The shell is shared: the same file draws the central window and a full second
 * one. Which of them is running is NOT a flag it can ask about — it holds a
 * `ShellCapabilities` object and can only do what is in it. That design is only
 * worth anything as long as nobody adds a shortcut around it, so this pins the
 * two halves:
 *
 * - the shell never reaches an owner-only service directly, and
 * - the client never hands one in.
 *
 * Both would fail quietly rather than loudly: a client calling `openVault`
 * would switch the vault for the whole process from a window that is supposed
 * to follow it, and a service started in a second window duplicates a poller.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (file: string) =>
  ts.transpileModule(readFileSync(join(HERE, file), "utf8"), {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve },
  }).outputText;

// Plain substring checks, deliberately: the identifiers here are distinctive,
// comments are transpiled away, and an escaped word boundary inside a template
// literal is a BACKSPACE character rather than a boundary -- a guard written
// that way passes no matter what the file says.
const SHELL = strip("AppShell.tsx");
const CLIENT = strip("FullApp.tsx");

/**
 * Surfaces and services that exist once per process. The shell may show a
 * BUTTON for each — a greyed-out gear explains nothing — but the button goes
 * through a capability, so the client can route it to the owner instead.
 */
const OWNER_ONLY_IN_SHELL = [
  "SettingsModal",
  "ImportWizardModal",
  "SplashScreen",
  "scheduleStartupUpdateCheck",
  "restoreAuxWindows",
  "setOwnerOpenContents",
  "scanVaultOkf",
] as const;

/**
 * What a client window must reach the owner FOR, spelled as the call it makes.
 *
 * Stage D moved the vault line itself into every window — `openVault` and
 * `closeVault` change what a window SHOWS, which is its own business. What a
 * client still cannot do is create a window or run the process-wide surfaces,
 * so those go over the bus. A client that called them locally would look like
 * it worked and quietly do nothing (the window it wants exists only in the
 * owner's registry).
 */
const CLIENT_MUST_ASK = ["openFullWindow(", "restoreAuxWindows(", "openSettingsModal("] as const;

describe("shell capabilities", () => {
  // The scan runs on the TRANSPILED file, so it measures use rather than
  // mention: an unused import is elided and does not trip the guard, while a
  // real call does. That is the intended reading -- what matters is whether the
  // shared shell REACHES an owner service, not whether the name appears.
  it("keeps owner-only surfaces out of the shared shell", () => {
    const found = OWNER_ONLY_IN_SHELL.filter((name) => SHELL.includes(name));
    expect(
      found,
      `AppShell.tsx is rendered by a client window too and must not reach: ${found.join(", ")}. ` +
        "Pass the action in as a ShellCapabilities entry, so the client can route it to the owner.",
    ).toEqual([]);
  });

  it("does not let a client window call owner-only services itself", () => {
    const found = CLIENT_MUST_ASK.filter((call) => CLIENT.includes(call));
    expect(
      found,
      `FullApp.tsx must not call: ${found.join(", ")}. Creating windows and the process-wide ` +
        "surfaces live in the central window; a local call looks fine and does nothing.",
    ).toEqual([]);
  });

  it("routes the surfaces it does keep to the owner over the bus", () => {
    // Not a mode check inside the shell: the client says HOW, once, here.
    expect(CLIENT).toContain('"owner-surface"');
    for (const surface of ["settings", "import", "sync-error"]) {
      expect(CLIENT).toContain(`"${surface}"`);
    }
  });
});
