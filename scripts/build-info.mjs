/**
 * Which build is this? Injected into both shells as `__PLAINVA_BUILD__` by
 * their Vite configs and shown under About & diagnostics, so every finding
 * names the build it was seen in.
 *
 * Before this, no shell showed a branch or a commit, and iOS shows only its
 * fixed `MARKETING_VERSION` "1.0": with a Labs build of a feature branch
 * installed next to the release and the dev build, "which one was that?" had
 * no answer on the device.
 *
 * - `channel`: `PLAINVA_BUILD_CHANNEL` (the release workflows set `release`,
 *   the Labs workflow `labs`), otherwise `local`;
 * - `commit`, `branch`, `run`: from the GitHub Actions environment, locally
 *   from git. A missing git (a source tarball) leaves them empty.
 *
 * Only facts about the build, never about the machine or the user.
 */
import { execFileSync } from "node:child_process";

function git(args) {
  try {
    return execFileSync("git", args, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

export function buildInfo(env = process.env) {
  const commit = (env.GITHUB_SHA || git(["rev-parse", "HEAD"])).slice(0, 8);
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    channel: env.PLAINVA_BUILD_CHANNEL || "local",
    commit,
    branch: branch === "HEAD" ? "" : branch,
    run: env.GITHUB_RUN_NUMBER || "",
  };
}

/** The Vite `define` entry. */
export function buildInfoDefine(env = process.env) {
  return { __PLAINVA_BUILD__: JSON.stringify(buildInfo(env)) };
}
