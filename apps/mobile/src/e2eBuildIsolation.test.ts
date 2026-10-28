import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { E2E_BUILD_MODE, E2E_STANDARD_GOOGLE_IOS_CLIENT_ID, e2eBuildDefine, e2eBuildEnv } from "../scripts/e2e-build-env.mjs";

/**
 * The phone's end-to-end build ships a standard Google sign-in with the fake
 * provider's client, so the standard path is tested end to end. That client
 * must never reach a build that ships: an app whose standard sign-in names a
 * client no Google project carries cannot sign anyone in. These checks hold
 * the line between the two builds.
 */

const mobile = join(__dirname, "..");
const repo = join(mobile, "..", "..");
const workflows = join(repo, ".github", "workflows");

function sourceFiles(dir: string, skip: (rel: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(repo, full).split(sep).join("/");
    if (skip(rel)) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, skip));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the e2e build's standard Google client stays in the e2e build", () => {
  it("is given to the e2e mode only, as environment the app reads as a whole", () => {
    for (const mode of ["production", "development", "test", "labs"]) {
      expect(e2eBuildEnv(mode)).toEqual({});
      expect(e2eBuildDefine(mode)).toEqual({});
    }
    expect(e2eBuildEnv(E2E_BUILD_MODE)).toEqual({ VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: E2E_STANDARD_GOOGLE_IOS_CLIENT_ID, VITE_PLAINVA_GOOGLE_MAIL_STATE: "production" });
    expect(e2eBuildDefine(E2E_BUILD_MODE)["import.meta.env.VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID"]).toBe(JSON.stringify(E2E_STANDARD_GOOGLE_IOS_CLIENT_ID));
  });

  it("is the fake provider's test client, not one a real project carries", () => {
    expect(E2E_STANDARD_GOOGLE_IOS_CLIENT_ID).toMatch(/^\d+-plainva-test\.apps\.googleusercontent\.com$/);
  });

  it("is asked for by the end-to-end script, never by the build that ships", () => {
    const scripts = (JSON.parse(readFileSync(join(mobile, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["smoke:prod"]).toMatch(/^vite build --mode e2e && playwright test /);
    for (const [name, command] of Object.entries(scripts)) {
      if (name === "smoke:prod") continue;
      expect(command, name).not.toMatch(/--mode\s+e2e/);
    }
    const config = readFileSync(join(mobile, "vite.config.ts"), "utf8");
    expect(config).toMatch(/define: \{ \.\.\.buildInfoDefine\(\), \.\.\.e2eBuildDefine\(mode\) \}/);
  });

  it("no workflow builds a shipped bundle in the e2e mode, and only the CI checks run the e2e build", () => {
    for (const name of readdirSync(workflows)) {
      const text = readFileSync(join(workflows, name), "utf8");
      expect(text, name).not.toMatch(/--mode\s+e2e/);
      expect(text, name).not.toContain(E2E_STANDARD_GOOGLE_IOS_CLIENT_ID);
      if (name !== "ci.yml") expect(text, name).not.toMatch(/--filter mobile run smoke:prod/);
    }
  });

  it("names the client nowhere in the code that ships", () => {
    const skip = (rel: string) => rel.includes("node_modules") || /(^|\/)(dist|e2e-prod|testing)(\/|$)/.test(rel) || /\.test\.tsx?$/.test(rel);
    const shipped = [...sourceFiles(join(mobile, "src"), skip), ...sourceFiles(join(repo, "packages", "ui", "src"), skip), ...sourceFiles(join(repo, "packages", "core", "src"), skip)];
    expect(shipped.length).toBeGreaterThan(100);
    expect(shipped.filter((file) => readFileSync(file, "utf8").includes(E2E_STANDARD_GOOGLE_IOS_CLIENT_ID)).map((file) => relative(repo, file))).toEqual([]);
  });
});
