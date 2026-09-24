import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The iOS signing chain, as a test (plan Widgets, W7).
 *
 * Three bundles have to line up across four files that nothing else compares:
 * the Xcode project names a bundle id and a profile variable, the workflow
 * passes a secret and that variable, and two Python scripts check the profile
 * before and after the build. Miss one and the failure arrives as a signing
 * error at the end of a twenty-minute macOS run, or — worse — as an upload
 * Apple refuses.
 *
 * Textual, like the bridge guard next door: it runs in the ordinary suite on
 * any OS and catches the mistake at commit time instead of after a round trip.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(repositoryRoot, rel), "utf8");

const BUNDLES = [
  { suffix: "", variable: "PLAINVA_APP_PROFILE", installer: "(1, BASE, ", verifier: "(app, base, " },
  { suffix: ".share", variable: "PLAINVA_SHARE_PROFILE", installer: '(2, BASE + ".share", ', verifier: '(extension, base + ".share", ' },
  { suffix: ".widgets", variable: "PLAINVA_WIDGETS_PROFILE", installer: '(3, BASE + ".widgets", ', verifier: '(widgets, base + ".widgets", ' },
] as const;

describe("iOS signing chain", () => {
  const installer = read("apps/mobile/scripts/install-ios-profiles.py");
  const verifier = read("apps/mobile/scripts/verify-ios-share-archive.py");
  const workflow = read(".github/workflows/ios.yml");
  const labs = read(".github/workflows/labs-mobile.yml");
  const project = read("apps/mobile/ios/App/App.xcodeproj/project.pbxproj");

  // Since the Labs channel (docs/engineering/Labs_Channel.md) every bundle id
  // is the base PLAINVA_BUNDLE_BASE plus a fixed suffix — in the project, in
  // both Python checks, and nowhere as a literal that could drift.
  for (const bundle of BUNDLES) {
    it(`BASE${bundle.suffix} is known to the project, the installer, the verifier and both workflows`, () => {
      const id = `PRODUCT_BUNDLE_IDENTIFIER = "$(PLAINVA_BUNDLE_BASE)${bundle.suffix}";`;
      expect(project.split(id).length - 1, "Debug and Release derive the id from the base").toBe(2);
      expect(installer, "the installer validates this bundle's profile").toContain(`${bundle.installer}"${bundle.variable}")`);
      expect(verifier, "the archive check knows this bundle").toContain(bundle.verifier);
      for (const source of [workflow, labs]) {
        expect(source, "xcodebuild is handed the variable").toContain(`${bundle.variable}="$${bundle.variable}"`);
      }
    });
  }

  it("the store app is the default identity everywhere", () => {
    expect(project.split("PLAINVA_BUNDLE_BASE = com.plainva.app;").length - 1).toBe(2);
    expect(project.split("PLAINVA_APP_GROUP = group.com.plainva.app;").length - 1).toBe(2);
    for (const source of [installer, verifier]) {
      expect(source).toContain('or "com.plainva.app"');
      expect(source).toContain('or "group.com.plainva.app"');
    }
    // The release workflow never names another identity — a Labs id there
    // would upload a branch into the wrong app, or the store build into Labs.
    expect(workflow).not.toContain("com.plainva.app.labs");
    expect(workflow).not.toContain("IOS_LABS_");
  });

  it("the Labs workflow builds, checks and uploads one identity: Plainva Labs", () => {
    expect(labs).toContain("PLAINVA_BUNDLE_BASE: com.plainva.app.labs");
    expect(labs).toContain("PLAINVA_APP_GROUP: group.com.plainva.app.labs");
    for (const setting of ["PLAINVA_BUNDLE_BASE", "PLAINVA_APP_GROUP", "PLAINVA_DISPLAY_NAME"]) {
      expect(labs, `xcodebuild archive gets ${setting}`).toContain(`${setting}="$${setting}"`);
    }
    for (const secret of ["IOS_LABS_PROVISIONING_PROFILE_BASE64", "IOS_LABS_SHARE_PROVISIONING_PROFILE_BASE64", "IOS_LABS_WIDGETS_PROVISIONING_PROFILE_BASE64"]) {
      expect(labs).toContain(`secrets.${secret}`);
    }
    // Never the store app's profiles: they would sign com.plainva.app.
    expect(labs).not.toMatch(/secrets\.IOS_(?:SHARE_|WIDGETS_)?PROVISIONING_PROFILE_BASE64/);
  });

  it("finds its App Store Connect app by the exact bundle id", () => {
    // filter[bundleId] matches by prefix: since Plainva Labs exists, a query
    // for com.plainva.app returns com.plainva.app.labs first. Taking the first
    // hit would write the store build's notes into Labs (found 2026-09-24).
    for (const script of ["testflight-what-to-test.mjs", "testflight-feedback.mjs"]) {
      const source = read(`apps/mobile/scripts/${script}`);
      expect(source, script).toContain("app.attributes?.bundleId === BUNDLE_ID");
      expect(source, script).not.toContain("apps?.data?.[0]");
    }
  });

  it("entitlements and Info.plists take the identity from the build", () => {
    for (const file of ["App/App.entitlements", "PlainvaWidgets/PlainvaWidgets.entitlements", "ShareExtension/ShareExtension.entitlements"]) {
      const text = read(`apps/mobile/ios/App/${file}`);
      expect(text, file).toContain("<string>$(PLAINVA_APP_GROUP)</string>");
      expect(text, file).not.toContain("group.com.plainva.app");
    }
    for (const file of ["App/Info.plist", "PlainvaWidgets/Info.plist", "ShareExtension/Info.plist"]) {
      expect(read(`apps/mobile/ios/App/${file}`), file).toMatch(/<key>PlainvaAppGroup<\/key>\s*<string>\$\(PLAINVA_APP_GROUP\)<\/string>/);
    }
    for (const file of ["App/Info.plist", "PlainvaWidgets/Info.plist"]) {
      expect(read(`apps/mobile/ios/App/${file}`), file).toMatch(/<key>PlainvaURLScheme<\/key>\s*<string>\$\(PLAINVA_BUNDLE_BASE\)<\/string>/);
    }
  });

  it("every bundle carries the shared App Group, before and after the build", () => {
    // The group is the only way an extension reaches the snapshot. A profile
    // without it builds, signs, uploads — and the widget stays empty forever.
    for (const source of [installer, verifier]) {
      expect(source).toContain("in entitlements.get(\"com.apple.security.application-groups\", [])");
    }
  });

  it("insists that no two bundles share one profile", () => {
    expect(installer).toContain("Two bundles share one profile");
    expect(verifier).toContain("Every bundle needs its own matching profile");
  });

  it("compiles every Swift file of the widget target", () => {
    // The trap this closes: a file that is on disk but not in project.pbxproj
    // simply is not built. Nothing warns, the archive is smaller, and the
    // widget behaves as if the code had never been written.
    const sources = readdirSync(resolve(repositoryRoot, "apps/mobile/ios/App/PlainvaWidgets")).filter((f) => f.endsWith(".swift"));
    expect(sources.length, "the widget target has sources").toBeGreaterThan(0);
    const missing = sources.filter((file) => !project.includes(`${file} in Sources */`));
    expect(missing, `these files are in PlainvaWidgets/ but not compiled: ${missing.join(", ")}`).toEqual([]);
    // The shared store is compiled into BOTH targets — one file, two build files.
    expect(project.match(/WidgetStore\.swift in Sources \*\/,/g) ?? []).toHaveLength(2);
    // ...and the extension is embedded, or it ships as a target nobody runs.
    expect(project).toContain("PlainvaWidgets.appex in Embed App Extensions");
  });

  it("keeps the widgets profile optional until its target exists", () => {
    // Before W4 there is no widget target, so a missing secret must not fail
    // the build - and once the secret IS there, a missing .appex must.
    expect(workflow).toContain("IOS_WIDGETS_PROVISIONING_PROFILE_BASE64");
    expect(workflow).toContain("PLAINVA_EXPECT_WIDGETS=1");
    expect(verifier).toContain("PLAINVA_EXPECT_WIDGETS");
    expect(verifier).toContain("PlainvaWidgets.appex is missing from the archive");
  });
});
