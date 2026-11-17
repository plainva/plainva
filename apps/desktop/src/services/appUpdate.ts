import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getSettingsStore } from "./settingsStore";
import { logDiagnostic, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The app-update service (P3.8): ALL updater-plugin access lives here — the
 * silent startup check below and the check/download/install operations the
 * settings "Updates" section drives. The settings keep only UI state.
 */

export type UpdateCheckResult =
  | { status: "available"; update: Update }
  | { status: "none" }
  /** The releases feed does not exist yet (pre-launch) — not an error. */
  | { status: "no-release" }
  /** A package manager updates this installation (e.g. Nix); Plainva does not. */
  | { status: "managed"; by: string }
  | { status: "error"; error: string };

/**
 * The identifier of the published app (`tauri.conf.json`). The isolated dev
 * build (`.dev`) and a Labs build of a feature branch (`.labs`) are built from
 * source and must never offer — or install — the public release over
 * themselves; their overlays also clear the updater endpoints.
 */
const RELEASE_IDENTIFIER = "com.plainva.desktop";

async function isReleaseInstall(): Promise<boolean> {
  try {
    const { getIdentifier } = await import("@tauri-apps/api/app");
    return (await getIdentifier()) === RELEASE_IDENTIFIER;
  } catch {
    return false;
  }
}

/**
 * The package manager that updates this installation, or `null` when Plainva
 * updates itself. A package manager says so through the environment of the
 * process (`PLAINVA_UPDATES_MANAGED_BY`, set by the wrapper of the Nix package,
 * read in `src-tauri/src/app_identity.rs`): its copy carries the release
 * identifier, but it lives where the app cannot write — the read-only Nix
 * store — so it must never offer or install a release over itself.
 */
export async function getUpdatesManagedBy(): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<string | null>("app_updates_managed_by")) ?? null;
  } catch {
    return null;
  }
}

/** The one gate in front of the update feed: the start-up check and the settings both come through it. */
export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  if (!(await isReleaseInstall())) return { status: "no-release" };
  const managedBy = await getUpdatesManagedBy();
  if (managedBy) return { status: "managed", by: managedBy };
  try {
    const update = await check();
    return update ? { status: "available", update } : { status: "none" };
  } catch (e) {
    const error = String(e);
    if (error.includes("Could not fetch a valid release JSON")) return { status: "no-release" };
    return { status: "error", error };
  }
}

/**
 * Why an update did not go through, in the words the person reads (S12/R11).
 *
 * The updater checks every download against the Plainva project's public key
 * (`plugins.updater.pubkey` in tauri.conf.json, nothing else) and against the
 * version the signature was made for (`requireSignedVersion`) BEFORE anything
 * is installed — a changed file, a file signed with another key, the signature
 * of another file, or a new version number put on an older release are all
 * refused there (proven against the built app by the updater signature test,
 * `wdio/updater-signature.e2e.ts`). The plugin's words for that ("The
 * signature verification failed") say nothing to a person, so the refusal
 * gets a sentence of its own with its sender first — Plainva refused it —
 * and so does a missing connection to the update server. Anything else keeps
 * the plugin's own words behind the existing line.
 */
export type UpdateFailureKind = "refused" | "network" | "server" | "other";

/*
 * The words below are the plugin's own (tauri-plugin-updater 2.13 `Error`,
 * minisign-verify 0.2 `Error`, base64 0.22 `DecodeError`, reqwest 0.13
 * `Error` — whose Display names its kind and url but not its source chain).
 * The IPC hands them over as `Error::to_string()`. `updaterTrust.test.ts`
 * pins the plugin version they were read from.
 */
const REFUSED = [
  // minisign-verify: a changed file, another file's signature, a foreign key, a broken signature
  "the signature verification failed",
  "the signature was created with a different key",
  "invalid encoding in minisign data",
  "unexpected signature algorithm",
  "signature algorithm is not supported",
  // the plugin: the signed version (`requireSignedVersion`) and an undecodable signature
  "the update was signed for version",
  "does not specify the version it was signed for",
  "could not be decoded, please check if it is a valid base64 string",
  // base64: the signature field is no base64 at all
  "invalid symbol",
  "invalid last symbol",
  "invalid padding",
  "invalid input length",
];
/** No answer, or the answer broke off: reqwest's request and body errors (connect, DNS, TLS, timeout, reset). */
const NETWORK = ["error sending request", "request or response body error", "operation timed out"];
/** The server answered the download with an error status (a removed file, a rate limit): `Error::Network`. */
const SERVER_STATUS = /download request failed with status: ([^`]+)/i;

export function classifyUpdateFailure(error: unknown): UpdateFailureKind {
  const text = String(error).toLowerCase();
  if (REFUSED.some((words) => text.includes(words))) return "refused";
  if (SERVER_STATUS.test(text)) return "server";
  if (NETWORK.some((words) => text.includes(words))) return "network";
  return "other";
}

/**
 * The line for a failed update. `step` names where it failed: "install" for
 * download and installation, "check" for asking the update server.
 */
export function describeUpdateFailure(error: unknown, step: "check" | "install", t: (key: string, options?: Record<string, unknown>) => string): string {
  const raw = String(error);
  switch (classifyUpdateFailure(error)) {
    case "refused":
      return t("settings.updateRefused");
    case "network":
      return t("settings.updateNoConnection");
    case "server":
      return t("settings.updateServerStatus", { status: (SERVER_STATUS.exec(raw)?.[1] ?? "").trim() });
    default:
      return step === "check" ? t("settings.updateCheckError", { error: raw }) : t("settings.updateInstallError", { error: raw });
  }
}

/** The longest the drafts and writes of every window are waited for before the update installs. */
export const UPDATE_SETTLE_MS = 5_000;
/** How long the wait goes on before the person is told what it waits for. */
export const UPDATE_WAIT_WORD_MS = 700;

/**
 * Downloads, installs and relaunches. Rejects on failure — caller shows it.
 *
 * Between download and install the drafts every window still buffers are
 * written, and the writes on their way are waited for (A7): installing ends
 * the process on Windows, and a restart is the one way out the native side
 * cannot hold (`src-tauri/src/leave.rs`). At most `UPDATE_SETTLE_MS`: writes
 * that keep coming (a sync pull) or one that hangs do not keep the update
 * from installing. When the wait goes on past a moment, `onWaiting` gets the
 * limit in seconds, for the person to see why nothing happens yet, and
 * `onInstalling` when the wait is over and the installation starts. When the
 * limit ran out, the next start says that Plainva went before every window was
 * done (`leave_mark_cut`, as for a quit cut short).
 */
export async function downloadAndInstallUpdate(update: Update, onWaiting?: (seconds: number) => void, onInstalling?: () => void): Promise<void> {
  await update.download();
  const { settleEveryWindowBeforeLeaving } = await import("./leaveFlush");
  let said = false;
  const word = setTimeout(() => {
    said = true;
    onWaiting?.(Math.ceil(UPDATE_SETTLE_MS / 1000));
  }, UPDATE_WAIT_WORD_MS);
  let done: boolean;
  try {
    done = await settleEveryWindowBeforeLeaving(UPDATE_SETTLE_MS);
  } finally {
    clearTimeout(word);
  }
  if (said) onInstalling?.();
  if (!done) {
    const { invoke } = await import("@tauri-apps/api/core");
    await Promise.resolve(invoke("leave_mark_cut")).catch(() => {
      // silent: without the mark the next start says nothing; the update still installs.
    });
  }
  await update.install();
  await relaunch();
}

export const AUTO_UPDATE_CHECK_KEY = "autoUpdateCheck";

export async function getAutoUpdateCheck(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(AUTO_UPDATE_CHECK_KEY)) ?? true;
  } catch {
    return true;
  }
}

export async function setAutoUpdateCheck(value: boolean): Promise<void> {
  const store = await getSettingsStore();
  await store.set(AUTO_UPDATE_CHECK_KEY, value);
  await store.save();
}

// Silent startup check: one quiet probe ~10 s after start, one toast if an
// update exists; every failure (no feed yet, offline, dev build) stays silent
// by design — a startup check must never nag.
const STARTUP_DELAY_MS = 10_000;
let scheduled = false;

export function scheduleStartupUpdateCheck(): void {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    void (async () => {
      try {
        if (!(await getAutoUpdateCheck())) return;
        const result = await checkForAppUpdate();
        if (result.status === "available") {
          const update = result.update;
          // Clickable toast (maintainer): the action installs the update directly.
          toast.info(i18n.t("settings.updateAvailable", { version: update.version }), {
            label: i18n.t("settings.installUpdate"),
            run: () => {
              // Persistent toast: the download/install can take a while and ends
              // in a relaunch, so it must not vanish after a few seconds — it
              // stays up (through the restart) or is replaced by an error.
              let installingId = toast.progress(i18n.t("settings.installingUpdate"));
              const onWaiting = (seconds: number) => {
                toast.dismiss(installingId);
                installingId = toast.progress(i18n.t("settings.updateWaitingForWrites", { seconds }));
              };
              const onInstalling = () => {
                toast.dismiss(installingId);
                installingId = toast.progress(i18n.t("settings.installingUpdate"));
              };
              void downloadAndInstallUpdate(update, onWaiting, onInstalling).catch((e) => {
                toast.dismiss(installingId);
                logDiagnostic("update.install", String(e));
                toast.error(describeUpdateFailure(e, "install", (key, options) => i18n.t(key, options)));
              });
            },
          });
        }
      } catch {
        // Silent by design.
      }
    })();
  }, STARTUP_DELAY_MS);
}

/** Test hook. */
export function resetStartupUpdateCheckForTests(): void {
  scheduled = false;
}
