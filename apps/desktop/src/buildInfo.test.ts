import { describe, expect, it } from "vitest";
import { buildInfo, formatBuildLine } from "@plainva/ui";
import { buildInfo as nodeBuildInfo, buildInfoDefine } from "../../../scripts/build-info.mjs";

/**
 * The build line under About & diagnostics (harness plan §21a.4): with a Labs
 * build of a feature branch next to the release and the dev build on one
 * device, a finding has to name the build it was seen in.
 */
describe("build info", () => {
  it("reads the GitHub Actions environment first", () => {
    expect(
      nodeBuildInfo({
        PLAINVA_BUILD_CHANNEL: "labs",
        GITHUB_SHA: "0123456789abcdef",
        GITHUB_REF_NAME: "feature/ai-harness",
        GITHUB_RUN_NUMBER: "57",
      }),
    ).toEqual({ channel: "labs", commit: "01234567", branch: "feature/ai-harness", run: "57" });
  });

  it("names the pull request's head branch, not the merge ref", () => {
    expect(nodeBuildInfo({ GITHUB_SHA: "abc", GITHUB_HEAD_REF: "feature/x", GITHUB_REF_NAME: "12/merge" }).branch).toBe(
      "feature/x",
    );
  });

  it("calls a build without a channel local", () => {
    expect(nodeBuildInfo({ GITHUB_SHA: "abc", GITHUB_REF_NAME: "main" }).channel).toBe("local");
  });

  it("hands Vite a JSON string it can inline", () => {
    const define = buildInfoDefine({ PLAINVA_BUILD_CHANNEL: "release", GITHUB_SHA: "f".repeat(40), GITHUB_REF_NAME: "v0.9.0" });
    expect(JSON.parse(define.__PLAINVA_BUILD__)).toEqual({ channel: "release", commit: "ffffffff", branch: "v0.9.0", run: "" });
  });

  it("leaves empty parts out of the line", () => {
    expect(formatBuildLine({ channel: "labs", branch: "feature/ai-harness", commit: "1a2b3c4d", run: "57" })).toBe(
      "labs · feature/ai-harness · 1a2b3c4d · #57",
    );
    expect(formatBuildLine({ channel: "local", branch: "", commit: "", run: "" })).toBe("local");
  });

  it("is defined in this build (the desktop Vite config injects it)", () => {
    expect(buildInfo().channel).not.toBe("");
  });
});
