/**
 * The build this app was made from — channel, branch, commit, CI run —
 * injected by both shells' Vite configs (`scripts/build-info.mjs`). Shown
 * under About & diagnostics so a finding names its build: a Labs build of a
 * feature branch, the dev build and the release can all sit on one device.
 */
export interface BuildInfo {
  /** `release`, `labs` or `local`. */
  channel: string;
  /** Short commit hash, or empty when unknown. */
  commit: string;
  /** Branch or tag the build came from, or empty. */
  branch: string;
  /** GitHub Actions run number, or empty for a local build. */
  run: string;
}

declare const __PLAINVA_BUILD__: BuildInfo | undefined;

const UNKNOWN: BuildInfo = { channel: "local", commit: "", branch: "", run: "" };

export function buildInfo(): BuildInfo {
  // The global only exists where a Vite config defines it (the two apps and
  // their test runs); anywhere else the build is simply unknown.
  return typeof __PLAINVA_BUILD__ === "undefined" || !__PLAINVA_BUILD__ ? UNKNOWN : __PLAINVA_BUILD__;
}

/** One line, e.g. "labs · feature/ai-harness · 1a2b3c4d · #57"; empty parts are left out. */
export function formatBuildLine(info: BuildInfo = buildInfo()): string {
  return [info.channel, info.branch, info.commit, info.run ? `#${info.run}` : ""].filter(Boolean).join(" · ");
}
